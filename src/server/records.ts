import {
  claimLabel,
  custodyLabel,
  isApprovedVersion,
  type CurrentActor,
  type Publication,
} from "../shared/identity.js";
import type {
  Claim,
  Custody,
  DeliveryRecord,
  IntentRecord,
  Item,
  ItemRecord,
  ItemRow,
} from "../shared/types.js";
function publicationOf(value: unknown): Publication | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Publication>;
  if (
    typeof row.approvedRevision !== "number" ||
    typeof row.reviewedAt !== "string"
  )
    return null;
  return {
    approvedRevision: row.approvedRevision,
    reviewedAt: row.reviewedAt,
  };
}
function deliveryFrom(value: unknown, fallbackActive: boolean): DeliveryRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<DeliveryRecord & Claim>;
  const at =
    typeof row.at === "string"
      ? row.at
      : typeof row.claimedAt === "string"
        ? row.claimedAt
        : "";
  if (!at) return null;
  const source =
    row.source === "self" || row.source === "admin" || row.source === "legacy"
      ? row.source
      : "legacy";
  return {
    claimantUserId:
      typeof row.claimantUserId === "string" ? row.claimantUserId : "",
    name: typeof row.name === "string" ? row.name : "",
    className: typeof row.className === "string" ? row.className : "",
    at,
    source,
    operatorUserId:
      typeof row.operatorUserId === "string" ? row.operatorUserId : "",
    note:
      typeof row.note === "string"
        ? row.note
        : "历史登记，未经平台身份核验，不视为老师已核验",
    active: typeof row.active === "boolean" ? row.active : fallbackActive,
    closedAt: typeof row.closedAt === "string" ? row.closedAt : null,
    closeReason: typeof row.closeReason === "string" ? row.closeReason : null,
  };
}
export function normalizeRecord(record: ItemRecord): ItemRecord {
  const row = record.item;
  const revision =
    typeof row.revision === "number" && row.revision >= 1 ? row.revision : 1;
  const office = row.office || "";
  const custody: Custody = row.custody?.heldBy
    ? {
        heldBy: row.custody.heldBy,
        location: row.custody.location || office,
        receivedAt: row.custody.receivedAt ?? null,
        receivedByUserId: row.custody.receivedByUserId ?? null,
        note: row.custody.note || "",
      }
    : {
        heldBy: "finder",
        location: office,
        receivedAt: null,
        receivedByUserId: null,
        note: "",
      };
  const logged = Array.isArray(row.claim_log)
    ? row.claim_log.flatMap((entry) => {
        const delivery = deliveryFrom(entry, false);
        return delivery ? [delivery] : [];
      })
    : [];
  const claimLog =
    logged.length > 0
      ? logged
      : (() => {
          const legacy = deliveryFrom(row.claim, true);
          return legacy ? [legacy] : [];
        })();
  const active = claimLog.find((entry) => entry.active) ?? null;
  const item: ItemRow = {
    ...row,
    status:
      row.status === "claimed" || row.status === "withdrawn" ? row.status : "open",
    revision,
    publication: publicationOf(row.publication),
    high_value: row.high_value === true,
    contact_scope: row.contact_scope === "station" ? "station" : "private",
    custody,
    claim: active
      ? {
          claimantUserId: active.claimantUserId,
          name: active.name,
          className: active.className,
          claimedAt: active.at,
          source: active.source,
          claimLabel: claimLabel(active.source),
          operatorUserId: active.operatorUserId,
          note: active.note,
        }
      : null,
    claim_log: claimLog,
    intents: Array.isArray(row.intents) ? row.intents : [],
    verified: row.verified ?? null,
  };
  return { item, viewLogs: Array.isArray(record.viewLogs) ? record.viewLogs : [] };
}
export function canRead(record: ItemRecord, actor: CurrentActor): boolean {
  const row = normalizeRecord(record).item;
  if (actor.kind === "admin") return true;
  if (actor.userId && actor.userId === row.owner_id) return true;
  return isApprovedVersion({ revision: row.revision ?? 1, publication: row.publication ?? null }) && row.status !== "withdrawn";
}
function toClaim(entry: DeliveryRecord): Claim {
  return {
    claimantUserId: entry.claimantUserId,
    name: entry.name,
    className: entry.className,
    claimedAt: entry.at,
    source: entry.source,
    claimLabel: claimLabel(entry.source),
    operatorUserId: entry.operatorUserId,
    note: entry.note,
  };
}
export function publicItem(record: ItemRecord, actor: CurrentActor): Item {
  const normalized = normalizeRecord(record);
  const row = normalized.item;
  const admin = actor.kind === "admin";
  const isOwner = !!actor.userId && actor.userId === row.owner_id;
  const active =
    (row.claim_log ?? []).find((entry) => entry.active) ?? null;
  const claimVisible =
    !!active &&
    (admin || (!!actor.userId && actor.userId === active.claimantUserId));
  const contactVisible = admin || isOwner || row.contact_scope === "station";
  const myIntent = (row.intents ?? []).some(
    (intent) => actor.userId && intent.userId === actor.userId,
  );
  const approved = isApprovedVersion({
    revision: row.revision ?? 1,
    publication: row.publication ?? null,
  });
  return {
    id: row.id,
    ownerId: row.owner_id,
    description: row.description,
    place: row.place,
    office: row.office,
    note: row.note || "",
    image: row.image,
    createdAt: row.created_at,
    status: row.status,
    revision: row.revision ?? 1,
    publication: row.publication ?? null,
    approved,
    highValue: row.high_value === true,
    custody: {
      heldBy: row.custody?.heldBy || "finder",
      location: row.custody?.location || row.office,
      teacherReceived: row.custody?.heldBy === "teacher",
      label: custodyLabel(row.custody?.heldBy || "finder"),
    },
    contact: contactVisible ? row.contact : "",
    contactType: contactVisible ? row.contact_type : "",
    contactValue: contactVisible ? row.contact_value : "",
    contactVisible,
    claim: claimVisible && active ? toClaim(active) : null,
    claimVisible,
    claimLog: admin ? (row.claim_log ?? []) : [],
    intents: admin ? (row.intents ?? []) : [],
    myIntent,
    isOwner,
    legacyVerification:
      admin && row.verified
        ? { at: row.verified.verifiedAt, note: row.verified.note || "" }
        : null,
    viewLogs: admin
      ? normalized.viewLogs
          .slice()
          .sort((a, b) => b.unlocked_at.localeCompare(a.unlocked_at))
          .map((log) => ({
            viewerId: log.viewer_id,
            identity: log.identity || "",
            className: log.class_name || "",
            name: log.name || "",
            idNo: log.id_no || "",
            contact: log.contact || "",
            unlockedAt: log.unlocked_at,
            viewedFields: ["历史查看"],
          }))
      : [],
  };
}
export function activeDelivery(record: ItemRecord): DeliveryRecord | null {
  return (
    normalizeRecord(record).item.claim_log?.find((entry) => entry.active) ??
    null
  );
}
export function isStationUser(userId: string, stationUserIds: string[]): boolean {
  return stationUserIds.includes(userId);
}
export type { IntentRecord };
