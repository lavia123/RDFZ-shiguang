import { readFile } from "node:fs/promises";
import { DEEPSEEK_MODEL, DEEPSEEK_URL } from "../config.js";
import type { Config } from "../config.js";
import type {
  ReviewResult,
  ReviewSubmission,
} from "../../shared/publication.js";
import {
  HEURISTIC_REJECT_PATTERNS,
  MODERATION_RULE_VERSION,
  MODERATION_SYSTEM_PROMPT,
} from "./rules.js";
import { parseReviewModelOutput } from "./parse.js";
import { isStagingRef, stagingPath } from "../publication/staging.js";

export function createHeuristicReviewer(): ReviewSubmission {
  return async (candidate) => {
    const blob = Object.values(candidate.textFields).join("\n");
    for (const rule of HEURISTIC_REJECT_PATTERNS) {
      if (rule.re.test(blob) || rule.re.test(candidate.textFields[rule.field] || "")) {
        return {
          status: rule.message.includes("老师") ? "uncertain" : "rejected",
          issues: [{ field: rule.field, message: rule.message }],
        };
      }
    }
    if (candidate.kind === "found" && !candidate.imageRef) {
      return {
        status: "rejected",
        issues: [{ field: "image", message: "招领请上传物品照片" }],
      };
    }
    if (
      candidate.kind === "found" &&
      !String(candidate.textFields.description || "").trim()
    ) {
      return {
        status: "rejected",
        issues: [{ field: "description", message: "请填写物品描述" }],
      };
    }
    return { status: "allowed", issues: [] };
  };
}

export function createUnavailableReviewer(message = "审核服务暂不可用，请稍后重试"): ReviewSubmission {
  return async () => ({
    status: "unavailable",
    issues: [{ field: "general", message }],
  });
}

export function createAiReviewer(
  config: Config,
  request: typeof fetch = fetch,
  options: { stagingRoot?: string } = {},
): ReviewSubmission {
  const root = options.stagingRoot || config.dataDir;
  return async (candidate) => {
    if (!config.aiKey) {
      return {
        status: "unavailable",
        issues: [
          {
            field: "general",
            message: "审核服务未配置，暂不能发布，请稍后重试",
          },
        ],
      };
    }
    try {
      const content: unknown[] = [
        {
          type: "text",
          text:
            `规则版本 ${MODERATION_RULE_VERSION}。kind=${candidate.kind} revision=${candidate.revision}\n` +
            `文字字段：${JSON.stringify(candidate.textFields)}\n` +
            (candidate.imageRef
              ? "下方附带待审图片。请综合图文判断。"
              : "本次无图片，只审文字。"),
        },
      ];
      if (candidate.imageRef && isStagingRef(candidate.imageRef)) {
        const file = stagingPath(root, candidate.imageRef);
        const buf = await readFile(file);
        const b64 = buf.toString("base64");
        content.push({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${b64}` },
        });
      }
      const response = await request(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.aiKey}`,
        },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          thinking: { type: "disabled" },
          temperature: 0.1,
          max_tokens: 500,
          messages: [
            { role: "system", content: MODERATION_SYSTEM_PROMPT },
            { role: "user", content },
          ],
        }),
      });
      if (!response.ok) {
        return {
          status: "unavailable",
          issues: [
            { field: "general", message: "审核服务暂时失败，请稍后重试" },
          ],
        };
      }
      const data = (await response.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) {
        return {
          status: "unavailable",
          issues: [
            { field: "general", message: "审核服务返回异常，请稍后重试" },
          ],
        };
      }
      return parseReviewModelOutput(text);
    } catch {
      return {
        status: "unavailable",
        issues: [
          { field: "general", message: "审核服务超时或异常，请稍后重试" },
        ],
      };
    }
  };
}

/** 有 AI Key 走模型；否则用启发式，避免无平台登录/无 Key 时发布被卡死。 */
export function createDefaultReviewer(
  config: Config,
  request: typeof fetch = fetch,
): ReviewSubmission {
  if (config.aiKey) return createAiReviewer(config, request);
  return createHeuristicReviewer();
}

export function reviewHttpStatus(result: ReviewResult): number {
  if (result.status === "allowed") return 200;
  if (result.status === "unavailable") return 503;
  return 422;
}
