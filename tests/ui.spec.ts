import { test, expect } from "@playwright/test";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
const localOrigin = "http://127.0.0.1:3188";
async function identity(
  request: import("@playwright/test").APIRequestContext,
  key?: string,
) {
  const response = key
    ? await request.post("/api/development/session", {
        headers: { origin: localOrigin },
        data: { key },
      })
    : await request.delete("/api/development/session", {
        headers: { origin: localOrigin },
      });
  expect(response.ok()).toBe(true);
}
test.beforeEach(async ({ request }) => {
  await identity(request, "teacher");
  const response = await request.get("/api/items");
  for (const item of (await response.json()).items)
    await request.delete("/api/items/" + item.id, {
      headers: { origin: localOrigin },
    });
  await identity(request);
});
async function openAs(page: import("@playwright/test").Page, actor = "") {
  await identity(
    page.request,
    actor === "admin"
      ? "teacher"
      : actor === "other"
        ? "classmate"
        : actor || undefined,
  );
  await page.goto("/");
  await expect(page.locator("#roleBadge")).toBeVisible();
}
test("requires login before browsing and keeps the administrator form", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#loginModal")).toBeVisible();
  await expect(page.locator("#panel-browse")).toHaveCount(0);
  await expect(page.locator("#btnCloseLogin")).toHaveCount(0);
  await page.getByRole("button", { name: "管理员登录", exact: true }).click();
  await expect(page.locator("#loginTitle")).toHaveText("管理员登录");
  await expect(page.locator("#loginName")).toHaveCount(0);
  await expect(page.locator("#loginPassword")).toBeVisible();
});
test("publishes, edits, filters and deletes using the signed-in student flow", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await openAs(page, "student");
  await expect(page.locator("#roleBadge")).toContainText("测试同学");
  await page.locator('[data-panel="found"]').click();
  await expect(page.locator("#foundIdentity")).toContainText("测试同学");
  await page.locator("#btnSubmit").click();
  await expect(page.locator("#toast")).toHaveText("请先拍照或从相册选择图片");
  await page
    .locator("#fileInput")
    .setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#previewImg")).toHaveClass("show");
  await expect(page.locator("#aiStatus")).not.toHaveClass(/thinking/);
  await page.locator("#description").fill("浏览器测试蓝色水杯");
  await expect(page.locator("#office")).toHaveText("逸夫楼316");
  await page.locator("#place").fill("图书馆二楼");
  await page.locator("#btnSubmit").click();
  await expect(page.locator("#panel-history")).toBeVisible();
  const row = page
    .locator(".history-card")
    .filter({ hasText: "浏览器测试蓝色水杯" });
  await expect(row).toBeVisible();
  await row.locator(".btn-edit").click();
  await expect(page.locator("#description")).toHaveValue("浏览器测试蓝色水杯");
  await page.locator("#description").fill("浏览器测试已修改");
  await page.locator("#btnSubmit").click();
  await expect(page.locator("#panel-history")).toBeVisible();
  await page.locator('[data-panel="browse"]').click();
  await page.locator("#searchInput").fill("浏览器测试已修改");
  await expect(page.locator(".item-card")).toHaveCount(1);
  await page.locator(".item-card").click();
  await expect(page.locator("#detailTitle")).toHaveText("浏览器测试已修改");
  await page.locator("#closeDetail").click();
  await page.locator("#searchInput").fill("没有这个测试物品");
  await expect(page.locator("#emptyState")).toBeVisible();
  await page.locator("#clearFilters").click();
  await page.locator('[data-panel="history"]').click();
  await page
    .locator(".history-card")
    .filter({ hasText: "浏览器测试已修改" })
    .locator(".btn-del")
    .click();
  await expect(
    page.locator(".history-card").filter({ hasText: "浏览器测试已修改" }),
  ).toHaveCount(0);
});
test("extracts form text locally and handles camera permission failure", async ({
  page,
}) => {
  await openAs(page, "student");
  await page.locator('[data-panel="found"]').click();
  await page
    .locator("#fillText")
    .fill("在图书馆二楼捡到一个蓝色水杯，联系人小唐，电话13800138000");
  await page.locator("#btnTextExtract").click();
  await expect(page.locator("#office")).toHaveText("逸夫楼316");
  await expect(page.locator("#place")).toHaveValue("图书馆2楼");
  await expect(page.locator("#contact")).toHaveCount(0);
  await page.locator('[data-panel="lost"]').click();
  await page
    .locator("#lostDescription")
    .fill(
      "你好，请问我昨天在图书馆丢了一个蓝色水杯，然后那个杯盖是白色的，谢谢大家",
    );
  await page.locator("#btnSimplify").click();
  await expect(page.locator("#lostDescription")).toHaveValue(
    "我昨天在图书馆丢了一个蓝色水杯，杯盖是白色的。",
  );
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new Error("permission denied"));
  });
  await page.locator('[data-panel="found"]').click();
  await page.locator("#btnCamera").click();
  await expect(page.locator("#toast")).toHaveText(
    "无法打开摄像头，请改用相册上传",
  );
});
test("keeps mobile browsing usable after login", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAs(page, "student");
  await expect(page.locator("#panel-browse")).toBeVisible();
  await page.locator("#backGate").click();
  await expect(page.locator("#panel-browse")).toBeVisible();
  await page.locator('[data-panel="found"]').click();
  await expect(page.locator("#panel-found")).toBeVisible();
});
test("student registers an ordinary claim and admin records the real claimant", async ({
  page,
  request,
  browser,
}) => {
  await identity(request, "student");
  const response = await request.post("/api/items", {
    headers: { origin: localOrigin },
    multipart: {
      description: "管理测试物品",
      office: "图书馆总服务台",
      place: "图书馆二楼",
      image: { name: "fixture.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(response.status()).toBe(201);
  const { item } = await response.json();
  const claimant = await browser.newPage({ baseURL: localOrigin });
  claimant.on("dialog", (dialog) => dialog.accept());
  await openAs(claimant, "other");
  await claimant
    .locator(".item-card")
    .filter({ hasText: "管理测试物品" })
    .click();
  await claimant.locator("#btnSelfClaim").click();
  await expect(claimant.locator("#detailClaimInfo")).toContainText("本人登记");
  await claimant.close();
  const guest = await browser.newPage({ baseURL: localOrigin });
  await guest.goto("/");
  await expect(guest.locator("#loginModal")).toBeVisible();
  await expect(guest.locator(".item-card")).toHaveCount(0);
  await guest.close();
  page.on("dialog", (dialog) => dialog.accept());
  await openAs(page, "admin");
  await page.locator("#navAdmin").click();
  const row = page.locator(".admin-card").filter({ hasText: "管理测试物品" });
  await expect(row).toContainText("同班同学");
  await expect(row).not.toContainText("管理人员");
  await row.locator(".btn-view").click();
  await expect(page.locator("#detailClaimInfo")).toContainText("本人登记");
  await page.locator("#btnAdminDelete").click();
  await expect(page.locator("#detailModal")).toHaveCount(0);
  expect((await request.get("/api/items/" + item.id)).status()).toBe(404);
});
test("kiosk clears the previous student without logging the terminal out", async ({
  page,
}) => {
  await page.clock.install();
  await openAs(page, "kiosk");
  await expect(page.locator("#roleBadge")).toContainText("图书馆");
  await expect(page.locator('[data-panel="messages"]')).toHaveCount(0);
  await page.locator("#description").fill("上一位的水杯");
  await page.locator("#endKiosk").click();
  await expect(page.locator("#description")).toHaveValue("");
  await expect(page.locator("#roleBadge")).toContainText("图书馆");
  await page.locator("#description").fill("下一位的杯子");
  await page.clock.fastForward(120_000);
  await expect(page.locator("#description")).toHaveValue("");
  await expect(page.locator("#roleBadge")).toContainText("图书馆");
});
test("ignores stale AI results after selecting another picture", async ({
  page,
}) => {
  await page.route("**/api/ai/status", (route) =>
    route.fulfill({ json: { configured: true, model: "deepseek-flash" } }),
  );
  let calls = 0;
  await page.route("**/api/ai/vision", async (route) => {
    const number = ++calls;
    if (number === 1) await new Promise((r) => setTimeout(r, 300));
    await route
      .fulfill({ json: { text: number === 1 ? "旧图片结果" : "新图片结果" } })
      .catch(() => {});
  });
  await openAs(page, "student");
  await page.locator('[data-panel="found"]').click();
  await page
    .locator("#fileInput")
    .setInputFiles({ name: "a.png", mimeType: "image/png", buffer: png });
  await expect.poll(() => calls).toBe(1);
  await page
    .locator("#fileInput")
    .setInputFiles({ name: "b.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#description")).toHaveValue("新图片结果");
  await page.waitForTimeout(400);
  await expect(page.locator("#description")).toHaveValue("新图片结果");
  expect(calls).toBe(2);
});
test("intro submits feedback and links to the actual repository", async ({
  page,
}) => {
  await identity(page.request, "student");
  await page.goto("/intro.html");
  await expect(page.locator("#githubLink")).toHaveAttribute(
    "href",
    "https://github.com/lavia123/RDFZ-shiguang",
  );
  await page.locator('[name="message"]').fill("浏览器测试反馈");
  await page.locator("#feedbackForm button").click();
  await expect(page.locator("#formStatus")).toHaveText(
    "已收到，谢谢你的反馈！",
  );
});
test("development server never serves private state or server source", async ({
  request,
}) => {
  for (const url of [
    "/data/items/item_test.json",
    "/.data-ui/items/item_test.json",
    "/src/server/config.ts",
    "/package.json",
    "/.env",
    "/@fs/private/tmp/private-data.json",
    "/api/ai/config",
  ]) {
    const response = await request.get(url);
    expect(response.status()).toBe(404);
  }
});

// The iframe harness models the same-origin host identity event; real server
// credentials and scope isolation are covered by test:lesson.
test("platform gate offers student bridge and independent admin login, refresh and logout", async ({
  page,
}) => {
  let signedIn = false;
  await page.route("**/platform-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<iframe src="/" style="width:100%;height:900px" onload="this.addEventListener(\'rdfz:lesson-identity\',()=>document.body.dataset.studentLogin=\'requested\')"></iframe>',
    }),
  );
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: {
        session: {
          kind: signedIn ? "admin" : "guest",
          userId: signedIn ? "site_admin" : null,
          name: signedIn ? "站点管理员" : "",
          className: "",
          provenance: "platform",
          platformLogin: "ready",
          adminSession: signedIn,
          capabilities: {
            browse: signedIn,
            administer: signedIn,
            publishFound: signedIn,
            claimSelf: false,
            readMessages: signedIn,
          },
        },
      },
    }),
  );
  await page.route("**/api/admin/login", async (route) => {
    signedIn =
      route.request().postDataJSON().password === "browser-test-password";
    await route.fulfill({
      status: signedIn ? 200 : 401,
      json: signedIn ? { ok: true } : { error: "管理员密码错误" },
    });
  });
  await page.route("**/api/admin/session", async (route) => {
    signedIn = false;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/items", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.goto("/platform-harness");
  const app = page.frameLocator("iframe");
  await expect(app.locator("#loginModal")).toBeVisible();
  await expect(app.locator("#panel-browse")).toHaveCount(0);
  await app.getByRole("button", { name: "使用学生身份登录" }).click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-student-login",
    "requested",
  );
  await expect(app.locator("#loginModal")).toBeVisible();
  await app.getByRole("button", { name: "管理员登录", exact: true }).click();
  await app.locator("#loginPassword").fill("incorrect");
  await app.locator("#btnDoLogin").click();
  await expect(app.getByRole("alert")).toHaveText("管理员密码错误");
  await app.locator("#loginPassword").fill("browser-test-password");
  await app.locator("#btnDoLogin").click();
  await expect(app.locator("#roleBadge")).toContainText("站点管理员");
  await page.reload();
  await expect(app.locator("#roleBadge")).toContainText("站点管理员");
  await app.getByRole("button", { name: "切换登录身份" }).click();
  await app.getByRole("button", { name: "退出管理员登录" }).click();
  await expect(app.locator("#loginModal")).toBeVisible();
  await expect(app.locator("#panel-browse")).toHaveCount(0);
});
