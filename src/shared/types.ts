import type { Publication } from "./identity.js";
export type { Publication };
export interface Profile {
  identity: string;
  className: string;
  name: string;
  idNo: string;
  contact: string;
}
export interface Custody {
  heldBy: "finder" | "station" | "teacher";
  location: string;
  receivedAt: string | null;
  receivedByUserId: string | null;
  note: string;
}
export interface DeliveryRecord {
  claimantUserId: string;
  name: string;
  className: string;
  at: string;
  source: "self" | "admin" | "legacy";
  operatorUserId: string;
  note: string;
  active: boolean;
  closedAt: string | null;
  closeReason: string | null;
}
export interface IntentRecord {
  userId: string;
  name: string;
  className: string;
  at: string;
}
export interface Claim {
  claimantUserId: string;
  name: string;
  className: string;
  claimedAt: string;
  source: "self" | "admin" | "legacy";
  claimLabel: string;
  operatorUserId: string;
  note: string;
  identity?: string;
  idNo?: string;
  contact?: string;
  byAdmin?: boolean;
}
export interface Verification {
  verifiedAt: string;
  note: string;
  by: string;
}
export interface ViewLog extends Profile {
  viewerId: string;
  unlockedAt: string;
  viewedFields: string[];
}
export interface Item {
  id: string;
  ownerId: string;
  description: string;
  office: string;
  place: string;
  /** 发布者备注（选填）。 */
  note: string;
  contact: string;
  contactType: string;
  contactValue: string;
  contactVisible: boolean;
  image: string;
  createdAt: string;
  status: "open" | "claimed" | "withdrawn";
  revision: number;
  publication: Publication | null;
  approved: boolean;
  highValue: boolean;
  custody: {
    heldBy: Custody["heldBy"];
    location: string;
    teacherReceived: boolean;
    label: string;
  };
  claim: Claim | null;
  claimVisible: boolean;
  claimLog: DeliveryRecord[];
  intents: IntentRecord[];
  myIntent: boolean;
  isOwner: boolean;
  legacyVerification: { at: string; note: string } | null;
  viewLogs: ViewLog[];
}
export interface ItemRow {
  id: string;
  owner_id: string;
  ownerClassId?: string;
  /** Explicit school-owned record; not assignable by public write APIs. */
  schoolRecord?: true;
  description: string;
  office: string;
  place: string;
  note?: string;
  contact: string;
  contact_type: string;
  contact_value: string;
  contact_scope?: "private" | "station";
  image: string;
  created_at: string;
  status: "open" | "claimed" | "withdrawn";
  revision?: number;
  publication?: Publication | null;
  high_value?: boolean;
  custody?: Custody;
  claim: Claim | DeliveryRecord | null;
  claim_log?: DeliveryRecord[];
  intents?: IntentRecord[];
  verified: Verification | null;
}
export interface ViewLogRow {
  id: string;
  item_id: string;
  viewer_id: string;
  identity: string;
  class_name: string;
  name: string;
  id_no: string;
  contact: string;
  unlocked_at: string;
}
export interface ItemRecord {
  item: ItemRow;
  viewLogs: ViewLogRow[];
}
export interface FillFields {
  place: string;
  office: string;
  contact: string;
  contactType: string;
  contactValue: string;
  note?: string;
}
export interface AiStatus {
  configured: boolean;
  model: string;
}
export interface Feedback {
  id: string;
  name: string;
  contact: string;
  message: string;
  createdAt: string;
}
