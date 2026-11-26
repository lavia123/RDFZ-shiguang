function cleanClause(part: string): string {
  let text = part.trim();
  text = text.replace(/^(?:你好|您好|请问|麻烦你|麻烦您|麻烦)/, "");
  text = text.replace(
    /(?:谢谢大家|谢谢你|谢谢您|谢谢|拜托了|拜托|在线等|帮忙找一下|帮我找一下|有好心人看见吗|有好心人捡到吗)+$/g,
    "",
  );
  text = text.replace(/那个|然后|就是|一下/g, "");
  return text.replace(/\s+/g, "").trim();
}

/** 去掉问候、口头禅和道谢，留下还能用来找东西的话。 */
export function simplifyDescription(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const parts = normalized
    .split(/[，,。！？!?；;]+/)
    .map(cleanClause)
    .filter(Boolean);
  if (!parts.length) return normalized;
  const simplified = `${parts.join("，")}。`;
  return simplified === `${normalized}。` || simplified === normalized
    ? normalized
    : simplified;
}
