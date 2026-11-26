/** Identity is supplied by the Platform server bridge; browser profile fields never grant access. */
export const KIOSK_IDLE_MS = 120_000;
export const HIGH_VALUE_KINDS = [
  "手机",
  "电脑",
  "平板",
  "耳机",
  "智能手表",
] as const;
export type ActorKind = "guest" | "student" | "kiosk" | "admin";
export interface CurrentActor {
  kind: ActorKind;
  userId?: string;
  name?: string;
  className?: string;
  stationId?: string;
  classId?: string;
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
export function sanitizeActor(
  actor: CurrentActor | null | undefined,
): CurrentActor {
  if (!actor || actor.kind === "guest" || !actor.userId) return guestActor();
  if (actor.kind === "kiosk" && !actor.stationId) return guestActor();
  return {
    kind: actor.kind,
    userId: actor.userId,
    name: actor.name?.trim() || "",
    className: actor.className?.trim() || "",
    classId: actor.classId,
    stationId: actor.kind === "kiosk" ? actor.stationId : undefined,
  };
}
export function isApprovedVersion(post: {
  revision: number;
  publication: { approvedRevision: number } | null;
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
  if (source === "admin") return "老师核验后交付";
  return "历史登记（未经平台身份核验）";
}
export function custodyLabel(heldBy: "finder" | "station" | "teacher"): string {
  if (heldBy === "teacher") return "已交到老师处";
  if (heldBy === "station") return "站点保管，尚未确认交到老师";
  return "仍在捡到者处，选择招领处不等于已交存";
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
  provenance: "none" | "test" | "platform";
  platformLogin: "pending" | "ready";
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
  platformLogin: "pending" | "ready";
}
export function sessionView(
  actor: CurrentActor,
  station: StationProfile | null,
  provenance: "none" | "test" | "platform",
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
    platformLogin: provenance === "platform" ? "ready" : "pending",
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
    platformLogin: session.platformLogin,
  };
}
