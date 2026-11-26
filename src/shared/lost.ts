/** B 寻物模块类型。身份字段由服务端 CurrentActor 写入，不信任客户端自报 ownerId。 */

export type LostStatus = "open" | "found" | "closed";

export interface PublicationRef {
  approvedRevision: number;
}

export interface LostPost {
  id: string;
  ownerId: string;
  ownerClassId?: string;
  schoolRecord?: true;
  ownerName: string;
  ownerClassName: string;
  description: string;
  image: string;
  place: string;
  lostFrom: string | null;
  lostTo: string | null;
  status: LostStatus;
  /** 本人确认经由某条招领找回时填写；不影响招领领取状态。 */
  foundViaItemId: string | null;
  revision: number;
  publication: PublicationRef | null;
  createdAt: string;
  updatedAt: string;
  /**
   * 批次提示：pending_batch=已公开待配对；no_candidates=本批无候选；
   * null=尚无结论或已有消息。不表示匹配成功。
   */
  batchHint: "pending_batch" | "no_candidates" | null;
}

export interface LostPostInput {
  description: string;
  image?: string;
  place?: string;
  lostFrom?: string | null;
  lostTo?: string | null;
}
