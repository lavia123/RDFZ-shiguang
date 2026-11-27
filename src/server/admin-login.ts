import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import type { Request, Response } from "express";
import type { Config } from "./config.js";
import type { PlatformScope } from "./platform-scope.js";
import { HttpError } from "./errors.js";

/** App-owned credentials never replace host validation or widen its data scope. */
export function createAdminLogin(config: Config) {
  const sessions = new Map<string, { scope: string; expires: number }>();
  const attempts = new Map<string, { count: number; expires: number }>();
  const cookie = "shiguang_admin";
  const cookiePath = config.basePath || "/";
  const lifetime = 8 * 60 * 60 * 1000;
  const keyOf = (scope: PlatformScope) =>
    JSON.stringify([
      scope.schoolId,
      scope.dataRoot,
      scope.classIds,
      scope.actor.kind,
      scope.actor.userId ?? null,
      scope.actor.classId ?? null,
    ]);
  const tokenOf = (req: Request) =>
    req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(cookie + "="))
      ?.slice(cookie.length + 1);
  const options = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: config.production,
    path: cookiePath,
  };
  function prune() {
    for (const [key, entry] of sessions)
      if (entry.expires <= Date.now()) sessions.delete(key);
    for (const [key, entry] of attempts)
      if (entry.expires <= Date.now()) attempts.delete(key);
  }
  return {
    handle(req: Request, res: Response, scope: PlatformScope) {
      if (req.path !== "/api/admin/login" && req.path !== "/api/admin/session")
        return false;
      prune();
      if (req.method === "DELETE" && req.path === "/api/admin/session") {
        const token = tokenOf(req);
        if (token) sessions.delete(token);
        res.clearCookie(cookie, options).json({ ok: true });
        return true;
      }
      if (req.method !== "POST" || req.path !== "/api/admin/login")
        throw new HttpError(405, "请求方式不支持");
      if (!config.adminPin)
        throw new HttpError(503, "管理员登录尚未配置，请联系站点维护人员");
      const key = keyOf(scope);
      const attempt = attempts.get(key) ?? {
        count: 0,
        expires: Date.now() + 60_000,
      };
      if (attempt.count >= 10)
        throw new HttpError(429, "尝试过多，请一分钟后再试");
      attempt.count++;
      attempts.set(key, attempt);
      const password =
        typeof req.body?.password === "string" ? req.body.password : "";
      const digest = (value: string) =>
        createHash("sha256").update(value).digest();
      if (
        !password ||
        !timingSafeEqual(digest(password), digest(config.adminPin))
      )
        throw new HttpError(401, "管理员密码错误");
      if (sessions.size >= 1000)
        throw new HttpError(429, "登录会话过多，请稍后再试");
      attempts.delete(key);
      const previous = tokenOf(req);
      if (previous) sessions.delete(previous);
      const token = randomUUID();
      sessions.set(token, { scope: key, expires: Date.now() + lifetime });
      res
        .cookie(cookie, token, { ...options, maxAge: lifetime })
        .json({ ok: true });
      return true;
    },
    apply(req: Request, scope: PlatformScope) {
      prune();
      const token = tokenOf(req) ?? "";
      const entry = sessions.get(token);
      if (!entry) return false;
      if (entry.scope !== keyOf(scope)) {
        sessions.delete(token);
        return false;
      }
      scope.actor = {
        kind: "admin",
        userId: "shiguang_site_admin",
        name: "站点管理员",
        classId: scope.actor.classId ?? scope.classIds?.[0],
        className: scope.actor.className ?? "",
      };
      return true;
    },
  };
}
