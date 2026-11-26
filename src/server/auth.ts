import type { Request } from "express";
import type { Config } from "./config.js";
import {
  guestActor,
  sanitizeActor,
  type CurrentActor,
  type LookupResult,
  type PlatformStudent,
  type StationProfile,
} from "../shared/identity.js";
/**
 * 测试夹具只在非生产且显式打开 SHIGUANG_TEST_ACTORS 时生效。
 * 请求头只能选择这里的键，不能传入任意 userId、姓名或角色。
 * 这些不是真实学生，也不能在生产环境当作平台登录。
 */
export const FIXTURE_ACTORS: Record<string, CurrentActor> = {
  student: {
    kind: "student",
    userId: "stu_fixture",
    name: "测试同学",
    className: "测试班级",
  },
  other: {
    kind: "student",
    userId: "stu_other",
    name: "另一同学",
    className: "高二3班",
  },
  kiosk: {
    kind: "kiosk",
    userId: "kiosk_library",
    name: "图书馆招领终端",
    className: "",
    stationId: "station_library",
  },
  admin: {
    kind: "admin",
    userId: "admin_fixture",
    name: "测试老师",
    className: "学生事务中心",
  },
};
export const FIXTURE_STATIONS: StationProfile[] = [
  {
    stationId: "station_library",
    userId: "kiosk_library",
    name: "图书馆招领终端",
    contactName: "图书馆总服务台",
    contactValue: "",
  },
];
export const FIXTURE_STUDENTS: PlatformStudent[] = [
  { userId: "stu_fixture", name: "测试同学", className: "测试班级" },
  { userId: "stu_other", name: "另一同学", className: "高二3班" },
];
export function fixtureActor(key: string): CurrentActor | null {
  if (!/^[a-z]{1,16}$/.test(key)) return null;
  return FIXTURE_ACTORS[key] ? sanitizeActor(FIXTURE_ACTORS[key]) : null;
}
export function resolveActor(req: Request, config: Config): CurrentActor {
  if (config.production || !config.testActors) return guestActor();
  const key = String(req.header("X-Test-Actor") || "").trim();
  if (key) return fixtureActor(key) ?? guestActor();
  return fixtureActor(config.devActor) ?? guestActor();
}
export function actorProvenance(
  config: Config,
  actor: CurrentActor,
): "none" | "test" {
  if (config.production || !config.testActors || actor.kind === "guest")
    return "none";
  return "test";
}
export function lookupStudent(userId: string, config: Config): LookupResult {
  if (config.production || !config.testActors) return { status: "unavailable" };
  const student = FIXTURE_STUDENTS.find((item) => item.userId === userId);
  return student ? { status: "found", student } : { status: "absent" };
}
export function stationFor(
  actor: CurrentActor,
  stations: StationProfile[],
): StationProfile | null {
  if (actor.kind !== "kiosk" || !actor.stationId) return null;
  return stations.find((item) => item.stationId === actor.stationId) ?? null;
}
