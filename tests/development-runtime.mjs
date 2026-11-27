import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";

test("local identities use the real routes with isolated school/class storage", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "shiguang-development-"));
  const data = path.join(root, ".data-development");
  const socket = createServer().listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/server/index.ts", "--local-dev"],
    {
      env: { PATH: process.env.PATH, PORT: String(port), DATA_DIR: data },
      stdio: "ignore",
    },
  );
  t.after(async () => {
    if (child.exitCode === null) {
      const done = once(child, "exit");
      child.kill("SIGTERM");
      await done;
    }
    await rm(root, { recursive: true, force: true });
  });
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(origin + "/api/health")).ok) break;
    } catch {
      /* starting */
    }
    if (attempt > 150 || child.exitCode !== null)
      throw Error("development server failed to start");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const call = (route, cookie = "", init = {}) =>
    fetch(origin + route, {
      ...init,
      headers: { origin, cookie, ...init.headers },
    });
  const as = async (key) => {
    const response = await call("/api/development/session", "", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    });
    assert.equal(response.status, 200);
    const header = response.headers.get("set-cookie");
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Strict/i);
    return header.split(";")[0];
  };
  const guest = await (await call("/api/session")).json();
  assert.equal(guest.session.kind, "guest");
  assert.equal(guest.session.provenance, "test");
  await assert.rejects(access(path.join(data, "schools"))); // Session/health do not take a data lease.
  assert.equal(
    (
      await call("/api/development/session", "", {
        method: "POST",
        headers: {
          origin: "https://other.invalid",
          "content-type": "application/json",
        },
        body: JSON.stringify({ key: "teacher" }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/development/session", "", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "arbitrary_admin", userId: "forged" }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/api/items", "", {
        method: "POST",
        headers: { "X-Test-Actor": "admin" },
      })
    ).status,
    401,
  );
  const student = await as("student"),
    classmate = await as("classmate"),
    otherclass = await as("otherclass"),
    otherschool = await as("otherschool"),
    teacher = await as("teacher");
  const session = (await (await call("/api/session", student)).json()).session;
  assert.equal(session.userId, "demo_student_a1");
  assert.equal(session.className, "高一1班");
  const form = new FormData();
  form.set("description", "本地测试蓝色水杯");
  form.set("place", "图书馆");
  form.set("ownerId", "forged");
  form.set("schoolRecord", "true");
  form.set(
    "image",
    new Blob(
      [
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          "base64",
        ),
      ],
      { type: "image/png" },
    ),
    "test.png",
  );
  const created = await call("/api/items", student, {
    method: "POST",
    body: form,
  });
  assert.equal(created.status, 201);
  const item = (await created.json()).item;
  assert.equal(item.ownerId, "demo_student_a1");
  for (const [cookie, expected] of [
    [student, 1],
    [classmate, 1],
    [teacher, 1],
    [otherclass, 0],
    [otherschool, 0],
  ]) {
    assert.equal(
      (await (await call("/api/items", cookie)).json()).items.length,
      expected,
    );
    assert.equal((await call(item.image, cookie)).status, expected ? 200 : 404);
  }
  assert.equal(
    (await call(`/api/items/${item.id}`, otherclass, { method: "DELETE" }))
      .status,
    404,
  );
  const record = JSON.parse(
    await readFile(
      path.join(
        data,
        "schools/demo_a/shiguang-platform/items",
        item.id + ".json",
      ),
      "utf8",
    ),
  );
  assert.equal(record.item.ownerClassId, "class_a1");
  assert.equal(record.item.schoolRecord, undefined);
  const lookup = "/api/directory/students?userId=";
  assert.equal((await call(lookup + "demo_student_a1", teacher)).status, 200);
  assert.equal((await call(lookup + "demo_student_a3", teacher)).status, 404);
  assert.equal((await call(lookup + "demo_student_b1", teacher)).status, 404);
  assert.equal((await call(lookup + "demo_student_a1", student)).status, 403);
  const claim = await call(`/api/items/${item.id}/claim`, classmate, {
    method: "POST",
  });
  assert.equal(claim.status, 200);
  assert.equal(
    (await claim.json()).item.claim.claimantUserId,
    "demo_student_a2",
  );
  const lost = await call("/api/lost-posts", student, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ description: "本地测试遗失水杯", place: "操场" }),
  });
  assert.equal(lost.status, 201);
  const lostId = (await lost.json()).post.id;
  assert.equal(
    (await call("/api/lost-posts/" + lostId, otherclass)).status,
    404,
  );
  assert.equal((await call("/api/messages", student)).status, 200);
  assert.equal(
    (await call("/api/development/session", student, { method: "DELETE" }))
      .status,
    200,
  );
  assert.equal(
    (await (await call("/api/session", student)).json()).session.kind,
    "guest",
  );
});
