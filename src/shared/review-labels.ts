import type { ReviewIssue } from "./identity.js";

/** 审核字段在页面上的叫法。接口仍用英文字段名。 */
export const REVIEW_FIELD_LABELS: Record<string, string> = {
  description: "物品描述",
  place: "捡到地点",
  office: "领取地点",
  contact: "联系方式",
  contactType: "联系方式",
  contactValue: "联系方式",
  image: "照片",
  general: "这条内容",
  publication: "审核",
  lostFrom: "丢失时间",
  lostTo: "丢失时间",
};

export function formatReviewIssue(issue: ReviewIssue): string {
  const message = issue.message.trim();
  if (!message) return "";
  const label = REVIEW_FIELD_LABELS[issue.field];
  if (
    !label ||
    issue.field === "general" ||
    issue.field === "publication" ||
    message.startsWith(label)
  )
    return message;
  return `${label}：${message}`;
}
