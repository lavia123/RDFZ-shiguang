import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, validId } from "../storage.js";
import { HttpError } from "../errors.js";
import type { MatchMessage } from "../../shared/messages.js";

export class MessageStore {
  private queues = new Map<string, Promise<unknown>>();

  constructor(private readonly root: string) {}

  async init() {
    await mkdir(path.join(this.root, "messages"), { recursive: true });
    return this;
  }

  private file(id: string) {
    if (!validId(id)) throw new HttpError(400, "无效的消息 ID");
    return path.join(this.root, "messages", `${id}.json`);
  }

  async read(id: string): Promise<MatchMessage | null> {
    let raw: string;
    try {
      raw = await readFile(this.file(id), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const parsed = JSON.parse(raw) as MatchMessage;
    if (!parsed || parsed.id !== id)
      throw new Error(`消息 ${id} 数据损坏`);
    const kind = parsed.kind || "match";
    if (kind === "match" && !parsed.lostPostId)
      throw new Error(`消息 ${id} 数据损坏`);
    if (!parsed.kind) parsed.kind = kind;
    return parsed;
  }

  async list(): Promise<MatchMessage[]> {
    const files = (await readdir(path.join(this.root, "messages"))).filter(
      (n) => n.endsWith(".json"),
    );
    const out: MatchMessage[] = [];
    for (let i = 0; i < files.length; i += 32) {
      const batch = await Promise.all(
        files.slice(i, i + 32).map((n) => this.read(n.slice(0, -5))),
      );
      out.push(...batch.filter((m): m is MatchMessage => m !== null));
    }
    return out;
  }

  async listForUser(userId: string) {
    return (await this.list()).filter((m) => m.recipientUserId === userId);
  }

  async findPair(lostPostId: string, itemId: string) {
    return (
      (await this.list()).find(
        (m) =>
          (m.kind || "match") === "match" &&
          m.lostPostId === lostPostId &&
          m.itemId === itemId,
      ) || null
    );
  }

  async mutate(
    id: string,
    change: (
      current: MatchMessage | null,
    ) => MatchMessage | null | Promise<MatchMessage | null>,
  ) {
    this.file(id);
    const previous = this.queues.get(id) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const next = await change(await this.read(id));
      if (next) {
        if (next.id !== id) throw new Error("消息 ID 不可修改");
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
