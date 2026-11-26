import { appUrl } from "./paths";
import { formatReviewIssue } from "../shared/review-labels";

export interface ApiIssue {
  field: string;
  message: string;
}

export class ApiError extends Error {
  status: number;
  issues: ApiIssue[];
  reviewStatus: string;
  constructor(
    message: string,
    status: number,
    issues: ApiIssue[] = [],
    reviewStatus = "",
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
    this.reviewStatus = reviewStatus;
  }
}

function readIssues(data: unknown): ApiIssue[] {
  if (!data || typeof data !== "object" || !("issues" in data)) return [];
  const issues = (data as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue) => {
    if (!issue || typeof issue !== "object") return [];
    const field =
      "field" in issue && issue.field ? String(issue.field) : "general";
    const message = "message" in issue ? String(issue.message || "").trim() : "";
    return message ? [{ field, message }] : [];
  });
}

/** 发布者身份由服务端会话决定。保留空实现，避免发布模块继续写入匿名 ID。 */
export function getPublisherId() {
  return "";
}
export async function api<T>(
  url: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...init } = options;
  const headers = new Headers(init.headers);
  if (json !== undefined) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(appUrl(url), {
      ...init,
      headers,
      body: json !== undefined ? JSON.stringify(json) : init.body,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error("连不上服务器，请确认拾光服务已启动", { cause: err });
  }
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    status?: string;
  };
  if (!response.ok) {
    const issues = readIssues(data);
    const detail = issues.map(formatReviewIssue).filter(Boolean).join("；");
    throw new ApiError(
      detail || data.error || `请求失败 (${response.status})`,
      response.status,
      issues,
      typeof data.status === "string" ? data.status : "",
    );
  }
  return data;
}
export const message = (err: unknown) =>
  err instanceof Error ? err.message : "操作失败，请稍后重试";
