/**
 * 平台身份与领取规则的应用内约定。
 * 学校平台尚未交付登录协议。生产环境只解析为游客，不读取客户端自报的
 * userId、姓名、班级或角色。lesson.application.json 的 bridge 不是身份协议。
 *
 * 待平台提供：稳定用户 ID、姓名、班级、登录回传、请求鉴权与校验、
 * 游客可访问范围、管理员与公共终端的授权方式、按 userId 检索学生的接口。
 * 检索未提供时不能在本地新建学生账号。
 */
export const KIOSK_IDLE_MS = 120_000;
export const HIGH_VALUE_KINDS = ["手机", "电脑", "平板", "耳机", "智能手表"] as const;
export type ActorKind = "guest" | "student" | "kiosk" | "admin";
export interface CurrentActor {
  kind: ActorKind;
  userId?: string;
  name?: string;
  className?: string;
  stationId?: string;
}
export interface StationProfile {
  stationId: string;
  userId: string;
  name: string;
  contactName: string;
  contactValue: string;
}
export interface PlatformStudent {
  userId: string;
  name: string;
  className: string;
}
export type LookupResult =
  | { status: "found"; student: PlatformStudent }
  | { status: "absent" }
  | { status: "unavailable" };
export interface ReviewIssue {
  field: string;
  message: string;
}
/** C 实现 reviewSubmission；未接入时结果为 unavailable，不能公开。 */
export interface ReviewCandidate {
  kind: "found" | "lost";
  revision: number;
  texts: Record<string, string>;
  images: string[];
}
export interface ReviewResult {
  status: "allowed" | "rejected" | "uncertain" | "unavailable";
  issues: ReviewIssue[];
}
export interface Publication {
  approvedRevision: number;
  reviewedAt: string;
}
export const guestActor = (): CurrentActor => ({ kind: "guest" });
export function sanitizeActor(actor: CurrentActor | null | undefined): CurrentActor {
  if (!actor || actor.kind === "guest" || !actor.userId)
    return guestActor();
  if (actor.kind === "kiosk" && !actor.stationId) return guestActor();
  return {
    kind: actor.kind,
    userId: actor.userId,
    name: actor.name?.trim() || "",
    className: actor.className?.trim() || "",
    stationId: actor.kind === "kiosk" ? actor.stationId : undefined,
  };
}
export function isApprovedVersion(post: {
  revision: number;
  publication: Publication | null;
}): boolean {
  return (
    !!post.publication && post.publication.approvedRevision === post.revision
  );
}
export function suggestHighValue(description: string): boolean {
  return HIGH_VALUE_KINDS.some((kind) => description.includes(kind));
}
export function resolveHighValue(input: {
  previous: boolean;
  requested: boolean | undefined;
  actor: ActorKind;
}): { ok: true; value: boolean } | { ok: false; error: string } {
  const requested = input.requested ?? input.previous;
  if (input.previous && !requested && input.actor !== "admin")
    return { ok: false, error: "不能取消高价值标记" };
  if (input.actor === "admin") return { ok: true, value: requested };
  return { ok: true, value: input.previous || requested };
}
export function claimLabel(source: "self" | "admin" | "legacy"): string {
  if (source === "self") return "本人登记";
  if (source === "admin") return "老师核对后交给同学";
  return "以前登记的，老师这次没核对";
}
export function custodyLabel(heldBy: "finder" | "station" | "teacher"): string {
  if (heldBy === "teacher") return "已经在老师那里";
  if (heldBy === "station") return "在公共电脑那边，还没交给老师";
  return "还在捡到的同学手里";
}
export interface SessionView {
  kind: ActorKind;
  userId: string | null;
  name: string;
  className: string;
  stationId: string | null;
  stationName: string;
  stationContactName: string;
  stationContactValue: string;
  provenance: "none" | "test";
  platformLogin: "pending";
  capabilities: {
    browse: boolean;
    publishFound: boolean;
    claimSelf: boolean;
    administer: boolean;
    readMessages: boolean;
  };
}
export interface FoundFormContext {
  mode: "personal" | "kiosk" | "admin" | "guest";
  displayName: string;
  className: string;
  stationId: string | null;
  stationName: string;
  stationContactName: string;
  stationContactValue: string;
  platformLogin: "pending";
}
export function sessionView(
  actor: CurrentActor,
  station: StationProfile | null,
  provenance: "none" | "test",
): SessionView {
  const kind = actor.kind;
  return {
    kind,
    userId: actor.userId ?? null,
    name: actor.name ?? "",
    className: actor.className ?? "",
    stationId: actor.stationId ?? null,
    stationName: station?.name ?? "",
    stationContactName: station?.contactName ?? "",
    stationContactValue: station?.contactValue ?? "",
    provenance,
    platformLogin: "pending",
    capabilities: {
      browse: kind !== "kiosk",
      publishFound: kind === "student" || kind === "kiosk" || kind === "admin",
      claimSelf: kind === "student",
      administer: kind === "admin",
      readMessages: kind === "student",
    },
  };
}
export function foundFormContext(session: SessionView): FoundFormContext {
  const mode =
    session.kind === "kiosk"
      ? "kiosk"
      : session.kind === "admin"
        ? "admin"
        : session.kind === "student"
          ? "personal"
          : "guest";
  return {
    mode,
    displayName: session.name,
    className: session.className,
    stationId: session.stationId,
    stationName: session.stationName,
    stationContactName: session.stationContactName,
    stationContactValue: session.stationContactValue,
    platformLogin: "pending",
  };
}
