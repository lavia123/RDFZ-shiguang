import { Router } from "express";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { HttpError, text } from "../errors.js";
import type { LostStore } from "./store.js";
import type {
  CurrentActor,
  IsApprovedVersion,
  ResolveActor,
  ReviewSubmission,
} from "../../shared/b-contracts.js";
import type { LostPost, LostPostInput } from "../../shared/lost.js";
import type { ReviewResult } from "../../shared/publication.js";
import { platformScope } from "../platform-scope.js";

function managesSchoolRecord(post: LostPost) {
  return (
    post.schoolRecord === true &&
    platformScope.getStore()?.canManageSchoolRecords === true
  );
}

function requireStudent(actor: CurrentActor) {
  if (actor.kind === "guest" || !actor.userId)
    throw new HttpError(401, "需要登录的学生身份才能发布或管理寻物");
  if (actor.kind === "kiosk")
    throw new HttpError(403, "公共账号不能发布寻物或查看私人消息");
  return actor as CurrentActor & { userId: string };
}

/** 寻物不进人审。uncertain 直接公开；危险物品仍拦截；明确违规与审核故障不公开。 */
function lostHoldReason(review: ReviewResult, editing: boolean): string | null {
  if (review.status === "allowed") return null;
  if (review.status === "uncertain") {
    const danger = review.issues.find((issue) =>
      /老师|枪支|爆炸|毒品|危险/.test(issue.message),
    );
    if (!danger) return null;
    return danger.message;
  }
  if (review.status === "rejected") {
    return editing ? "修改未通过审核，已保留原合规版本" : "寻物内容未通过审核";
  }
  return editing ? "审核服务暂不可用，已保留原合规版本" : "审核服务暂不可用";
}

function parseInput(body: Record<string, unknown>): LostPostInput {
  const description = text(body.description).slice(0, 2000);
  if (!description) throw new HttpError(400, "请填写寻物描述");
  const lostFrom = text(body.lostFrom) || null;
  const lostTo = text(body.lostTo) || null;
  if (lostFrom && Number.isNaN(Date.parse(lostFrom)))
    throw new HttpError(400, "丢失开始时间无效");
  if (lostTo && Number.isNaN(Date.parse(lostTo)))
    throw new HttpError(400, "丢失结束时间无效");
  if (lostFrom && lostTo && Date.parse(lostFrom) > Date.parse(lostTo))
    throw new HttpError(400, "丢失时间范围无效");
  return {
    description,
    image: text(body.image).slice(0, 200),
    place: text(body.place).slice(0, 200),
    lostFrom,
    lostTo,
  };
}

export function lostRouter(deps: {
  lost: LostStore;
  resolveActor: ResolveActor;
  reviewSubmission: ReviewSubmission;
  isApprovedVersion: IsApprovedVersion;
}) {
  const router = Router();

  const actorOf = async (req: Request) =>
    deps.resolveActor({
      header: (name) => {
        const v = req.header(name);
        return v === undefined ? undefined : String(v);
      },
      body: req.body,
    });

  router.get("/lost-posts", async (req, res) => {
    const actor = await actorOf(req);
    const mine = text(req.query.mine) === "1";
    const all = await deps.lost.list();
    const posts = all
      .filter((p) => {
        if (mine) {
          if (!actor.userId || p.ownerId !== actor.userId) return false;
          return true;
        }
        return deps.isApprovedVersion({
          revision: p.revision,
          publication: p.publication,
        });
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    res.json({ posts: posts.map(publicLost) });
  });

  router.get("/lost-posts/:id", async (req, res) => {
    const actor = await actorOf(req);
    const post = await deps.lost.read(text(req.params.id));
    if (!post) throw new HttpError(404, "寻物不存在");
    const approved = deps.isApprovedVersion({
      revision: post.revision,
      publication: post.publication,
    });
    if (
      !approved &&
      post.ownerId !== actor.userId &&
      !managesSchoolRecord(post)
    )
      throw new HttpError(404, "寻物不存在");
    res.json({ post: publicLost(post) });
  });

  router.post("/lost-posts", async (req, res) => {
    const actor = requireStudent(await actorOf(req));
    const input = parseInput(req.body || {});
    const now = new Date().toISOString();
    const revision = 1;
    const review = await deps.reviewSubmission({
      kind: "lost",
      revision,
      textFields: {
        description: input.description,
        place: input.place || "",
        lostFrom: input.lostFrom || "",
        lostTo: input.lostTo || "",
      },
      imageRef: input.image || undefined,
    });
    const hold = lostHoldReason(review, false);
    if (hold) {
      res.status(review.status === "unavailable" ? 503 : 422).json({
        error: hold,
        issues: review.issues,
      });
      return;
    }
    const id = "lost_" + randomUUID().replaceAll("-", "").slice(0, 16);
    const post: LostPost = {
      id,
      ownerId: actor.userId,
      ownerName: text(actor.name).slice(0, 40) || "同学",
      ownerClassName: text(actor.className).slice(0, 40),
      description: input.description!,
      image: input.image || "",
      place: input.place || "",
      lostFrom: input.lostFrom ?? null,
      lostTo: input.lostTo ?? null,
      status: "open",
      foundViaItemId: null,
      revision,
      publication: { approvedRevision: revision },
      createdAt: now,
      updatedAt: now,
      batchHint: "pending_batch",
    };
    await deps.lost.mutate(id, (cur) => {
      if (cur) throw new HttpError(409, "寻物 ID 已存在");
      return post;
    });
    res.status(201).json({
      post: publicLost(post),
      notice: "已发布，将在每日配对后提醒",
    });
  });

  router.patch("/lost-posts/:id", async (req, res) => {
    const actor = requireStudent(await actorOf(req));
    const id = text(req.params.id);
    const body = (req.body || {}) as Record<string, unknown>;
    const status = text(body.status) as LostPost["status"] | "";
    const contentTouched =
      body.description !== undefined ||
      body.image !== undefined ||
      body.place !== undefined ||
      body.lostFrom !== undefined ||
      body.lostTo !== undefined;

    const updated = await deps.lost.mutate(id, async (cur) => {
      if (!cur) throw new HttpError(404, "寻物不存在");
      if (cur.ownerId !== actor.userId && !managesSchoolRecord(cur))
        throw new HttpError(403, "不能修改他人寻物");
      let next: LostPost = { ...cur, updatedAt: new Date().toISOString() };

      if (status) {
        if (!["open", "found", "closed"].includes(status))
          throw new HttpError(400, "无效状态");
        next.status = status;
        if (status === "found")
          next.foundViaItemId = text(body.foundViaItemId) || null;
        if (status === "closed" || status === "found") next.batchHint = null;
      }

      if (contentTouched) {
        const input = parseInput({
          description:
            body.description !== undefined ? body.description : cur.description,
          image: body.image !== undefined ? body.image : cur.image,
          place: body.place !== undefined ? body.place : cur.place,
          lostFrom: body.lostFrom !== undefined ? body.lostFrom : cur.lostFrom,
          lostTo: body.lostTo !== undefined ? body.lostTo : cur.lostTo,
        });
        const revision = cur.revision + 1;
        const review = await deps.reviewSubmission({
          kind: "lost",
          revision,
          textFields: {
            description: input.description,
            place: input.place || "",
            lostFrom: input.lostFrom || "",
            lostTo: input.lostTo || "",
          },
          imageRef: input.image || undefined,
        });
        const hold = lostHoldReason(review, true);
        if (hold) {
          throw new HttpError(
            review.status === "unavailable" ? 503 : 422,
            hold,
          );
        }
        next = {
          ...next,
          description: input.description!,
          image: input.image || "",
          place: input.place || "",
          lostFrom: input.lostFrom ?? null,
          lostTo: input.lostTo ?? null,
          revision,
          publication: { approvedRevision: revision },
          batchHint: next.status === "open" ? "pending_batch" : next.batchHint,
        };
      }
      return next;
    });
    res.json({ post: publicLost(updated!) });
  });

  router.delete("/lost-posts/:id", async (req, res) => {
    const actor = requireStudent(await actorOf(req));
    const id = text(req.params.id);
    await deps.lost.mutate(id, (cur) => {
      if (!cur) throw new HttpError(404, "寻物不存在");
      if (cur.ownerId !== actor.userId && !managesSchoolRecord(cur))
        throw new HttpError(403, "不能删除他人寻物");
      if (cur.status === "open")
        throw new HttpError(403, "寻找中的寻物请先确认找回或关闭，再删除");
      return null;
    });
    res.json({ ok: true });
  });

  return router;
}

function publicLost(post: LostPost) {
  return post;
}
