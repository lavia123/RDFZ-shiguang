import { Router } from "express";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import type { FileStore } from "../storage.js";
import { HttpError, text } from "../errors.js";
import { uploadMiddleware, cleanupUpload } from "../uploads.js";
import type { CurrentActor, ResolveActor } from "../../shared/b-contracts.js";
import type { ReviewSubmission } from "../../shared/publication.js";
import { asPublicationFields } from "../../shared/publication.js";
import { reviewHttpStatus } from "../moderation/review.js";
import {
  assertStagingOwner,
  promoteStagingToUploads,
  removeStaging,
  removeUploadUrl,
  saveStagingImage,
} from "./staging.js";
import type { ItemRecord, ItemRow } from "../../shared/types.js";
import { publicItem } from "../items.js";

type PublishableRow = ItemRow & {
  revision: number;
  publication: {
    approvedRevision: number;
    reviewedAt: string;
  } | null;
};

function requireWriter(actor: CurrentActor) {
  if (actor.kind === "guest" || !actor.userId)
    throw new HttpError(401, "需要登录后才能发布招领");
  return actor as CurrentActor & { userId: string };
}

function actorOf(resolveActor: ResolveActor, req: Request) {
  return resolveActor({
    header: (name) => {
      const v = req.header(name);
      return v === undefined ? undefined : String(v);
    },
    body: req.body,
  });
}

function textFieldsFromBody(
  body: Record<string, unknown>,
  mode: "personal" | "kiosk",
) {
  const fields: Record<string, string> = {
    description: text(body.description),
    place: text(body.place),
    office: text(body.office),
  };
  if (mode === "kiosk") {
    fields.contact = text(body.contact);
    fields.contactType = text(body.contactType);
    fields.contactValue = text(body.contactValue);
  }
  return fields;
}

function rejectReview(
  res: import("express").Response,
  review: Awaited<ReturnType<ReviewSubmission>>,
) {
  res.status(reviewHttpStatus(review)).json({
    error:
      review.status === "rejected"
        ? "内容未通过审核"
        : review.status === "uncertain"
          ? "信息不够明确，请修改或重拍后再提交"
          : "审核服务暂不可用，请稍后重试",
    status: review.status,
    issues: review.issues,
  });
}

/**
 * C 交付的招领审核发布路由，供 A 替换 app.ts 中旧 /api/items POST/PATCH。
 */
export function foundPublicationRouter(deps: {
  dataDir: string;
  store: FileStore;
  resolveActor: ResolveActor;
  reviewSubmission: ReviewSubmission;
}) {
  const router = Router();
  const upload = uploadMiddleware(deps.dataDir);

  router.post("/found-posts/staging", upload, async (req, res) => {
    try {
      const actor = requireWriter(await actorOf(deps.resolveActor, req));
      if (!req.file) throw new HttpError(400, "请上传物品照片");
      const saved = await saveStagingImage(
        deps.dataDir,
        req.file,
        actor.userId,
      );
      res.status(201).json({
        imageRef: saved.ref,
        previewUrl: `/api/media/staging/${saved.ref}`,
      });
    } finally {
      await cleanupUpload(req.file);
    }
  });

  router.post("/found-posts", async (req, res) => {
    const actor = requireWriter(await actorOf(deps.resolveActor, req));
    const body = (req.body || {}) as Record<string, unknown>;
    const mode = actor.kind === "kiosk" ? "kiosk" : "personal";
    const fields = textFieldsFromBody(body, mode);
    if (!fields.description) throw new HttpError(400, "请填写物品描述");
    if (!fields.office) throw new HttpError(400, "请选择失物招领处");
    if (!fields.place) throw new HttpError(400, "请填写捡到场所");
    const imageRef = text(body.imageRef);
    if (!imageRef) throw new HttpError(400, "请先上传物品照片");
    await assertStagingOwner(deps.dataDir, imageRef, actor.userId);

    const revision = 1;
    const review = await deps.reviewSubmission({
      kind: "found",
      revision,
      textFields: fields,
      imageRef,
    });
    if (review.status !== "allowed") {
      rejectReview(res, review);
      return;
    }

    let image = "";
    let saved = false;
    const id = "item_" + randomUUID().replaceAll("-", "").slice(0, 16);
    try {
      image = await promoteStagingToUploads(deps.dataDir, imageRef);
      const now = new Date().toISOString();
      const row: PublishableRow = {
        id,
        owner_id: actor.userId,
        description: fields.description,
        office: fields.office,
        place: fields.place,
        contact: mode === "kiosk" ? fields.contact : text(actor.name) || "同学",
        contact_type: mode === "kiosk" ? fields.contactType : "",
        contact_value: mode === "kiosk" ? fields.contactValue : "",
        image,
        created_at: now,
        status: "open",
        claim: null,
        verified: null,
        revision,
        publication: { approvedRevision: revision, reviewedAt: now },
      };
      const record = await deps.store.mutate(id, (current) => {
        if (current) throw new HttpError(409, "帖子 ID 已存在");
        return { item: row, viewLogs: [] };
      });
      saved = true;
      await removeStaging(deps.dataDir, imageRef);
      res.status(201).json({
        item: publicItem(record as ItemRecord, actor),
        notice: "已通过审核并公开",
      });
    } finally {
      if (image && !saved) await removeUploadUrl(deps.dataDir, image);
    }
  });

  router.patch("/found-posts/:id", async (req, res) => {
    const actor = requireWriter(await actorOf(deps.resolveActor, req));
    const id = text(req.params.id);
    const body = (req.body || {}) as Record<string, unknown>;
    const mode = actor.kind === "kiosk" ? "kiosk" : "personal";
    const baseExpected = Number(body.baseRevision);
    const imageRef = text(body.imageRef);

    const current = await deps.store.read(id);
    if (!current) throw new HttpError(404, "帖子不存在");
    const row = current.item as PublishableRow;
    const pub = asPublicationFields(row as unknown as Record<string, unknown>);
    if (row.owner_id !== actor.userId && actor.kind !== "admin")
      throw new HttpError(403, "无权修改该帖");
    if (row.verified) throw new HttpError(403, "管理员已核对锁定，无法修改");
    if (row.status === "claimed")
      throw new HttpError(403, "帖子已找回锁定，无法修改");
    if (
      Number.isFinite(baseExpected) &&
      pub.revision > 0 &&
      baseExpected !== pub.revision
    )
      throw new HttpError(409, "内容已更新，请重新载入后再改");

    const fields = textFieldsFromBody(
      {
        description: body.description ?? row.description,
        place: body.place ?? row.place,
        office: body.office ?? row.office,
        contact: body.contact ?? row.contact,
        contactType: body.contactType ?? row.contact_type,
        contactValue: body.contactValue ?? row.contact_value,
      },
      mode,
    );
    if (!fields.description) throw new HttpError(400, "请填写物品描述");
    if (!fields.office) throw new HttpError(400, "请选择失物招领处");
    if (!fields.place) throw new HttpError(400, "请填写捡到场所");
    if (imageRef) await assertStagingOwner(deps.dataDir, imageRef, actor.userId);

    const revision = Math.max(0, pub.revision) + 1;
    const textFields = {
      ...fields,
      ...(imageRef ? {} : { existingImage: row.image || "" }),
    };
    const review = await deps.reviewSubmission({
      kind: "found",
      revision,
      textFields,
      imageRef: imageRef || undefined,
    });
    if (review.status !== "allowed") {
      rejectReview(res, review);
      return;
    }

    let newImage = "";
    let oldImage = "";
    let saved = false;
    try {
      if (imageRef) newImage = await promoteStagingToUploads(deps.dataDir, imageRef);
      const now = new Date().toISOString();
      const record = await deps.store.mutate(id, (cur) => {
        const rec = cur;
        if (!rec) throw new HttpError(404, "帖子不存在");
        const next = rec.item as PublishableRow;
        const live = asPublicationFields(
          next as unknown as Record<string, unknown>,
        );
        if (live.revision !== pub.revision)
          throw new HttpError(409, "内容已更新，请重新载入后再改");
        if (next.status === "claimed" || next.verified)
          throw new HttpError(409, "帖子状态已变化，无法保存");
        next.description = fields.description;
        next.office = fields.office;
        next.place = fields.place;
        if (mode === "kiosk") {
          next.contact = fields.contact;
          next.contact_type = fields.contactType;
          next.contact_value = fields.contactValue;
        }
        next.revision = revision;
        next.publication = { approvedRevision: revision, reviewedAt: now };
        if (newImage) {
          oldImage = next.image;
          next.image = newImage;
        }
        return rec;
      });
      saved = true;
      if (imageRef) await removeStaging(deps.dataDir, imageRef);
      if (oldImage) await removeUploadUrl(deps.dataDir, oldImage);
      res.json({
        item: publicItem(record as ItemRecord, actor),
        notice: "修改已通过审核并公开",
      });
    } finally {
      if (newImage && !saved) await removeUploadUrl(deps.dataDir, newImage);
    }
  });

  return router;
}
