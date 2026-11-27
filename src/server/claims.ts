import type { Express, Request } from "express";
import type { Config } from "./config.js";
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
import { CLAIM_DISPUTE_OPTION } from "../shared/messages.js";
import { notifyAdminsClaimDispute } from "./inbox.js";
export interface ClaimContext {
  config: Config;
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
    const turnOff =
      req.body?.highValue === false || req.body?.highValue === "false";
    const record = await ctx.store.mutate(text(req.params.id), (current) => {
      const next = requireRecord(current);
      next.item.high_value = !turnOff;
      return next;
    });
    res.json({ item: publicItem(record as ItemRecord, actor) });
  });

  /** 学生：物品已领取后联系管理员（冒领申诉）。 */
  app.post("/api/items/:id/contact-admin", async (req, res) => {
    const actor = await ctx.actorOf(req);
    if (actor.kind !== "student" || !actor.userId)
      throw new HttpError(403, "需要学生登录后才能联系管理员");
    const option = text(req.body?.option) || CLAIM_DISPUTE_OPTION;
    if (option !== CLAIM_DISPUTE_OPTION)
      throw new HttpError(400, "请选择有效的联系选项");
    const current = await ctx.store.read(text(req.params.id));
    if (!current) throw new HttpError(404, "帖子不存在");
    const row = normalizeRecord(current).item;
    if (row.status !== "claimed")
      throw new HttpError(400, "只有已领取的物品可以联系管理员反馈冒领");
    const count = await notifyAdminsClaimDispute(
      ctx.config.dataDir,
      ctx.config,
      {
        itemId: row.id,
        itemDescription: row.description,
        fromUserId: actor.userId,
        fromName: text(actor.name) || "同学",
        fromClassName: text(actor.className),
      },
    );
    if (!count)
      throw new HttpError(503, "暂时没有可联系的管理员，请稍后再试");
    res.json({ ok: true, notice: "已发给管理员，请等待处理" });
  });
}
