import { randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { Request } from "express";
import { HttpError } from "./errors.js";
import { platformScope, type PlatformScope } from "./platform-scope.js";
import type { LookupResult } from "../shared/identity.js";

interface HostContext {
  isAuthor?: boolean;
  sourceId: string;
  opusRootDir: string;
  studentEntry?: unknown;
  dataScope?: {
    schoolId: string;
    dataRoot: string;
    classIds?: string[] | null;
  };
  student?: {
    studentId: string;
    name: string;
    schoolId: string;
    classId: string | null;
    className: string | null;
  } | null;
  teacher?: {
    userId: string;
    classIds: string[] | null;
    classes: { id: string; name: string }[];
  } | null;
}
export function verifyPlatformToken(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
) {
  const expected = env.RDFZ_APPLICATION_TOKEN ?? "",
    actual = String(req.header("x-rdfz-application-token") ?? "");
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  if (!b.length || a.length !== b.length || !timingSafeEqual(a, b))
    throw new HttpError(403, "平台请求校验失败");
}
export function readPlatformScope(
  req: Request,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): PlatformScope {
  verifyPlatformToken(req, env);
  let raw: {
    requestId: string;
    context: HostContext;
    security?: { isTrustedOrigin?: boolean };
  };
  try {
    raw = JSON.parse(
      Buffer.from(
        String(req.header("x-rdfz-application-context") ?? ""),
        "base64url",
      ).toString(),
    );
  } catch {
    throw new HttpError(403, "平台身份信息无效");
  }
  const c = raw.context,
    d = c?.dataScope,
    source = env.RDFZ_LESSON_ID,
    root = env.RDFZ_OPUS_ROOT,
    schools = env.RDFZ_SCHOOL_DATA_ROOT;
  if (
    !source ||
    !root ||
    !schools ||
    c?.sourceId !== source ||
    c.opusRootDir !== root ||
    !c.studentEntry ||
    !d ||
    !raw.requestId ||
    !/^[-a-zA-Z0-9_]+$/.test(source) ||
    !/^[-a-zA-Z0-9_]+$/.test(d.schoolId) ||
    (d.dataRoot !== root &&
      d.dataRoot !== path.join(schools, d.schoolId, "lesson-data", source)) ||
    (d.classIds !== null &&
      (!Array.isArray(d.classIds) ||
        !d.classIds.every((x) => typeof x === "string")))
  )
    throw new HttpError(403, "课件尚未配置有效的平台学生入口");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !raw.security?.isTrustedOrigin
  )
    throw new HttpError(403, "请求来源无效");
  const actor: PlatformScope["actor"] = { kind: "guest" };
  if (c.teacher) {
    if (
      !c.teacher.userId ||
      !Array.isArray(c.teacher.classes) ||
      c.teacher.classIds === null ||
      !c.teacher.classIds.length ||
      c.teacher.classIds.some(
        (id) => d.classIds !== null && !d.classIds!.includes(id),
      )
    )
      throw new HttpError(403, "教师班级范围无效");
    const cls = c.teacher.classes.find((x) => x.id === c.teacher!.classIds![0]);
    if (!cls) throw new HttpError(403, "教师班级范围无效");
    Object.assign(actor, {
      kind: "admin",
      userId: c.teacher.userId,
      name: "教师",
      classId: cls.id,
      className: cls.name,
    });
  } else if (c.student) {
    const s = c.student;
    if (
      !s.studentId ||
      s.schoolId !== d.schoolId ||
      !s.classId ||
      (d.classIds !== null && !d.classIds.includes(s.classId))
    )
      throw new HttpError(403, "学生不在此入口的使用范围内");
    Object.assign(actor, {
      kind: "student",
      userId: s.studentId,
      name: s.name,
      classId: s.classId,
      className: s.className ?? "",
    });
  }
  return {
    requestId: raw.requestId,
    actor,
    schoolId: d.schoolId,
    dataRoot: d.dataRoot,
    classIds: d.classIds!,
    canManageSchoolRecords: Boolean(
      c.teacher && c.isAuthor === true && d.dataRoot === root,
    ),
    signal,
  };
}

const pending = new Map<
  string,
  { resolve: (result: LookupResult) => void; reject: (error: Error) => void }
>();
process.on("message", (message) => {
  const m = message as {
    type?: string;
    id: string;
    value?: LookupResult;
    error?: string;
  };
  if (m?.type !== "lesson:student-lookup-result") return;
  const call = pending.get(m.id);
  if (!call) return;
  if (m.error || !m.value)
    call.reject(new HttpError(503, "学生信息暂时无法读取"));
  else call.resolve(m.value);
});
export async function lookupPlatformStudent(
  userId: string,
): Promise<LookupResult> {
  const scope = platformScope.getStore();
  if (!scope || scope.actor.kind !== "admin" || !process.send)
    throw new HttpError(403, "需要平台教师身份");
  scope.signal.throwIfAborted();
  const id = randomUUID();
  let cleanup = () => {};
  try {
    return await new Promise<LookupResult>((resolve, reject) => {
      const abort = () => reject(new HttpError(503, "学生信息读取已取消"));
      const timer = setTimeout(
        () => reject(new HttpError(503, "学生信息读取超时")),
        15_000,
      );
      cleanup = () => {
        clearTimeout(timer);
        scope.signal.removeEventListener("abort", abort);
        pending.delete(id);
      };
      pending.set(id, { resolve, reject });
      scope.signal.addEventListener("abort", abort, { once: true });
      process.send!(
        {
          type: "lesson:student-lookup",
          id,
          requestId: scope.requestId,
          input: { userId },
        },
        (error) => {
          if (error) reject(new HttpError(503, "平台连接暂时不可用"));
        },
      );
    });
  } finally {
    cleanup();
  }
}
