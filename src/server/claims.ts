import type { Express, Request } from "express";
import type { FileStore } from "./storage.js";
import { HttpError, text } from "./errors.js";
import { publicItem } from "./items.js";
import {
  activeDelivery,
  canRead,
  isStationUser,
  normalizeRecord,
} from "./records.js";
import {
  claimLabel,
  type CurrentActor,
  type LookupResult,
} from "../shared/identity.js";
import type { DeliveryRecord, ItemRecord } from "../shared/types.js";
export interface ClaimContext {
  store: FileStore;
  actorOf: (req: Request) => Promise<CurrentActor>;
  lookup: (userId: string) => Promise<LookupResult>;
  stationUserIds: string[];
}
function requireRecord(record: ItemRecord | null) {
  if (!record) throw new HttpError(404, "帖子不存在");
  return normalizeRecord(record);
}
function delivery(input: {
  claimantUserId: string;
  name: string;
  className: string;
  source: "self" | "admin";
  operatorUserId: string;
  note: string;
}): DeliveryRecord {
  return {
    ...input,
    at: new Date().toISOString(),
    active: true,
    closedAt: null,
    closeReason: null,
  };
}
async function resolveClaimant(
  ctx: ClaimContext,
  actor: CurrentActor,
  userId: string,
) {
  if (!userId) throw new HttpError(400, "请先填写领走的同学账号");
  if (isStationUser(userId, ctx.stationUserIds))
    throw new HttpError(400, "公共电脑的账号不能领东西");
  if (userId === actor.userId)
    throw new HttpError(400, "不能把老师自己写成领走的人");
  const found = await ctx.lookup(userId);
  if (found.status === "unavailable")
    throw new HttpError(
      503,
      "学校名单暂时无法读取，请稍后重试，不能在这里新建账号。",
    );
  if (found.status === "absent")
    throw new HttpError(404, "学校里没有这名同学，不能只凭自己报的名字领取");
  return found.student;
}
export function registerClaimRoutes(app: Express, ctx: ClaimContext) {
  app.post("/api/items/:id/claim", async (req, res) => {
    const actor = await ctx.actorOf(req);
    if (actor.kind !== "student" || !actor.userId)
      throw new HttpError(403, "只有学生本人可以登记。这台电脑不能领取。");
    const record = await ctx.store.mutate(text(req.params.id), (current) => {
      const next = requireRecord(current);
      if (!canRead(next, actor)) throw new HttpError(404, "帖子不存在");
      const row = next.item;
      if (row.status !== "open" || activeDelivery(next))
        throw new HttpError(409, "已经有人领走了");
      if (row.high_value)
        throw new HttpError(403, "贵重物品要老师核对后才能领走");
      const entry = delivery({
        claimantUserId: actor.userId || "",
        name: actor.name || "",
        className: actor.className || "",
        source: "self",
        operatorUserId: actor.userId || "",
        note: "",
      });
      row.status = "claimed";
      row.claim_log = [...(row.claim_log || []), entry];
      row.claim = {
        claimantUserId: entry.claimantUserId,
        name: entry.name,
        className: entry.className,
        claimedAt: entry.at,
        source: "self",
        claimLabel: "本人登记",
        operatorUserId: entry.operatorUserId,
        note: "",
      };
      return next;
    });
    res.json({ item: publicItem(record as ItemRecord, actor) });
  });
  app.post("/api/items/:id/intent", async (req, res) => {
    const actor = await ctx.actorOf(req);
    if (actor.kind !== "student" || !actor.userId)
      throw new HttpError(403, "只有学生可以来说这是我的");
    const record = await ctx.store.mutate(text(req.params.id), (current) => {
      const next = requireRecord(current);
      if (!canRead(next, actor)) throw new HttpError(404, "帖子不存在");
      const row = next.item;
      if (row.status !== "open")
        throw new HttpError(409, "这件东西已经领走或撤下了");
      const intents = (row.intents || []).filter(
        (intent) => intent.userId !== actor.userId,
      );
      intents.unshift({
        userId: actor.userId || "",
        name: actor.name || "",
        className: actor.className || "",
        at: new Date().toISOString(),
      });
      row.intents = intents;
      return next;
    });
    res.json({ item: publicItem(record as ItemRecord, actor) });
  });
  app.post("/api/items/:id/deliver", async (req, res) => {
    const actor = await ctx.actorOf(req);
    if (actor.kind !== "admin" || !actor.userId)
      throw new HttpError(403, "只有老师可以操作");
    const student = await resolveClaimant(
      ctx,
      actor,
      text(req.body?.claimantUserId),
    );
    const note = text(req.body?.note);
    const record = await ctx.store.mutate(text(req.params.id), (current) => {
      const next = requireRecord(current);
      const row = next.item;
      if (row.status !== "open" || activeDelivery(next))
        throw new HttpError(409, "已经有人领走了");
      if (row.high_value && row.custody?.heldBy !== "teacher")
        throw new HttpError(409, "贵重物品还没交到老师那里，现在不能给");
      const entry = delivery({
        claimantUserId: student.userId,
        name: student.name,
        className: student.className,
        source: "admin",
        operatorUserId: actor.userId || "",
        note,
      });
      row.status = "claimed";
      row.claim_log = [...(row.claim_log || []), entry];
      row.claim = {
        claimantUserId: entry.claimantUserId,
        name: entry.name,
        className: entry.className,
        claimedAt: entry.at,
        source: "admin",
        claimLabel: claimLabel("admin"),
        operatorUserId: entry.operatorUserId,
        note,
      };
      return next;
    });
    res.json({ item: publicItem(record as ItemRecord, actor) });
  });
  app.post("/api/items/:id/custody", async (req, res) => {
    const actor = await ctx.actorOf(req);
    if (actor.kind !== "admin" || !actor.userId)
      throw new HttpError(403, "只有老师可以操作");
    const heldBy = text(req.body?.heldBy);
    if (heldBy !== "finder" && heldBy !== "station" && heldBy !== "teacher")
      throw new HttpError(400, "请写一下现在在谁手里");
    const record = await ctx.store.mutate(text(req.params.id), (current) => {
      const next = requireRecord(current);
      const row = next.item;
      const location = text(req.body?.location) || row.custody?.location || row.office;
      row.custody = {
        heldBy,
        location,
        receivedAt: heldBy === "teacher" ? new Date().toISOString() : null,
        receivedByUserId: heldBy === "teacher" ? actor.userId || "" : null,
        note: text(req.body?.note),
      };
      return next;
    });
    res.json({ item: publicItem(record as ItemRecord, actor) });
  });
  app.post("/api/items/:id/claim/correct", async (req, res) => {
    const actor = await ctx.actorOf(req);
    if (actor.kind !== "admin" || !actor.userId)
      throw new HttpError(403, "只有老师可以操作");
    const reason = text(req.body?.reason);
    if (!reason) throw new HttpError(400, "请写下修改原因");
    const nextUserId = text(req.body?.claimantUserId);
    const student = nextUserId
      ? await resolveClaimant(ctx, actor, nextUserId)
      : null;
    const record = await ctx.store.mutate(text(req.params.id), (current) => {
      const next = requireRecord(current);
      const row = next.item;
      const active = (row.claim_log || []).find((entry) => entry.active);
      if (!active) throw new HttpError(400, "没有可以修改的领取记录");
      if (student && row.high_value && row.custody?.heldBy !== "teacher")
        throw new HttpError(409, "贵重物品还没交到老师那里，现在不能给");
      active.active = false;
      active.closedAt = new Date().toISOString();
      active.closeReason = reason;
      if (!student) {
        row.status = "open";
        row.claim = null;
        return next;
      }
      const entry = delivery({
        claimantUserId: student.userId,
        name: student.name,
        className: student.className,
        source: "admin",
        operatorUserId: actor.userId || "",
        note: reason,
      });
      row.claim_log = [...(row.claim_log || []), entry];
      row.status = "claimed";
      row.claim = {
        claimantUserId: entry.claimantUserId,
        name: entry.name,
        className: entry.className,
        claimedAt: entry.at,
        source: "admin",
        claimLabel: claimLabel("admin"),
        operatorUserId: entry.operatorUserId,
        note: reason,
      };
      return next;
    });
    res.json({ item: publicItem(record as ItemRecord, actor) });
  });
  app.post("/api/items/:id/withdraw", async (req, res) => {
    const actor = await ctx.actorOf(req);
    if (actor.kind === "guest" || !actor.userId)
      throw new HttpError(403, "请先登录学校账号后操作。");
    const record = await ctx.store.mutate(text(req.params.id), (current) => {
      const next = requireRecord(current);
      if (!canRead(next, actor)) throw new HttpError(404, "帖子不存在");
      const row = next.item;
      const admin = actor.kind === "admin";
      if (!admin && actor.userId !== row.owner_id)
        throw new HttpError(403, "你不能撤下这条");
      if (!admin && row.status !== "open")
        throw new HttpError(403, "已经领走的，只有老师能撤下");
      if (row.status === "withdrawn") throw new HttpError(400, "这条已经撤下了");
      row.status = "withdrawn";
      return next;
    });
    res.json({ item: publicItem(record as ItemRecord, actor) });
  });
  app.post("/api/items/:id/high-value", async (req, res) => {
    const actor = await ctx.actorOf(req);
    if (actor.kind !== "admin") throw new HttpError(403, "只有老师可以操作");
    if (req.body?.highValue === false || req.body?.highValue === "false")
      throw new HttpError(403, "不能在这里取消贵重标记");
    const record = await ctx.store.mutate(text(req.params.id), (current) => {
      const next = requireRecord(current);
      next.item.high_value = true;
      return next;
    });
    res.json({ item: publicItem(record as ItemRecord, actor) });
  });
}
