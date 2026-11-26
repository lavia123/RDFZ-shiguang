import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, validId } from "../storage.js";
import { HttpError } from "../errors.js";
import type { LostPost } from "../../shared/lost.js";

import {
  visibleInScope,
  assertInScope,
  retainRecordScope,
} from "../platform-scope.js";
export class LostStore {
  private queues = new Map<string, Promise<unknown>>();

  constructor(private readonly root: string) {}

  async init() {
    await mkdir(path.join(this.root, "lost"), { recursive: true });
    return this;
  }

  private file(id: string) {
    if (!validId(id)) throw new HttpError(400, "无效的寻物 ID");
    return path.join(this.root, "lost", `${id}.json`);
  }

  async read(id: string): Promise<LostPost | null> {
    const post = await this.readAny(id);
    return post && visibleInScope(post.ownerClassId, post.schoolRecord)
      ? post
      : null;
  }
  private async readAny(id: string): Promise<LostPost | null> {
    let raw: string;
    try {
      raw = await readFile(this.file(id), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const parsed = JSON.parse(raw) as LostPost;
    if (!parsed || parsed.id !== id || typeof parsed.description !== "string")
      throw new Error(`寻物 ${id} 数据损坏`);
    return parsed;
  }

  async list(): Promise<LostPost[]> {
    const files = (await readdir(path.join(this.root, "lost"))).filter((n) =>
      n.endsWith(".json"),
    );
    const out: LostPost[] = [];
    for (let i = 0; i < files.length; i += 32) {
      const batch = await Promise.all(
        files.slice(i, i + 32).map((n) => this.read(n.slice(0, -5))),
      );
      out.push(...batch.filter((p): p is LostPost => p !== null));
    }
    return out;
  }

  async mutate(
    id: string,
    change: (
      current: LostPost | null,
    ) => LostPost | null | Promise<LostPost | null>,
  ) {
    this.file(id);
    const previous = this.queues.get(id) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        const current = await this.readAny(id);
        if (current) assertInScope(current.ownerClassId, current.schoolRecord);
        const next = await change(current);
        if (next) retainRecordScope(current, next);
        if (next) {
          if (next.id !== id) throw new Error("寻物 ID 不可修改");
          await atomicWrite(this.file(id), next);
        } else {
          await rm(this.file(id), { force: true });
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

  async drain() {
    await Promise.allSettled([...this.queues.values()]);
  }
}
