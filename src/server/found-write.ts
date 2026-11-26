import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Express, Request } from "express";
import type { Config } from "./config.js";
import type { FileStore } from "./storage.js";
import { HttpError, text } from "./errors.js";
import { commitImage, cleanupUpload, uploadMiddleware } from "./uploads.js";
import { publicItem } from "./items.js";
import { normalizeRecord } from "./records.js";
import {
  resolveHighValue,
  type CurrentActor,
  type ReviewCandidate,
  type ReviewResult,
  type StationProfile,
} from "../shared/identity.js";
import type { ItemRecord, ItemRow } from "../shared/types.js";
import { FIXED_OFFICE } from "../shared/constants.js";
import { formatReviewIssue } from "../shared/review-labels.js";
export interface FoundWriteContext {
  config: Config;
  store: FileStore;
  actorOf: (req: Request) => Promise<CurrentActor>;
  review: (candidate: ReviewCandidate) => Promise<ReviewResult>;
  stations: StationProfile[];
}
function flag(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true" || value === "1" || value === "on")
    return true;
  if (value === false || value === "false" || value === "0") return false;
  return undefined;
}
function requireWriter(actor: CurrentActor) {
  if (
    actor.kind !== "student" &&
    actor.kind !== "kiosk" &&
    actor.kind !== "admin"
  )
    throw new HttpError(403, "请先登录学校账号。登录还没接上，所以现在不能发布。");
}
function reviewFailure(result: ReviewResult) {
  const fallback =
    result.status === "rejected"
      ? "有内容不合适，请按提示改完再提交"
      : result.status === "uncertain"
        ? "暂时看不清楚，请改一改或重新拍照后再试"
        : "审核暂时不可用，请稍后再试";
  const detail = result.issues.map(formatReviewIssue).filter(Boolean).join("；");
  return {
    status: result.status === "unavailable" ? 503 : 422,
    body: {
      error: detail || fallback,
      issues: result.issues,
    },
  };
}
function stationContact(
  actor: CurrentActor,
  body: Record<string, unknown>,
  stations: StationProfile[],
) {
  const station =
    actor.kind === "kiosk"
      ? stations.find((item) => item.stationId === actor.stationId)
      : undefined;
  let contactType = text(body.contactType);
  const contactValue =
    text(body.contactValue) ||
    (actor.kind === "kiosk" ? station?.contactValue || "" : "");
  let contact = "";
  if (actor.kind === "kiosk") {
    contact = station?.contactName || "";
    if (!contactType && contactValue) contactType = "其他";
  }
  return {
    contact,
    contactType,
    contactValue,
    contactScope: actor.kind === "kiosk" ? ("station" as const) : ("private" as const),
  };
}
function foundTexts(input: {
  description: string;
  office: string;
  place: string;
  contact: string;
  contactType: string;
  contactValue: string;
  highValue: boolean;
}): Record<string, string> {
  return {
    description: input.description,
    office: input.office,
    place: input.place,
    contact: input.contact,
    contactType: input.contactType,
    contactValue: input.contactValue,
    highValue: input.highValue ? "高价值" : "",
  };
}
export function registerFoundRoutes(app: Express, ctx: FoundWriteContext) {
  const upload = uploadMiddleware(ctx.config.dataDir);
  app.post("/api/items", upload, async (req, res) => {
    let image = "";
    let saved = false;
    try {
      const actor = await ctx.actorOf(req);
      requireWriter(actor);
      const description = text(req.body?.description);
      const office = FIXED_OFFICE;
      const place = text(req.body?.place);
      if (!description) throw new HttpError(400, "请先写物品描述");
      if (!req.file) throw new HttpError(400, "请上传物品照片");
      const contact = stationContact(actor, req.body || {}, ctx.stations);
      const high = resolveHighValue({
        previous: false,
        requested: flag(req.body?.highValue) ?? false,
        actor: actor.kind,
      });
      if (!high.ok) throw new HttpError(403, high.error);
      const reviewed = await ctx.review({
        kind: "found",
        revision: 1,
        texts: foundTexts({ description, office, place, ...contact, highValue: high.value }),
        images: [path.basename(req.file.path)],
      });
      if (reviewed.status !== "allowed") {
        const failure = reviewFailure(reviewed);
        res.status(failure.status).json(failure.body);
        return;
      }
      image = await commitImage(ctx.config.dataDir, req.file);
      const now = new Date().toISOString();
      const id = "item_" + randomUUID().replaceAll("-", "").slice(0, 16);
      const row: ItemRow = {
        id,
        owner_id: actor.userId || "",
        description,
        office,
        place,
        contact: contact.contact,
        contact_type: contact.contactType,
        contact_value: contact.contactValue,
        contact_scope: contact.contactScope,
        image,
        created_at: now,
        status: "open",
        revision: 1,
        publication: { approvedRevision: 1, reviewedAt: now },
        high_value: high.value,
        custody: {
          heldBy: actor.kind === "kiosk" ? "station" : "finder",
          location: office,
          receivedAt: null,
          receivedByUserId: null,
          note: "",
        },
        claim: null,
        claim_log: [],
        intents: [],
        verified: null,
      };
      const record = await ctx.store.mutate(id, (current) => {
        if (current) throw new HttpError(409, "帖子 ID 已存在");
        return { item: row, viewLogs: [] };
      });
      saved = true;
      res.status(201).json({ item: publicItem(record as ItemRecord, actor) });
    } finally {
      await cleanupUpload(req.file);
      if (image && !saved) await ctx.store.removeImage(image);
    }
  });
  app.patch("/api/items/:id", upload, async (req, res) => {
    let image = "";
    let oldImage = "";
    let saved = false;
    try {
      const actor = await ctx.actorOf(req);
      requireWriter(actor);
      const id = text(req.params.id);
      const current = await ctx.store.read(id);
      if (!current) throw new HttpError(404, "帖子不存在");
      const existing = normalizeRecord(current).item;
      const admin = actor.kind === "admin";
      if (!admin && actor.userId !== existing.owner_id)
        throw new HttpError(403, "无权修改该帖");
      if (existing.status !== "open")
        throw new HttpError(403, "帖子已领取或撤下，不能修改内容");
      const description =
        req.body?.description === undefined
          ? existing.description
          : text(req.body.description);
      const office = FIXED_OFFICE;
      const place =
        req.body?.place === undefined ? existing.place : text(req.body.place);
      if (!description) throw new HttpError(400, "请先写物品描述");
      const contactFields =
        req.body?.contact === undefined &&
        req.body?.contactType === undefined &&
        req.body?.contactValue === undefined
          ? {
              contact: existing.contact,
              contactType: existing.contact_type,
              contactValue: existing.contact_value,
            }
          : stationContact(
              actor,
              {
                contact:
                  req.body?.contact === undefined
                    ? existing.contact
                    : req.body.contact,
                contactType:
                  req.body?.contactType === undefined
                    ? existing.contact_type
                    : req.body.contactType,
                contactValue:
                  req.body?.contactValue === undefined
                    ? existing.contact_value
                    : req.body.contactValue,
              },
              ctx.stations,
            );
      const contact = {
        ...contactFields,
        contactScope:
          actor.kind === "kiosk"
            ? ("station" as const)
            : existing.contact_scope || "private",
      };
      const high = resolveHighValue({
        previous: existing.high_value === true,
        requested: flag(req.body?.highValue),
        actor: actor.kind,
      });
      if (!high.ok) throw new HttpError(403, high.error);
      const revision = (existing.revision || 1) + 1;
      const reviewed = await ctx.review({
        kind: "found",
        revision,
        texts: foundTexts({
          description,
          office,
          place,
          contact: contact.contact,
          contactType: contact.contactType,
          contactValue: contact.contactValue,
          highValue: high.value,
        }),
        images: [req.file ? path.basename(req.file.path) : existing.image],
      });
      if (reviewed.status !== "allowed") {
        const failure = reviewFailure(reviewed);
        res.status(failure.status).json(failure.body);
        return;
      }
      if (req.file) image = await commitImage(ctx.config.dataDir, req.file);
      const now = new Date().toISOString();
      const record = await ctx.store.mutate(id, (latest) => {
        if (!latest) throw new HttpError(404, "帖子不存在");
        const next = normalizeRecord(latest);
        const row = next.item;
        if ((row.revision || 1) !== (existing.revision || 1))
          throw new HttpError(409, "内容已更新，请重新载入");
        if (row.status !== "open")
          throw new HttpError(409, "审核期间物品状态已变化，请重新载入");
        if (actor.kind !== "admin" && actor.userId !== row.owner_id)
          throw new HttpError(403, "无权修改该帖");
        row.description = description;
        row.office = office;
        row.place = place;
        row.contact = contact.contact;
        row.contact_type = contact.contactType;
        row.contact_value = contact.contactValue;
        row.contact_scope = contact.contactScope;
        row.high_value = high.value;
        if (image) {
          oldImage = row.image;
          row.image = image;
        }
        row.revision = revision;
        row.publication = { approvedRevision: revision, reviewedAt: now };
        return next;
      });
      saved = true;
      if (oldImage && oldImage !== image) await ctx.store.removeImage(oldImage);
      res.json({ item: publicItem(record as ItemRecord, actor) });
    } finally {
      await cleanupUpload(req.file);
      if (image && !saved) await ctx.store.removeImage(image);
    }
  });
}
