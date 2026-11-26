import { Router } from "express";
import type { Config } from "./config.js";
import { DEEPSEEK_MODEL, DEEPSEEK_URL } from "./config.js";
import { HttpError, text } from "./errors.js";
import type { FillFields } from "../shared/types.js";
export function aiRouter(config: Config, request: typeof fetch = fetch) {
  const router = Router();
  async function completion(messages: unknown[], maxTokens: number) {
    if (!config.aiKey)
      throw new HttpError(503, "还没配好自动识别，请自己填写");
    const response = await request(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.aiKey}`,
      },
      signal: AbortSignal.timeout(40000),
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        thinking: { type: "disabled" },
        temperature: 0.2,
        max_tokens: maxTokens,
        messages,
      }),
    });
    if (!response.ok)
      throw new HttpError(
        502,
        `AI 服务请求失败（${response.status}），请稍后重试`,
      );
    const data = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim())
      throw new HttpError(502, "模型未返回有效结果");
    return content.trim();
  }
  router.get("/status", (_req, res) =>
    res.json({ configured: !!config.aiKey, model: DEEPSEEK_MODEL }),
  );
  router.post("/vision", async (req, res) => {
    const image = text(req.body?.image);
    if (!/^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(image))
      throw new HttpError(400, "缺少有效图片数据");
    const result = await completion(
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "你是校园失物招领助手。请用一句中文描述图片中的物品，突出颜色、物品类型、可见文字或编号。只输出描述本身。示例：粉红色水杯；上面写有1356的饭卡。",
            },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      120,
    );
    res.json({
      text: result
        .replace(/^["'“‘]|["'”’]$/g, "")
        .split("\n")
        .filter(Boolean)[0],
    });
  });
  router.post("/extract", async (req, res) => {
    const transcript = text(req.body?.transcript);
    if (!transcript) throw new HttpError(400, "缺少口述文字");
    if (transcript.length > 10000) throw new HttpError(400, "说明文字过长");
    const prompt =
      "你是校园失物招领表单助手。只根据口述提取捡到地点，不要编造。只输出一个 JSON 对象，不要 Markdown：" +
      '{"place":"捡到地点","office":"逸夫楼316","contact":"","contactType":"","contactValue":""}' +
      "。领取地点固定是逸夫楼316，联系人留空。未提到地点时 place 用空字符串。\n口述内容：" +
      transcript;
    const result = await completion([{ role: "user", content: prompt }], 400);
    const start = result.indexOf("{"),
      end = result.lastIndexOf("}");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(result.slice(start, end + 1));
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
        throw new Error();
    } catch {
      throw new HttpError(502, "模型未返回有效字段");
    }
    const fields: FillFields = {
      place: "",
      office: "",
      contact: "",
      contactType: "",
      contactValue: "",
    };
    for (const key of Object.keys(fields) as (keyof FillFields)[])
      fields[key] = text(parsed[key]);
    res.json(fields);
  });
  return router;
}
