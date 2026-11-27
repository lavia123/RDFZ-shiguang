import path from "node:path";
export interface Config {
  root: string;
  identityMode?: "platform" | "development" | "standalone";
  publicDir?: string;
  basePath?: string;
  dataDir: string;
  port: number;
  /** 平台运行时本站管理员的密码；未设置时拒绝密码登录。 */
  adminPin: string;
  tokenSecret: string;
  aiKey: string;
  production: boolean;
  /** 仅非生产、且显式打开时允许选择服务端测试身份。不是平台登录。 */
  testActors: boolean;
  /** 仅测试身份打开时，才允许跳过尚未接入的审核。生产环境永远关闭。 */
  testReviewAllow: boolean;
  /** 本地试用时的默认夹具键。请求没有指定测试身份时才使用。 */
  devActor: string;
}
export const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
export const DEEPSEEK_MODEL = "deepseek-flash";
export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv,
): Config {
  const root = path.resolve(import.meta.dirname, "../..");
  const port = Number(env.PORT || 3080);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT 必须是有效端口");
  const adminPin = env.ADMIN_PIN?.trim() || "";
  const tokenSecret = env.ADMIN_TOKEN_SECRET?.trim() || "";
  const production =
    env.NODE_ENV === "production" || argv.includes("--production");
  const platformKeys = [
    "RDFZ_LESSON_ID",
    "RDFZ_APPLICATION_TOKEN",
    "RDFZ_OPUS_ROOT",
    "RDFZ_SCHOOL_DATA_ROOT",
  ];
  const platform = platformKeys.some((key) => env[key] !== undefined);
  if (platform && platformKeys.some((key) => !env[key]?.trim()))
    throw new Error("平台身份配置不完整，请检查 RDFZ 运行环境");
  const development = argv.includes("--local-dev");
  if (development && (production || platform))
    throw new Error("本地测试身份不能用于生产或平台环境");
  const identityMode = platform
    ? "platform"
    : development
      ? "development"
      : "standalone";
  const testActors =
    !production &&
    !platform &&
    !development &&
    env.SHIGUANG_TEST_ACTORS === "1";
  return {
    root,
    identityMode,
    publicDir: path.resolve(import.meta.dirname, "../public"),
    basePath: env.RDFZ_LESSON_ID ? `/lesson-app/${env.RDFZ_LESSON_ID}` : "",
    dataDir: path.resolve(
      env.RDFZ_OPUS_ROOT || root,
      env.DATA_DIR || (development ? ".data-development" : "data"),
    ),
    port,
    adminPin,
    tokenSecret,
    aiKey: env.DEEPSEEK_API_KEY?.trim() || "",
    production,
    testActors,
    testReviewAllow: testActors && env.SHIGUANG_TEST_REVIEW === "allow",
    devActor:
      testActors && /^[a-z]{1,16}$/.test(env.SHIGUANG_DEV_ACTOR || "")
        ? env.SHIGUANG_DEV_ACTOR!.trim()
        : "",
  };
}
