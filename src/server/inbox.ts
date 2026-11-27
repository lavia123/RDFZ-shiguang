import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { FIXTURE_ACTORS } from "./auth.js";
import { developmentAdminUserIds } from "./development-identity.js";
import { MessageStore } from "./messages/store.js";
import type { InboxKind, MatchMessage } from "../shared/messages.js";
import {
  CLAIM_DISPUTE_OPTION,
  SCHOOL_ADMIN_MAILBOX,
} from "../shared/messages.js";
import { suggestHighValue } from "../shared/identity.js";
import { DEEPSEEK_MODEL, DEEPSEEK_URL } from "./config.js";

/** 管理员收件人：始终含校级共享信箱；本地/试用再叠加夹具名单。 */
export function adminRecipientIds(config: Config): string[] {
  const ids = new Set<string>([SCHOOL_ADMIN_MAILBOX]);
  if (config.testActors) {
    for (const actor of Object.values(FIXTURE_ACTORS)) {
      if (actor.kind === "admin" && actor.userId) ids.add(actor.userId);
    }
  }
  if (config.identityMode === "development") {
    for (const id of developmentAdminUserIds()) ids.add(id);
  }
  return [...ids];
}

export async function createInboxMessage(
  dataDir: string,
  input: {
    kind: InboxKind;
    recipientUserId: string;
    itemId: string;
    reason: string;
    title?: string;
    option?: string;
    fromUserId?: string;
    fromName?: string;
    fromClassName?: string;
    lostPostId?: string;
    batchId?: string;
  },
): Promise<MatchMessage> {
  const store = await new MessageStore(dataDir).init();
  const now = new Date().toISOString();
  const id = "msg_" + randomUUID().replaceAll("-", "").slice(0, 16);
  const msg: MatchMessage = {
    id,
    kind: input.kind,
    lostPostId: input.lostPostId || "",
    itemId: input.itemId,
    recipientUserId: input.recipientUserId,
    lostRevision: 0,
    itemRevision: 0,
    batchId: input.batchId || input.kind,
    reason: input.reason,
    title: input.title,
    option: input.option,
    fromUserId: input.fromUserId,
    fromName: input.fromName,
    fromClassName: input.fromClassName,
    read: false,
    dismissed: false,
    createdAt: now,
    updatedAt: now,
  };
  await store.mutate(id, () => msg);
  return msg;
}

export async function notifyAdminsClaimDispute(
  dataDir: string,
  config: Config,
  input: {
    itemId: string;
    itemDescription: string;
    fromUserId: string;
    fromName: string;
    fromClassName: string;
  },
) {
  const recipients = adminRecipientIds(config);
  for (const recipientUserId of recipients) {
    await createInboxMessage(dataDir, {
      kind: "claim_dispute",
      recipientUserId,
      itemId: input.itemId,
      title: "同学联系管理员",
      option: CLAIM_DISPUTE_OPTION,
      reason: `${input.fromName}（${input.fromClassName || "未分班"}）反馈：${CLAIM_DISPUTE_OPTION}（物品：${input.itemDescription}）`,
      fromUserId: input.fromUserId,
      fromName: input.fromName,
      fromClassName: input.fromClassName,
    });
  }
  return recipients.length;
}

async function aiLikelyHighValue(
  config: Config,
  description: string,
): Promise<boolean | null> {
  if (!config.aiKey) return null;
  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.aiKey}`,
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        thinking: { type: "disabled" },
        temperature: 0,
        max_tokens: 20,
        messages: [
          {
            role: "user",
            content:
              "判断校园失物招领描述是否可能属于高价值物品（如手机、电脑、相机、护照、大量现金、名牌包表等）。只回答 yes 或 no。\n描述：" +
              description.slice(0, 500),
          },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = String(data.choices?.[0]?.message?.content || "")
      .trim()
      .toLowerCase();
    if (text.includes("yes") || text.includes("是")) return true;
    if (text.includes("no") || text.includes("否")) return false;
    return null;
  } catch {
    return null;
  }
}

/** 发布招领后：AI/规则筛高价值，给管理员发消息（不自动标记）。 */
export async function maybeAlertHighValue(
  dataDir: string,
  config: Config,
  item: { id: string; description: string },
) {
  if (suggestHighValue(item.description)) {
    // local heuristic hit
  } else {
    const ai = await aiLikelyHighValue(config, item.description);
    if (ai !== true) return 0;
  }
  const recipients = adminRecipientIds(config);
  for (const recipientUserId of recipients) {
    await createInboxMessage(dataDir, {
      kind: "high_value_alert",
      recipientUserId,
      itemId: item.id,
      title: "可能的高价值物品",
      reason: `系统提示可能为高价值：${item.description}`,
      batchId: "high_value",
    });
  }
  return recipients.length;
}

