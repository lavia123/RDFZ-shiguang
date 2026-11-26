import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { Request } from "express";
import { FileStore } from "../src/server/storage.js";
import { createApp, errorHandler } from "../src/server/app.js";
import type { Config } from "../src/server/config.js";
import type { ItemRecord } from "../src/shared/types.js";
import {
  FIXTURE_ACTORS,
  FIXTURE_STATIONS,
  FIXTURE_STUDENTS,
} from "../src/server/auth.js";
import { sanitizeActor, type CurrentActor } from "../src/shared/identity.js";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
function testActor(req: Request): CurrentActor {
  const key = String(req.header("X-Test-Actor") || "");
  return sanitizeActor(FIXTURE_ACTORS[key] ?? { kind: "guest" });
}
let root: string, store: FileStore, server: Server, base: string, config: Config;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "shiguang-claims-"));
  store = await new FileStore(root).acquire();
  config = {
    root,
    dataDir: root,
    port: 0,
    adminPin: "",
    tokenSecret: "",
    aiKey: "",
    production: false,
    testActors: false,
    testReviewAllow: false,
    devActor: "",
  };
  const app = createApp(config, store, fetch, {
    resolveActor: testActor,
    reviewSubmission: async (candidate) =>
      candidate.texts.description.includes("拒绝")
        ? {
            status: "rejected",
            issues: [{ field: "description", message: "请修改描述" }],
          }
        : { status: "allowed", issues: [] },
    lookupStudent: async (userId) => {
      const student = FIXTURE_STUDENTS.find((item) => item.userId === userId);
      return student ? { status: "found", student } : { status: "absent" };
    },
    stations: FIXTURE_STATIONS,
  });
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await store.close();
  await rm(root, { recursive: true, force: true });
});
const request = (url: string, body: unknown, actor = "student", method = "POST") =>
  fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", "X-Test-Actor": actor },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
async function publish(actor = "student", fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries({
    description: "蓝色水杯",
    office: "图书馆总服务台",
    place: "图书馆二楼",
    ownerId: "hacker",
    publication: "{\"approvedRevision\":1}",
    ...fields,
  }))
    fd.set(key, value);
  fd.set("image", new Blob([image], { type: "image/png" }), "image.png");
  const response = await fetch(base + "/api/items", {
    method: "POST",
    body: fd,
    headers: {
      "X-Test-Actor": actor,
      "X-Publisher-Id": "hacker",
      "X-Admin-Token": "forged",
    },
  });
  return response;
}
describe("identity, kiosk and delivery", () => {
  it("keeps platform login pending and ignores forged identity headers", async () => {
    const session = await (
      await request("/api/session", undefined, "student", "GET")
    ).json();
    expect(session.session).toMatchObject({
      kind: "student",
      userId: "stu_fixture",
      name: "测试同学",
      className: "测试班级",
      platformLogin: "pending",
    });
    expect(JSON.stringify(session)).not.toMatch(/phone|手机号/);
    const created = await publish("student", { description: "拒绝发布" });
    expect(created.status).toBe(422);
    expect(await store.list()).toHaveLength(0);
    const posted = await publish();
    expect(posted.status).toBe(201);
    const item = (await posted.json()).item;
    expect(item.ownerId).toBe("stu_fixture");
    expect(item.revision).toBe(1);
    expect(item.approved).toBe(true);
  });
  it("does not publish when review is not injected", async () => {
    const bare = createApp(config, store);
    bare.use(errorHandler);
    const extra = bare.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => extra.once("listening", resolve));
    try {
      const url = `http://127.0.0.1:${(extra.address() as { port: number }).port}`;
      const fd = new FormData();
      fd.set("description", "蓝色水杯");
      fd.set("office", "图书馆总服务台");
      fd.set("place", "图书馆");
      fd.set("ownerId", "stu_fixture");
      fd.set("image", new Blob([image], { type: "image/png" }), "image.png");
      const response = await fetch(url + "/api/items", {
        method: "POST",
        body: fd,
        headers: {
          "X-Test-Actor": "student",
          "X-Publisher-Id": "stu_fixture",
        },
      });
      expect(response.status).toBe(403);
      expect(await store.list()).toHaveLength(0);
      const session = await (await fetch(url + "/api/session")).json();
      expect(session.session.kind).toBe("guest");
    } finally {
      await new Promise<void>((resolve) => extra.close(() => resolve()));
    }
  });
  it("blocks ordinary self-claim from guests, kiosks and forged names", async () => {
    const created = await publish();
    const { item } = await created.json();
    expect((await request(`/api/items/${item.id}/claim`, { name: "别人" }, "kiosk")).status).toBe(
      403,
    );
    expect((await request(`/api/items/${item.id}/claim`, { name: "别人" })).status).toBe(200);
    const stored = (await store.read(item.id))!;
    expect(stored.item.revision).toBe(1);
    expect(stored.item.claim_log?.[0]).toMatchObject({
      source: "self",
      name: "测试同学",
      claimantUserId: "stu_fixture",
      operatorUserId: "stu_fixture",
    });
    const seen = await (
      await request(`/api/items/${item.id}`, undefined, "other", "GET")
    ).json();
    expect(seen.item.claim).toBeNull();
    const mine = await (
      await request(`/api/items/${item.id}`, undefined, "student", "GET")
    ).json();
    expect(mine.item.claim.claimLabel).toBe("本人登记");
  });
  it("requires teacher custody and a real student before a high-value delivery", async () => {
    const created = await publish("kiosk", { highValue: "true", description: "黑色手机" });
    expect(created.status).toBe(201);
    const { item } = await created.json();
    expect(item.ownerId).toBe("kiosk_library");
    expect(item.highValue).toBe(true);
    expect(item.custody.teacherReceived).toBe(false);
    expect(item.contact).toBe("图书馆总服务台");
    expect((await request(`/api/items/${item.id}/claim`, {}, "student")).status).toBe(403);
    expect(
      (
        await request(
          `/api/items/${item.id}/deliver`,
          { claimantUserId: "stu_fixture", name: "管理人员", idNo: "admin" },
          "admin",
        )
      ).status,
    ).toBe(409);
    expect(
      (await request(`/api/items/${item.id}/custody`, { heldBy: "teacher" }, "admin"))
        .status,
    ).toBe(200);
    const delivered = await request(
      `/api/items/${item.id}/deliver`,
      { claimantUserId: "kiosk_library", name: "管理人员" },
      "admin",
    );
    expect(delivered.status).toBe(400);
    const [first, second] = await Promise.all([
      request(
        `/api/items/${item.id}/deliver`,
        { claimantUserId: "stu_fixture", name: "管理人员", idNo: "admin" },
        "admin",
      ),
      request(
        `/api/items/${item.id}/deliver`,
        { claimantUserId: "stu_other", name: "管理人员" },
        "admin",
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const stored = (await store.read(item.id))!;
    expect(stored.item.claim_log).toHaveLength(1);
    expect(stored.item.claim_log?.[0]).toMatchObject({
      source: "admin",
      name: expect.stringMatching(/测试同学|另一同学/),
      operatorUserId: "admin_fixture",
    });
    expect(stored.item.claim_log?.[0]?.name).not.toBe("管理人员");
    const corrected = await request(
      `/api/items/${item.id}/claim/correct`,
      {
        claimantUserId:
          stored.item.claim_log?.[0]?.claimantUserId === "stu_fixture"
            ? "stu_other"
            : "stu_fixture",
        reason: "现场核验后更正领取人",
      },
      "admin",
    );
    expect(corrected.status).toBe(200);
    const log = (await store.read(item.id))!.item.claim_log || [];
    expect(log).toHaveLength(2);
    expect(log.filter((entry) => entry.active)).toHaveLength(1);
    expect(log.some((entry) => entry.closeReason === "现场核验后更正领取人")).toBe(
      true,
    );
  });
  it("keeps a legacy admin placeholder as unverified history", async () => {
    const id = "item_legacy";
    await store.mutate(id, () => ({
      item: {
        id,
        owner_id: "stu_fixture",
        description: "旧水杯",
        office: "图书馆总服务台",
        place: "图书馆",
        contact: "",
        contact_type: "",
        contact_value: "",
        image: "/uploads/missing.png",
        created_at: "2026-11-20T08:00:00.000Z",
        status: "claimed",
        claim: {
          identity: "管理员标记",
          className: "",
          name: "管理人员",
          idNo: "admin",
          contact: "—",
          claimedAt: "2026-11-20T09:00:00.000Z",
          byAdmin: true,
        },
        verified: {
          verifiedAt: "2026-11-20T09:10:00.000Z",
          note: "旧锁定",
          by: "admin",
        },
      },
      viewLogs: [],
    } as ItemRecord));
    const admin = await (await request(`/api/items/${id}`, undefined, "admin", "GET")).json();
    expect(admin.item.claim.claimLabel).toBe("历史登记（未经平台身份核验）");
    expect(admin.item.claim.source).toBe("legacy");
    expect(admin.item.legacyVerification.note).toBe("旧锁定");
    expect(admin.item.id).toBe(id);
  });
  it("hides withdrawn and unapproved images, and rejects disabled test headers", async () => {
    const created = await publish();
    const { item } = await created.json();
    expect((await fetch(base + item.image)).status).toBe(200);
    expect((await request(`/api/items/${item.id}/withdraw`, {}, "student")).status).toBe(
      200,
    );
    expect((await fetch(base + item.image)).status).toBe(404);
    expect((await request(`/api/items/${item.id}`, undefined, "other", "GET")).status).toBe(
      404,
    );
    const production = createApp(
      { ...config, production: true, testActors: false, testReviewAllow: false },
      store,
    );
    production.use(errorHandler);
    const extra = production.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => extra.once("listening", resolve));
    try {
      const url = `http://127.0.0.1:${(extra.address() as { port: number }).port}`;
      const session = await (
        await fetch(url + "/api/session", { headers: { "X-Test-Actor": "admin" } })
      ).json();
      expect(session.session.kind).toBe("guest");
      const fd = new FormData();
      fd.set("description", "不该公开");
      fd.set("office", "图书馆总服务台");
      fd.set("place", "图书馆");
      fd.set("ownerId", "admin_fixture");
      fd.set("image", new Blob([image], { type: "image/png" }), "image.png");
      const response = await fetch(url + "/api/items", {
        method: "POST",
        body: fd,
        headers: { "X-Test-Actor": "admin", "X-Publisher-Id": "admin_fixture" },
      });
      expect(response.status).toBe(403);
    } finally {
      await new Promise<void>((resolve) => extra.close(() => resolve()));
    }
  });
});