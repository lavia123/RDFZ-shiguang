const GREETING_HEAD =
  /^(?:你好呀?|您好呀?|哈喽|hello|hi|请问一下|请问|麻烦你了?|麻烦您了?|麻烦|拜托了?|嗨)/i;

const TRAILING_NOISE =
  /(?:谢谢大家了?|谢谢你了?|谢谢您了?|非常感谢|万分感谢|谢谢了?|拜托了?|拜托|在线等急?|急急急+|急|有好心人看见吗|有好心人捡到吗|有没有好心人|谁看见了吗?|谁捡到了吗?|有没有人看见|帮忙找一下|帮我找一下|帮帮忙|求扩散|扩散一下)+$/g;

const FILLER =
  /(?:那个|然后呢?|就是说?|就是|一下吧?|嗯+|啊+|呢+|吧+|呀+|嘛+|哎+|喔+|哦+)/g;

const IRRELEVANT_CLAUSE =
  /^(?:在线等|急|谢谢|拜托|求扩散|扩散一下|有没有人|谁看见|谁捡到|好心人|帮忙找|帮我找|请帮帮我|请帮帮|拜托大家)(?:.*)?$/;

function cleanClause(part: string): string {
  let text = part.trim();
  if (!text) return "";
  text = text.replace(GREETING_HEAD, "");
  text = text.replace(TRAILING_NOISE, "");
  text = text.replace(FILLER, "");
  text = text.replace(/\s+/g, "").trim();
  if (!text || IRRELEVANT_CLAUSE.test(text)) return "";
  return text;
}

/** 去掉问候、语气词和无关信息，留下还能用来找东西的话。本地规则，不依赖 AI。 */
export function simplifyDescription(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const parts = normalized
    .split(/[，,。！？!?；;、]+/)
    .map(cleanClause)
    .filter(Boolean);
  if (!parts.length) {
    const fallback = cleanClause(normalized.replace(/[，,。！？!?；;、]/g, ""));
    return fallback || normalized;
  }
  const simplified = `${parts.join("，")}。`;
  const compactRaw = normalized.replace(/\s+/g, "");
  if (
    simplified === `${compactRaw}。` ||
    simplified === compactRaw ||
    simplified.replace(/[。，]/g, "") === compactRaw.replace(/[。，]/g, "")
  ) {
    return normalized;
  }
  return simplified;
}
