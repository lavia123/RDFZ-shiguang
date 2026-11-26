import express from "express";
import type { ErrorRequestHandler, Request } from "express";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.js";
import { FileStore } from "./storage.js";
import { HttpError, text } from "./errors.js";
import {
  FIXTURE_ACTORS,
  FIXTURE_STATIONS,
  actorProvenance,
  lookupStudent,
  resolveActor,
  stationFor,
} from "./auth.js";
import { canRead, normalizeRecord, publicItem } from "./items.js";
import { aiRouter } from "./ai.js";
import { registerFoundRoutes } from "./found-write.js";
import { registerClaimRoutes } from "./claims.js";
import {
  isApprovedVersion,
  sanitizeActor,
  sessionView,
  type CurrentActor,
  type LookupResult,
  type ReviewCandidate,
  type ReviewResult,
  type StationProfile,
} from "../shared/identity.js";
import type { ItemRecord } from "../shared/types.js";
import {
  findTrialByProfile,
  loadTestPasswords,
  saveTestPasswords,
  trialAccounts,
} from "./test-passwords.js";
export interface AppDeps {
  provenance?: "platform";
  resolveActor?: (req: Request) => CurrentActor | Promise<CurrentActor>;
  reviewSubmission?: (
    candidate: ReviewCandidate,
  ) => ReviewResult | Promise<ReviewResult>;
  lookupStudent?: (userId: string) => LookupResult | Promise<LookupResult>;
  stations?: StationProfile[];
}
const rank = { open: 0, claimed: 1, withdrawn: 2 };
function requireRecord(record: ItemRecord | null) {
  if (!record) throw new HttpError(404, "帖子不存在");
  return record;
}
async function unavailableReview(): Promise<ReviewResult> {
  return {
    status: "unavailable",
    issues: [{ field: "publication", message: "内容审核尚未接入，暂不可公开" }],
  };
}
export function createApp(
  config: Config,
  store: FileStore,
  upstream: typeof fetch = fetch,
  deps: AppDeps = {},
) {
  const stations = deps.stations ?? (config.testActors ? FIXTURE_STATIONS : []);
  const stationUserIds = stations.map((station) => station.userId);
  async function actorOf(req: Request) {
    const resolved = deps.resolveActor
      ? await deps.resolveActor(req)
      : resolveActor(req, config);
    return sanitizeActor(resolved);
  }
  async function review(candidate: ReviewCandidate): Promise<ReviewResult> {
    if (deps.reviewSubmission) return deps.reviewSubmission(candidate);
    if (!config.production && config.testReviewAllow)
      return { status: "allowed", issues: [] };
    return unavailableReview();
  }
  async function lookup(userId: string): Promise<LookupResult> {
    if (deps.lookupStudent) return deps.lookupStudent(userId);
    return lookupStudent(userId, config);
  }
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, time: new Date().toISOString() }),
  );
  app.get("/api/session", async (req, res) => {
    const actor = await actorOf(req);
    res.json({
      session: sessionView(
        actor,
        stationFor(actor, stations),
        deps.provenance ??
          (deps.resolveActor ? "test" : actorProvenance(config, actor)),
      ),
      /** 试用登录是否开放（平台登录接入前默认开放）。 */
      testActors: config.testActors,
    });
  });
  app.post("/api/test-login", async (req, res) => {
    if (!config.testActors) throw new HttpError(403, "当前环境不开放试用登录");
    const name = text(req.body?.name);
    const className = text(req.body?.className);
    const password = text(req.body?.password);
    if (!name || !className || !password)
      throw new HttpError(400, "请填写姓名、班级和密码");
    const account = findTrialByProfile(name, className);
    if (!account) throw new HttpError(401, "姓名或班级不正确");
    const passwords = await loadTestPasswords(config.dataDir);
    if (passwords[account.key] !== password)
      throw new HttpError(401, "密码不正确");
    res.json({
      ok: true,
      actorKey: account.key,
      account: { name: account.name, className: account.className },
    });
  });
  app.post("/api/test-password", async (req, res) => {
    if (!config.testActors)
      throw new HttpError(403, "当前环境不开放修改试用密码");
    const actor = await actorOf(req);
    if (actor.kind !== "student" || !actor.userId)
      throw new HttpError(401, "请先登录试用账号");
    const account = trialAccounts().find((row) => {
      const fixture = FIXTURE_ACTORS[row.key];
      return fixture?.userId === actor.userId;
    });
    if (!account) throw new HttpError(403, "当前账号不能修改试用密码");
    const currentPassword = text(req.body?.currentPassword);
    const newPassword = text(req.body?.newPassword);
    if (!currentPassword || !newPassword)
      throw new HttpError(400, "请填写当前密码和新密码");
    if (newPassword.length < 3 || newPassword.length > 32)
      throw new HttpError(400, "新密码长度需在 3–32 个字符");
    const passwords = await loadTestPasswords(config.dataDir);
    if (passwords[account.key] !== currentPassword)
      throw new HttpError(401, "当前密码不正确");
    passwords[account.key] = newPassword;
    await saveTestPasswords(config.dataDir, passwords);
    res.json({ ok: true });
  });
  app.use("/api/ai", aiRouter(config, upstream));
  app.post("/api/feedback", async (req, res) => {
    const message = text(req.body?.message).slice(0, 1000);
    if (!message) throw new HttpError(400, "请填写反馈内容");
    await store.addFeedback({
      id: randomUUID(),
      name: text(req.body?.name).slice(0, 40),
      contact: text(req.body?.contact).slice(0, 80),
      message,
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  });
  app.get("/api/directory/students", async (req, res) => {
    const actor = await actorOf(req);
    if (actor.kind !== "admin") throw new HttpError(403, "需要管理员权限");
    const userId = text(req.query.userId);
    if (!userId)
      throw new HttpError(400, "请按平台用户 ID 查找，不能列出全部学生");
    const found = await lookup(userId);
    if (found.status === "unavailable")
      throw new HttpError(
        503,
        "学生名单检索尚未由平台提供，请转平台方确认，不能在本地新建学生账号",
      );
    if (found.status === "absent") throw new HttpError(404, "平台没有这名学生");
    res.json({ student: found.student });
  });
  app.get("/api/items", async (req, res) => {
    const actor = await actorOf(req);
    const items = (await store.list())
      .filter((record) => canRead(record, actor))
      .map((record) => publicItem(record, actor))
      .sort(
        (a, b) =>
          rank[a.status] - rank[b.status] ||
          Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
    res.json({ items });
  });
  app.get("/api/items/:id", async (req, res) => {
    const actor = await actorOf(req);
    const record = requireRecord(await store.read(text(req.params.id)));
    if (!canRead(record, actor)) throw new HttpError(404, "帖子不存在");
    res.json({ item: publicItem(record, actor) });
  });
  registerFoundRoutes(app, {
    config,
    store,
    actorOf,
    review,
    stations,
  });
  registerClaimRoutes(app, { store, actorOf, lookup, stationUserIds });
  app.delete("/api/items/:id", async (req, res) => {
    const actor = await actorOf(req);
    if (actor.kind === "guest" || !actor.userId)
      throw new HttpError(403, "需要学校平台登录，当前尚未接入");
    let image = "";
    await store.mutate(text(req.params.id), (current) => {
      const row = normalizeRecord(requireRecord(current)).item;
      const admin = actor.kind === "admin";
      if (!admin && actor.userId !== row.owner_id)
        throw new HttpError(403, "无权删除");
      if (!admin && row.status === "claimed")
        throw new HttpError(403, "已交付的物品只能由管理员删除");
      image = row.image;
      return null;
    });
    await store.removeImage(image);
    res.json({ ok: true });
  });
  app.get("/uploads/:name", async (req, res) => {
    const name = text(req.params.name);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) || name.includes(".."))
      throw new HttpError(404, "图片不存在");
    const url = `/uploads/${name}`;
    const actor = await actorOf(req);
    const visible = (await store.list()).some((record) => {
      const row = normalizeRecord(record).item;
      return (
        canRead(record, actor) &&
        row.image === url &&
        row.status !== "withdrawn" &&
        isApprovedVersion({
          revision: row.revision || 1,
          publication: row.publication ?? null,
        })
      );
    });
    if (!visible) throw new HttpError(404, "图片不存在");
    const file = path.join(config.dataDir, "uploads", name);
    try {
      await access(file);
    } catch {
      throw new HttpError(404, "图片不存在");
    }
    res.sendFile(file);
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  return app;
}
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status =
    err instanceof HttpError
      ? err.status
      : err?.type === "entity.too.large"
        ? 413
        : err?.name === "MulterError"
          ? 400
          : err?.name === "TimeoutError" || err?.name === "AbortError"
            ? 504
            : err instanceof SyntaxError
              ? 400
              : 500;
  if (status >= 500)
    console.error(
      "请求处理失败:",
      err instanceof HttpError ? err.message : err?.name || "Error",
    );
  res.status(status).json({
    error:
      err instanceof HttpError
        ? err.message
        : status === 413
          ? "上传内容过大"
          : status === 504
            ? "AI 请求超时，请稍后重试"
            : status === 400
              ? "请求格式或上传图片不正确"
              : "保存或读取失败，请检查服务器数据目录",
  });
};
