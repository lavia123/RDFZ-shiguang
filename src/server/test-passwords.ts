import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 本地开发登录密码；键与 development-identity 的 actor.key 对齐。
 * 管理员可用「学生事务中心」作为处室名登录，映射到 teacher。
 */
export const DEFAULT_TEST_PASSWORDS: Record<string, string> = {
  student: "456",
  classmate: "123",
  teacher: "admin",
};

export type TrialAccount = {
  key: string;
  name: string;
  /** 登录表单填写的班级/处室，可与 actor.className 不同。 */
  className: string;
  kind: "student" | "admin";
};

export function trialAccounts(): TrialAccount[] {
  return [
    {
      key: "student",
      name: "测试同学",
      className: "高一1班",
      kind: "student",
    },
    {
      key: "classmate",
      name: "同班同学",
      className: "高一1班",
      kind: "student",
    },
    {
      key: "teacher",
      name: "测试老师",
      className: "学生事务中心",
      kind: "admin",
    },
  ];
}

function storePath(dataDir: string) {
  return path.join(dataDir, "test-passwords.json");
}

export async function loadTestPasswords(
  dataDir: string,
): Promise<Record<string, string>> {
  const next = { ...DEFAULT_TEST_PASSWORDS };
  try {
    const raw = await readFile(storePath(dataDir), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_TEST_PASSWORDS)) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) next[key] = value.trim();
    }
  } catch {
    // 无文件时用默认密码
  }
  return next;
}

export async function saveTestPasswords(
  dataDir: string,
  passwords: Record<string, string>,
) {
  await mkdir(dataDir, { recursive: true });
  const out: Record<string, string> = {};
  for (const key of Object.keys(DEFAULT_TEST_PASSWORDS)) {
    out[key] = passwords[key] || DEFAULT_TEST_PASSWORDS[key];
  }
  await writeFile(storePath(dataDir), JSON.stringify(out, null, 2) + "\n", "utf8");
}

export function findTrialByProfile(
  name: string,
  className: string,
  kind?: "student" | "admin",
): TrialAccount | null {
  const n = name.trim();
  const c = className.trim();
  return (
    trialAccounts().find(
      (row) =>
        row.name === n &&
        row.className === c &&
        (!kind || row.kind === kind),
    ) || null
  );
}
