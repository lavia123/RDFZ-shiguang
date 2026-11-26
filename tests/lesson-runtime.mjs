import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  cp,
  rm,
  access,
  readdir,
  writeFile,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

async function unusedPort() {
  const s = createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}
test("Platform identities, class and school storage, image access, and release handoff", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "shiguang-platform-")),
    children = new Set();
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null) {
        const done = once(child, "exit");
        child.kill("SIGKILL");
        await done;
      }
    }
    await rm(root, { recursive: true, force: true });
  });
  await cp("dist", path.join(root, "release"), { recursive: true });
  const id = "l_runtime_test",
    prefix = "/lesson-app/" + id,
    key = randomUUID(),
    opus = path.join(root, "opus"),
    schools = path.join(root, "schools");
  const student = (
    schoolId = "school_a",
    classId = "class_a1",
    studentId = "stu_a1",
  ) => ({
    studentId,
    name: "平台学生",
    schoolId,
    classId,
    className: "高一1班",
    studentNumber: 1,
  });
  const context = (s = student(), classes = null) => ({
    sourceId: id,
    opusRootDir: opus,
    studentEntry: {
      groupCount: 1,
      pinRefreshRequired: false,
      guestEnabled: false,
    },
    dataScope: {
      schoolId: s?.schoolId ?? "school_a",
      dataRoot:
        s?.schoolId === "school_b"
          ? path.join(schools, "school_b", "lesson-data", id)
          : opus,
      classIds: classes,
    },
    student: s,
  });
  const teacher = {
    ...context(null, ["class_a1"]),
    teacher: {
      userId: "teacher_a",
      classIds: ["class_a1"],
      classes: [{ id: "class_a1", name: "高一1班" }],
    },
  };
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
          RDFZ_APPLICATION_TOKEN: key,
          RDFZ_OPUS_ROOT: opus,
          RDFZ_SCHOOL_DATA_ROOT: schools,
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    children.add(child);
    let lookups = 0;
    child.on("message", (m) => {
      if (m.type === "lesson:student-lookup") {
        lookups++;
        child.send({
          type: "lesson:student-lookup-result",
          id: m.id,
          value: {
            status: "found",
            student: {
              userId: "stu_a1",
              name: "平台学生",
              className: "高一1班",
            },
          },
        });
      }
    });
    const url = `http://127.0.0.1:${port}`;
    const request = (route, ctx = context(null), init = {}, trusted = true) =>
      fetch(url + prefix + route, {
        ...init,
        headers: {
          ...init.headers,
          "x-rdfz-application-token": key,
          "x-rdfz-application-context": Buffer.from(
            JSON.stringify({
              requestId: randomUUID(),
              context: ctx,
              security: { isTrustedOrigin: trusted },
            }),
          ).toString("base64url"),
        },
      });
    for (let n = 0; ; n++) {
      try {
        if ((await request("/api/health")).ok) break;
      } catch {}
      if (n > 100 || child.exitCode !== null)
        throw Error("candidate not healthy");
      await new Promise((r) => setTimeout(r, 30));
    }
    return {
      request,
      url,
      get lookups() {
        return lookups;
      },
      async stop() {
        const done = once(child, "exit");
        child.kill("SIGTERM");
        const [code] = await done;
        children.delete(child);
        assert.equal(code, 0);
      },
    };
  }
  const first = await launch();
  await assert.rejects(access(opus));
  assert.equal((await fetch(first.url + prefix + "/api/session")).status, 403);
  assert.equal((await first.request("/")).status, 200);
  const html = await (await first.request("/")).text();
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  assert.ok(asset.startsWith(prefix + "/"));
  assert.equal((await first.request(asset.slice(prefix.length))).status, 200);
  assert.equal(
    (await (await first.request("/api/session")).json()).session.kind,
    "guest",
  );
  assert.equal(
    (
      await first.request("/api/items", context(null), {
        headers: { "X-Test-Actor": "admin" },
      })
    ).status,
    401,
  );
  const session = await (
    await first.request("/api/session", context(student()))
  ).json();
  assert.equal(session.session.userId, "stu_a1");
  assert.equal(session.session.provenance, "platform");
  assert.equal(session.testActors, false);
  assert.equal(
    (await first.request("/api/session", context(student(), ["class_a2"])))
      .status,
    403,
  );
  assert.equal(
    (
      await first.request("/api/session", {
        ...context(student()),
        dataScope: { schoolId: "school_b", dataRoot: opus, classIds: null },
      })
    ).status,
    403,
  );
  const form = new FormData();
  for (const [k, v] of Object.entries({
    ownerId: "forged",
    schoolRecord: "true",
    name: "伪造姓名",
    className: "伪造班级",
    description: "测试蓝色水杯",
    office: "图书馆总服务台",
    place: "图书馆",
  }))
    form.set(k, v);
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
  const created = await first.request("/api/items", context(student()), {
    method: "POST",
    body: form,
  });
  assert.equal(created.status, 201);
  const item = (await created.json()).item;
  assert.equal(item.ownerId, "stu_a1");
  assert.equal(
    (await first.request(item.image, context(student()))).status,
    200,
  );
  assert.equal((await first.request(item.image, context(null))).status, 401);
  assert.equal(
    (
      await first.request(
        item.image,
        context(student("school_a", "class_a2", "stu_a2"), ["class_a2"]),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await first.request(
        item.image,
        context(student("school_b", "class_b1", "stu_b1")),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await (
        await first.request("/api/items", context(student(), ["class_a1"]))
      ).json()
    ).items.length,
    1,
  );
  assert.equal(
    (
      await (
        await first.request(
          "/api/items",
          context(student("school_a", "class_a2", "stu_a2"), ["class_a2"]),
        )
      ).json()
    ).items.length,
    0,
  );
  assert.equal(
    (
      await first.request(
        "/api/items/" + item.id,
        {
          ...teacher,
          dataScope: { ...teacher.dataScope, classIds: ["class_a2"] },
          teacher: {
            ...teacher.teacher,
            classIds: ["class_a2"],
            classes: [{ id: "class_a2", name: "二班" }],
          },
        },
        { method: "DELETE" },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await first.request(
        "/api/items/" + item.id + "/claim",
        context(student("school_a", "class_a1", "stu_claimant")),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "伪造姓名", className: "伪造班级" }),
        },
        false,
      )
    ).status,
    403,
  );
  const claim = await first.request(
    "/api/items/" + item.id + "/claim",
    context(student("school_a", "class_a1", "stu_claimant")),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "伪造姓名" }),
    },
  );
  assert.equal(claim.status, 200);
  assert.equal((await claim.json()).item.claim.name, "平台学生");
  assert.equal(
    (
      await first.request(
        "/api/directory/students?userId=stu_a1",
        context(student()),
      )
    ).status,
    403,
  );
  const lookup = await first.request(
    "/api/directory/students?userId=stu_a1",
    teacher,
  );
  assert.equal(lookup.status, 200);
  assert.equal(first.lookups, 1);
  const lost = await first.request("/api/lost-posts", context(student()), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      description: "遗失水杯",
      place: "操场",
      ownerId: "forged",
      schoolRecord: true,
    }),
  });
  assert.equal(lost.status, 201);
  const lostPost = (await lost.json()).post;
  assert.equal(lostPost.ownerId, "stu_a1");
  assert.equal(
    (
      await first.request(
        "/api/lost-posts/" + lostPost.id,
        context(student("school_a", "class_a2", "stu_a2"), ["class_a2"]),
      )
    ).status,
    404,
  );
  await assert.rejects(access(path.join(opus, "data")));
  assert.equal(
    (await readdir(path.join(opus, "shiguang-platform", "items"))).length,
    1,
  );
  // School records are explicitly stored by a one-time migration, never inferred
  // from a missing class or accepted from browser-supplied fields.
  const data = path.join(opus, "shiguang-platform");
  const currentRecord = JSON.parse(
    await readFile(path.join(data, "items", item.id + ".json"), "utf8"),
  );
  assert.equal(currentRecord.item.schoolRecord, undefined);
  assert.equal(currentRecord.item.ownerClassId, "class_a1");
  const currentLost = JSON.parse(
    await readFile(path.join(data, "lost", lostPost.id + ".json"), "utf8"),
  );
  assert.equal(currentLost.schoolRecord, undefined);
  const historicalId = "item_school_history";
  await cp(
    path.join(data, item.image.slice(1)),
    path.join(data, "uploads", "school-history.png"),
  );
  const historical = {
    ...currentRecord,
    item: {
      ...currentRecord.item,
      id: historicalId,
      owner_id: "legacy_anonymous",
      ownerClassId: undefined,
      schoolRecord: true,
      image: "/uploads/school-history.png",
      status: "open",
      claim: null,
      claim_log: [],
      created_at: "2020-01-01T00:00:00.000Z",
    },
  };
  await writeFile(
    path.join(data, "items", historicalId + ".json"),
    JSON.stringify(historical),
  );
  await writeFile(
    path.join(data, "items", "item_unassigned.json"),
    JSON.stringify({
      ...historical,
      item: {
        ...historical.item,
        id: "item_unassigned",
        schoolRecord: undefined,
      },
    }),
  );
  const historicalLost = {
    ...currentLost,
    id: "lost_school_history",
    ownerId: "legacy_anonymous",
    ownerClassId: undefined,
    schoolRecord: true,
  };
  await writeFile(
    path.join(data, "lost", historicalLost.id + ".json"),
    JSON.stringify(historicalLost),
  );
  const itemRoute = "/api/items/" + historicalId;
  const lostRoute = "/api/lost-posts/" + historicalLost.id;
  const wholeSchool = context(student());
  const boundClass = context(student(), ["class_a1"]);
  const author = { ...teacher, isAuthor: true };
  assert.equal((await first.request(itemRoute, wholeSchool)).status, 200);
  assert.equal(
    (await first.request("/api/items/item_unassigned", wholeSchool)).status,
    404,
  );
  assert.equal((await first.request(itemRoute, boundClass)).status, 404);
  assert.equal((await first.request(itemRoute, teacher)).status, 404);
  assert.equal((await first.request(itemRoute, author)).status, 200);
  assert.equal((await first.request(lostRoute, wholeSchool)).status, 200);
  assert.equal((await first.request(lostRoute, boundClass)).status, 404);
  assert.equal(
    (await first.request("/uploads/school-history.png", wholeSchool)).status,
    200,
  );
  assert.equal(
    (await first.request("/uploads/school-history.png", boundClass)).status,
    404,
  );
  assert.equal(
    (
      await first.request(
        "/uploads/school-history.png",
        context(student("school_b", "class_b1", "stu_b1")),
      )
    ).status,
    404,
  );
  const claimHistory = await first.request(itemRoute + "/claim", wholeSchool, {
    method: "POST",
  });
  assert.equal(claimHistory.status, 200);
  const claimedHistory = JSON.parse(
    await readFile(path.join(data, "items", historicalId + ".json"), "utf8"),
  );
  assert.equal(claimedHistory.item.owner_id, "legacy_anonymous");
  assert.equal(claimedHistory.item.claim.claimantUserId, "stu_a1");
  assert.equal(claimedHistory.item.schoolRecord, true);
  assert.equal(claimedHistory.item.ownerClassId, undefined);
  const closeLost = {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "closed" }),
  };
  assert.equal(
    (await first.request(lostRoute, wholeSchool, closeLost)).status,
    403,
  );
  assert.equal(
    (await first.request(lostRoute, teacher, closeLost)).status,
    404,
  );
  assert.equal((await first.request(lostRoute, author, closeLost)).status, 200);
  const closedHistory = JSON.parse(
    await readFile(
      path.join(data, "lost", historicalLost.id + ".json"),
      "utf8",
    ),
  );
  assert.equal(closedHistory.schoolRecord, true);
  assert.equal(closedHistory.ownerClassId, undefined);
  assert.equal(closedHistory.ownerId, "legacy_anonymous");
  const candidate = await launch();
  assert.equal((await candidate.request("/api/health")).status, 200);
  await first.stop();
  assert.equal(
    (await (await candidate.request("/api/items", context(student()))).json())
      .items[0].id,
    item.id,
  );
  await candidate.stop();
});
