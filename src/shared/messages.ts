/** 站内消息：配对提醒、冒领申诉、高价值提示等。 */

export type InboxKind = "match" | "claim_dispute" | "high_value_alert";

export interface MatchMessage {
  id: string;
  /** 缺省视为配对消息，兼容旧数据。 */
  kind?: InboxKind;
  lostPostId: string;
  itemId: string;
  recipientUserId: string;
  lostRevision: number;
  /** 招领内容版本；C 落地前用内容指纹派生的稳定整数。 */
  itemRevision: number;
  batchId: string;
  reason: string;
  /** 展示标题（申诉/高价值等）。 */
  title?: string;
  /** 学生选择的联系选项，如「我的东西被冒领了？」。 */
  option?: string;
  fromUserId?: string;
  fromName?: string;
  fromClassName?: string;
  read: boolean;
  /** 用户标记「不是我的」后，相同版本不再提醒。 */
  dismissed: boolean;
  /** 读取详情时根据最新状态计算，不持久化权威。 */
  stale?: boolean;
  staleReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MatchMessageView extends MatchMessage {
  lostDescription?: string;
  itemDescription?: string;
  itemImage?: string;
  itemPlace?: string;
  itemOffice?: string;
  itemStatus?: string;
}

export const CLAIM_DISPUTE_OPTION = "我的东西被冒领了？";

/** 校级管理员共享信箱：平台模式没有固定管理员名单时也能投递。 */
export const SCHOOL_ADMIN_MAILBOX = "shiguang_school_admin";
