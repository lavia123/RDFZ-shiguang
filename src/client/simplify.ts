const GREETING_HEAD =
  /^(?:你好呀?|您好呀?|哈喽|hello|hi|请问一下|请问|麻烦你了?|麻烦您了?|麻烦|拜托了?|嗨)/i;

const TRAILING_NOISE =
  /(?:谢谢大家了?|谢谢你了?|谢谢您了?|非常感谢|万分感谢|谢谢了?|拜托了?|拜托|在线等急?|急急急+|急|有好心人看见吗|有好心人捡到吗|有没有好心人|谁看见了吗?|谁捡到了吗?|有没有人看见|帮忙找一下|帮我找一下|帮帮忙|求扩散|扩散一下)+$/g;

const FILLER =
  /(?:那个|然后呢?|就是说?|就是|一下吧?|嗯+|啊+|呢+|吧+|呀+|嘛+|哎+|喔+|哦+)/g;

const IRRELEVANT_CLAUSE =
  /^(?:在线等|急+|谢谢|拜托|求扩散|扩散一下|有没有人|谁看见|谁捡到|好心人|帮忙找|帮我找|请帮帮我|请帮帮|拜托大家|昨天|今天|前天|上周|早上|中午|下午|晚上)(?:.*)?$/;

/** 叙事开头：我昨天在某处丢了/弄丢了一个… → 只留物品描述。 */
const STORY_PREFIX =
  /^(?:我)?(?:昨天|今天|前天|刚才|早上|中午|下午|晚上)?(?:在(?!丢|弄丢|不见|找不到|捡到).{0,24}?)?(?:不小心)?(?:丢了|弄丢了|不见了|找不到了|捡到了?)(?:一个|一台|一只|一条|一件)?/;

const PLACE_ONLY =
  /^(?:在)?.{2,24}(?:图书馆|食堂|教室|宿舍|操场|走廊|门口|自习室|逸夫楼|教学楼)$/;

/** 是否像「失物本身」的颜色/样式/特征描述。 */
function isItemFeature(text: string): boolean {
  if (
    /[色式型号金银黑白红蓝绿黄灰粉紫橙棕]|大|小|新|旧|破|划痕|写有|带有|印有|杯|表|机|卡|包|笔|本|伞|瓶|盒|绳|链|镜|帽|鞋|衣|裤|钥|耳机|充电|电脑|书|饭卡|学生证|手机|U盘|鼠标|键盘|手套|围巾|外套|卫衣|校服|\d/.test(
      text,
    )
  )
    return true;
  return text.length > 0 && text.length <= 10 && !PLACE_ONLY.test(text);
}

function cleanClause(part: string): string {
  let text = part.trim();
  if (!text) return "";
  text = text.replace(GREETING_HEAD, "");
  text = text.replace(TRAILING_NOISE, "");
  text = text.replace(STORY_PREFIX, "");
  text = text.replace(FILLER, "");
  text = text.replace(/\s+/g, "").trim();
  if (!text || IRRELEVANT_CLAUSE.test(text) || PLACE_ONLY.test(text)) return "";
  if (!isItemFeature(text)) return "";
  return text;
}

/** 只保留颜色、样式等与失物本身有关的信息。本地规则，不依赖 AI。 */
export function simplifyDescription(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const parts = normalized
    .split(/[，,。！？!?；;、]+/)
    .map(cleanClause)
    .filter(Boolean);
  if (!parts.length) {
    const one = cleanClause(
      normalized.replace(/[，,。！？!?；;、]/g, "").replace(STORY_PREFIX, ""),
    );
    return one || normalized;
  }
  const joined = parts.join("，");
  // 原文本就很短且无标点时，不必强行加句号。
  if (parts.length === 1 && !/[，,。！？!?；;、]/.test(normalized))
    return joined;
  return `${joined}。`;
}
