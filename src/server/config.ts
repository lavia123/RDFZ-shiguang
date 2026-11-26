import path from "node:path";
export interface Config {
  root: string;
  publicDir?: string;
  basePath?: string;
  dataDir: string;
  port: number;
  /** 不再用于授权。保留字段以免旧环境文件导致启动失败。 */
  adminPin: string;
  tokenSecret: string;
  aiKey: string;
  production: boolean;
  /**
   * 试用登录夹具。学校平台登录接入前默认开启；
   * 设 SHIGUANG_TEST_ACTORS=0 可关闭。不是真实平台登录。
   */
  testActors: boolean;
  /** 试用身份打开且显式允许时，才可跳过尚未接入的审核。 */
  testReviewAllow: boolean;
  /** 本地试用时的默认夹具键。请求没有指定测试身份时才使用。 */
  devActor: string;
}
export const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
export const DEEPSEEK_MODEL = "deepseek-flash";
export function configFromEnv(): Config {
  const root = path.resolve(import.meta.dirname, "../..");
  const port = Number(process.env.PORT || 3080);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT 必须是有效端口");
  const adminPin = process.env.ADMIN_PIN?.trim() || "";
  const tokenSecret = process.env.ADMIN_TOKEN_SECRET?.trim() || "";
  const production =
    process.env.NODE_ENV === "production" ||
    process.argv.includes("--production");
  // 平台登录接入前默认开放试用账号；部署生产环境也可登录拾光。
  const testActors =
    !process.env.RDFZ_APPLICATION_TOKEN &&
    process.env.SHIGUANG_TEST_ACTORS !== "0";
  return {
    root,
    publicDir: path.resolve(import.meta.dirname, "../public"),
    basePath: process.env.RDFZ_LESSON_ID
      ? `/lesson-app/${process.env.RDFZ_LESSON_ID}`
      : "",
    dataDir: path.resolve(
      process.env.RDFZ_OPUS_ROOT || root,
      process.env.DATA_DIR || "data",
    ),
    port,
    adminPin,
    tokenSecret,
    aiKey: process.env.DEEPSEEK_API_KEY?.trim() || "",
    production,
    testActors,
    testReviewAllow: testActors && process.env.SHIGUANG_TEST_REVIEW === "allow",
    devActor:
      testActors && /^[a-z]{1,16}$/.test(process.env.SHIGUANG_DEV_ACTOR || "")
        ? process.env.SHIGUANG_DEV_ACTOR!.trim()
        : "",
  };
}
