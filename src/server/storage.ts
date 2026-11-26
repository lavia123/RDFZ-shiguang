import {
  mkdir,
  readdir,
  readFile,
  rename,
  open,
  unlink,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import type { Feedback, ItemRecord } from "../shared/types.js";
import { HttpError } from "./errors.js";
export const validId = (id: string) => /^[A-Za-z0-9_-]{1,120}$/.test(id);
export async function atomicWrite(file: string, value: unknown) {
  const payload = JSON.stringify(value, null, 2);
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(tmp, "wx", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}
import {
  visibleInScope,
  assertInScope,
  retainRecordScope,
} from "./platform-scope.js";
export class FileStore {
  private queues = new Map<string, Promise<unknown>>();
  private release?: () => Promise<void>;
  private closing = false;
  private compromised?: Error;
  constructor(public readonly root: string) {}
  async acquire() {
    await mkdir(this.root, { recursive: true });
    this.release = await lockfile.lock(this.root, {
      realpath: true,
      stale: 10000,
      update: 2000,
      retries: 0,
      onCompromised: (err) => {
        this.compromised = err;
      },
    });
    try {
      for (const name of ["items", "uploads", "feedback", "tmp"])
        await mkdir(path.join(this.root, name), { recursive: true });
    } catch (err) {
      await this.close();
      throw err;
    }
    return this;
  }
  private assertOpen() {
    if (this.closing || !this.release || this.compromised)
      throw new HttpError(503, "数据目录未就绪或写入锁已失效");
  }
  itemPath(id: string) {
    if (!validId(id)) throw new HttpError(400, "无效的帖子 ID");
    return path.join(this.root, "items", `${id}.json`);
  }
  async read(id: string): Promise<ItemRecord | null> {
    const record = await this.readAny(id);
    return record &&
      visibleInScope(record.item.ownerClassId, record.item.schoolRecord)
      ? record
      : null;
  }
  private async readAny(id: string): Promise<ItemRecord | null> {
    this.assertOpen();
    let raw: string;
    try {
      raw = await readFile(this.itemPath(id), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new Error(`帖子 ${id} 数据损坏`, { cause });
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("item" in parsed) ||
      !("viewLogs" in parsed)
    )
      throw new Error(`帖子 ${id} 数据损坏`);
    const record = parsed as ItemRecord;
    if (
      record.item?.id !== id ||
      !Array.isArray(record.viewLogs) ||
      typeof record.item.description !== "string"
    )
      throw new Error(`帖子 ${id} 数据损坏`);
    return record;
  }
  async list() {
    this.assertOpen();
    const files = (await readdir(path.join(this.root, "items"))).filter((n) =>
      n.endsWith(".json"),
    );
    const result: ItemRecord[] = [];
    // Bound open file descriptors instead of starting one read per item at once.
    for (let i = 0; i < files.length; i += 32) {
      const batch = await Promise.all(
        files.slice(i, i + 32).map((n) => this.read(n.slice(0, -5))),
      );
      result.push(...batch.filter((r): r is ItemRecord => r !== null));
    }
    return result;
  }
  async mutate(
    id: string,
    change: (
      current: ItemRecord | null,
    ) => ItemRecord | null | Promise<ItemRecord | null>,
  ) {
    this.assertOpen();
    this.itemPath(id);
    const previous = this.queues.get(id) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        if (this.compromised) throw this.compromised;
        const current = await this.readAny(id);
        if (current)
          assertInScope(current.item.ownerClassId, current.item.schoolRecord);
        const next = await change(current);
        if (next) retainRecordScope(current?.item ?? null, next.item);
        if (this.compromised) throw this.compromised;
        if (next) {
          if (next.item.id !== id) throw new Error("帖子 ID 不可修改");
          await atomicWrite(this.itemPath(id), next);
        } else {
          await rm(this.itemPath(id), { force: true });
        }
        return next;
      });
    this.queues.set(id, task);
    try {
      return await task;
    } finally {
      if (this.queues.get(id) === task) this.queues.delete(id);
    }
  }
  async addFeedback(entry: Feedback) {
    this.assertOpen();
    const key = "feedback";
    const previous = this.queues.get(key) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        if (this.compromised) throw this.compromised;
        const dir = path.join(this.root, "feedback");
        await atomicWrite(path.join(dir, `${entry.id}.json`), entry);
        const files = (await readdir(dir)).filter((name) =>
          name.endsWith(".json"),
        );
        if (files.length > 500) {
          const records = await Promise.all(
            files.map(async (name) => ({
              name,
              entry: JSON.parse(
                await readFile(path.join(dir, name), "utf8"),
              ) as Feedback,
            })),
          );
          records.sort(
            (a, b) =>
              b.entry.createdAt.localeCompare(a.entry.createdAt) ||
              b.name.localeCompare(a.name),
          );
          await Promise.all(
            records
              .slice(500)
              .map((record) =>
                rm(path.join(dir, record.name), { force: true }),
              ),
          );
        }
      });
    this.queues.set(key, task);
    try {
      await task;
    } finally {
      if (this.queues.get(key) === task) this.queues.delete(key);
    }
  }
  async removeImage(url: string) {
    if (!/^\/uploads\/[A-Za-z0-9_.-]+$/.test(url)) return;
    try {
      await unlink(path.join(this.root, "uploads", path.basename(url)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("无引用图片清理失败，请检查数据目录权限");
    }
  }
  async close() {
    // Call only after the HTTP server has stopped accepting/drained requests.
    await Promise.allSettled([...this.queues.values()]);
    this.closing = true;
    const release = this.release;
    this.release = undefined;
    if (release && !this.compromised) await release();
  }
}
