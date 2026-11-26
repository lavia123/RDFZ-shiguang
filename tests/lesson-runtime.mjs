const { fetch, setTimeout, FormData, Blob } = globalThis;
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
test("isolated Lesson package serves mounted assets and hands its data lease to a candidate", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "shiguang-lesson-"));
  const children = new Set();
  t.after(async () => {
    for (const child of children) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    await rm(root, { recursive: true, force: true });
  });
  await cp("dist", path.join(root, "release"), { recursive: true });
  const token = randomUUID(),
    id = "l_runtime_test",
    prefix = "/lesson-app/" + id;
  const dataRoot = path.join(root, "opus");
  async function launch() {
    const port = await unusedPort();
    const child = spawn(
      process.execPath,
      [path.join(root, "release/server/index.mjs")],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          PORT: String(port),
          RDFZ_LESSON_ID: id,
          RDFZ_APPLICATION_TOKEN: token,
          RDFZ_OPUS_ROOT: dataRoot,
        },
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    children.add(child);
    const url = `http://127.0.0.1:${port}`;
    const request = (route, init = {}) =>
      fetch(url + prefix + route, {
        ...init,
        headers: init.headers,
      });
    for (let i = 0; ; i++) {
      try {
        if ((await request("/api/health")).ok) break;
      } catch {
        /* startup */
      }
      if (i > 100 || child.exitCode !== null)
        throw Error("candidate failed to become healthy");
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    async function stop() {
      const exit = once(child, "exit");
      child.kill("SIGTERM");
      const [code] = await exit;
      children.delete(child);
      assert.equal(code, 0);
    }
    return { request, stop, url };
  }
  const old = await launch();
  await assert.rejects(access(dataRoot));
  assert.equal((await fetch(old.url + "/api/health")).status, 404);
  const entry = await old.request("", { redirect: "manual" });
  assert.equal(entry.status, 200);
  const html = await entry.text();
  assert.match(html, /id="root"/);
  // This test is built with the real, no-trailing-slash Lesson mount.
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  assert.ok(asset.startsWith(prefix + "/"));
  assert.equal((await fetch(old.url + asset)).status, 200);
  assert.equal((await old.request("/intro.html")).status, 200);
  const form = new FormData();
  for (const [key, value] of Object.entries({
    ownerId: "pub_runtime",
    description: "Lesson integration test",
    office: "图书馆总服务台",
    place: "图书馆",
  }))
    form.set(key, value);
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  form.set("image", new Blob([image], { type: "image/png" }), "test.png");
  const created = await old.request("/api/items", {
    method: "POST",
    headers: { "X-Publisher-Id": "pub_runtime", "X-Test-Actor": "student" },
    body: form,
  });
  assert.equal(created.status, 403);
  const feedback = await old.request("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "runtime lease" }),
  });
  assert.equal(feedback.status, 200);
  const candidate = await launch();
  assert.equal((await candidate.request("/api/health")).status, 200);
  await old.stop();
  const session = await (await candidate.request("/api/session")).json();
  assert.equal(session.session.kind, "guest");
  assert.equal(session.session.platformLogin, "pending");
  const list = await (await candidate.request("/api/items")).json();
  assert.deepEqual(list.items, []);
  await candidate.stop();
  const restarted = await launch();
  assert.deepEqual(
    (await (await restarted.request("/api/items")).json()).items,
    [],
  );
  await restarted.stop();
});
