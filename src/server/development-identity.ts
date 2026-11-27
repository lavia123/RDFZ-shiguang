import { randomUUID } from "node:crypto";
import path from "node:path";
import express, { type Request } from "express";
import type { Config } from "./config.js";
import { HttpError, text } from "./errors.js";
import { platformScope, type PlatformScope } from "./platform-scope.js";
import type { CurrentActor, LookupResult } from "../shared/identity.js";
import {
  findTrialByProfile,
  loadTestPasswords,
} from "./test-passwords.js";

export const DEVELOPMENT_STATIONS = [
  {
    stationId: "demo_library",
    userId: "demo_kiosk",
    name: "图书馆招领终端",
    contactName: "图书馆总服务台",
    contactValue: "",
  },
];

const actors = [
  {
    key: "student",
    label: "测试学校 A · 高一1班 · 测试同学",
    schoolId: "demo_a",
    actor: {
      kind: "student",
      userId: "demo_student_a1",
      name: "测试同学",
      classId: "class_a1",
      className: "高一1班",
    },
  },
  {
    key: "classmate",
    label: "测试学校 A · 高一1班 · 同班同学",
    schoolId: "demo_a",
    actor: {
      kind: "student",
      userId: "demo_student_a2",
      name: "同班同学",
      classId: "class_a1",
      className: "高一1班",
    },
  },
  {
    key: "otherclass",
    label: "测试学校 A · 高一2班 · 二班同学",
    schoolId: "demo_a",
    actor: {
      kind: "student",
      userId: "demo_student_a3",
      name: "二班同学",
      classId: "class_a2",
      className: "高一2班",
    },
  },
  {
    key: "teacher",
    label: "测试学校 A · 高一1班 · 测试老师",
    schoolId: "demo_a",
    actor: {
      kind: "admin",
      userId: "demo_teacher_a1",
      name: "测试老师",
      classId: "class_a1",
      className: "高一1班",
    },
  },
  {
    key: "otherteacher",
    label: "测试学校 A · 高一2班 · 二班老师",
    schoolId: "demo_a",
    actor: {
      kind: "admin",
      userId: "demo_teacher_a2",
      name: "二班老师",
      classId: "class_a2",
      className: "高一2班",
    },
  },
  {
    key: "otherschool",
    label: "测试学校 B · 高一1班 · 外校同学",
    schoolId: "demo_b",
    actor: {
      kind: "student",
      userId: "demo_student_b1",
      name: "外校同学",
      classId: "class_b1",
      className: "高一1班",
    },
  },
  {
    key: "schoolteacher",
    label: "测试学校 B · 高一1班 · 外校老师",
    schoolId: "demo_b",
    actor: {
      kind: "admin",
      userId: "demo_teacher_b1",
      name: "外校老师",
      classId: "class_b1",
      className: "高一1班",
    },
  },
  {
    key: "kiosk",
    label: "测试学校 A · 高一1班 · 图书馆公共终端",
    schoolId: "demo_a",
    actor: {
      kind: "kiosk",
      userId: "demo_kiosk",
      name: "图书馆招领终端",
      stationId: "demo_library",
      classId: "class_a1",
      className: "高一1班",
    },
  },
] satisfies {
  key: string;
  label: string;
  schoolId: string;
  actor: CurrentActor;
}[];

/** 本地开发身份里的管理员 userId，供站内信收件。 */
export function developmentAdminUserIds(): string[] {
  return actors
    .filter((entry) => entry.actor.kind === "admin" && entry.actor.userId)
    .map((entry) => entry.actor.userId!);
}

export function lookupDevelopmentStudent(userId: string): LookupResult {
  const scope = platformScope.getStore();
  if (scope?.actor.kind !== "admin") throw new HttpError(403, "需要教师身份");
  const entry = actors.find(
    (entry) =>
      entry.actor.kind === "student" &&
      entry.actor.userId === userId &&
      entry.schoolId === scope.schoolId &&
      scope.classIds?.includes(entry.actor.classId),
  );
  return entry
    ? {
        status: "found",
        student: {
          userId,
          name: entry.actor.name,
          className: entry.actor.className,
        },
      }
    : { status: "absent" };
}

/** Only constructed by an explicitly local, loopback development process. */
export function createDevelopmentIdentity(config: Config) {
  if (config.production || config.identityMode !== "development")
    throw new Error("测试身份仅用于本地开发");
  const sessions = new Map<string, { key: string; expires: number }>();
  const cookieName = `shiguang_dev_${config.port}`;
  const maxAge = 8 * 60 * 60 * 1000;
  const sessionKey = (req: Request) =>
    req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
  const router = express.Router();
  router.use(express.json({ limit: "4kb" }));
  router.get("/actors", (_req, res) =>
    res.json({ actors: actors.map(({ key, label }) => ({ key, label })) }),
  );
  router.use((req, _res, next) => {
    const origins = [
      `http://localhost:${config.port}`,
      `http://127.0.0.1:${config.port}`,
    ];
    if (
      !origins.includes(req.headers.origin ?? "") ||
      !origins.includes(`http://${req.headers.host}`)
    )
      return next(new HttpError(403, "请从本地页面切换测试身份"));
    next();
  });
  router.post("/session", (req, res) => {
    const entry = actors.find((actor) => actor.key === req.body?.key);
    if (!entry) throw new HttpError(400, "请选择已有的测试身份");
    for (const [id, value] of sessions)
      if (value.expires <= Date.now()) sessions.delete(id);
    const previous = sessionKey(req);
    if (previous) sessions.delete(previous);
    if (sessions.size >= 100)
      throw new HttpError(429, "测试会话过多，请重启本地服务");
    const id = randomUUID();
    sessions.set(id, { key: entry.key, expires: Date.now() + maxAge });
    res
      .cookie(cookieName, id, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        maxAge,
      })
      .json({ ok: true });
  });

  /** 学生：姓名+班级+密码；管理员：只校验密码，固定试用老师。 */
  router.post("/login", async (req, res) => {
    const name = text(req.body?.name);
    const className = text(req.body?.className);
    const password = text(req.body?.password);
    const kindRaw = text(req.body?.kind);
    const kind =
      kindRaw === "admin" ? "admin" : kindRaw === "student" ? "student" : undefined;
    if (!password) throw new HttpError(400, "请填写密码");
    let actorKey: string;
    if (kind === "admin") {
      const passwords = await loadTestPasswords(config.dataDir);
      if (passwords.teacher !== password)
        throw new HttpError(401, "密码不对");
      actorKey = "teacher";
    } else {
      if (!name || !className)
        throw new HttpError(400, "请填写姓名、班级以及密码");
      const trial = findTrialByProfile(name, className, kind ?? "student");
      if (!trial)
        throw new HttpError(404, "没有这个试用账号，请核对姓名和班级");
      const passwords = await loadTestPasswords(config.dataDir);
      if (passwords[trial.key] !== password)
        throw new HttpError(401, "密码不对");
      actorKey = trial.key;
    }
    for (const [id, value] of sessions)
      if (value.expires <= Date.now()) sessions.delete(id);
    const previous = sessionKey(req);
    if (previous) sessions.delete(previous);
    if (sessions.size >= 100)
      throw new HttpError(429, "测试会话过多，请重启本地服务");
    const entry = actors.find((actor) => actor.key === actorKey);
    if (!entry) throw new HttpError(400, "请选择已有的测试身份");
    const id = randomUUID();
    sessions.set(id, { key: entry.key, expires: Date.now() + maxAge });
    res
      .cookie(cookieName, id, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        maxAge,
      })
      .json({ ok: true, notice: "已登录" });
  });
  router.delete("/session", (req, res) => {
    sessions.delete(sessionKey(req) ?? "");
    res
      .clearCookie(cookieName, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
      })
      .json({ ok: true });
  });
  return {
    router,
    scope(req: Request, signal: AbortSignal): PlatformScope {
      const value = sessions.get(sessionKey(req) ?? "");
      const entry =
        value && value.expires > Date.now()
          ? actors.find((actor) => actor.key === value.key)
          : undefined;
      const schoolId = entry?.schoolId ?? "demo_a";
      return {
        requestId: randomUUID(),
        actor: entry?.actor ?? { kind: "guest" },
        schoolId,
        dataRoot: path.join(config.dataDir, "schools", schoolId),
        classIds: [entry?.actor.classId ?? "class_a1"],
        signal,
      };
    },
  };
}
