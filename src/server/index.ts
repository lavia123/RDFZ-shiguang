import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import express from "express";
import { configFromEnv } from "./config.js";
import { errorHandler } from "./app.js";
import { createBusinessRuntime } from "./business-runtime.js";
import { readPlatformScope, verifyPlatformToken } from "./platform-bridge.js";
import { platformScope } from "./platform-scope.js";
import { sessionView } from "../shared/identity.js";
import { HttpError } from "./errors.js";

const config = configFromEnv();
const platform = !!process.env.RDFZ_APPLICATION_TOKEN;
const runtimes = new Map<
  string,
  Promise<Awaited<ReturnType<typeof createBusinessRuntime>>>
>();
function businessFor(dataDir: string) {
  let pending = runtimes.get(dataDir);
  if (!pending) {
    const scoped = {
      ...config,
      dataDir,
      ...(platform
        ? { testActors: false, testReviewAllow: false, devActor: "" }
        : {}),
    };
    pending = platformScope
      .exit(() => createBusinessRuntime(scoped, platform))
      .catch((error) => {
        runtimes.delete(dataDir);
        throw error;
      });
    runtimes.set(dataDir, pending);
  }
  return pending;
}
async function closeRuntimes() {
  await Promise.all(
    [...runtimes.values()].map(async (value) => {
      const runtime = await value.catch(() => null);
      await runtime?.close();
    }),
  );
}

try {
  const app = express();
  const routes = express.Router();
  if (platform)
    routes.use((req, _res, next) => {
      try {
        verifyPlatformToken(req);
        next();
      } catch (error) {
        next(error);
      }
    });
  // Candidate health must not acquire any active release's data lease.
  routes.get("/api/health", (_req, res) => res.json({ ok: true }));
  const business = express.Router();
  routes.use(async (req, res, next) => {
    if (!req.path.startsWith("/api/") && !req.path.startsWith("/uploads/"))
      return next();
    const controller = new AbortController();
    const abort = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.once("close", abort);
    try {
      if (platform) {
        const scope = readPlatformScope(req, controller.signal);
        if (req.method === "GET" && req.path === "/api/session") {
          res.json({
            session: sessionView(scope.actor, null, "platform"),
            testActors: false,
          });
          return;
        }
        if (scope.actor.kind === "guest")
          throw new HttpError(401, "请先使用平台学生身份登录");
        const runtime = await businessFor(
          path.join(scope.dataRoot, "shiguang-platform"),
        );
        platformScope.run(scope, () => runtime.router(req, res, next));
      } else {
        const runtime = await businessFor(config.dataDir);
        runtime.router(req, res, next);
      }
    } catch (error) {
      next(error);
    }
  });
  routes.use(business);
  app.use(config.basePath || "/", routes);
  const server = createHttpServer(app);
  let closeFrontend = async () => {};
  if (config.production) {
    business.get(["/", "/intro", "/intro.html"], (_req, res) =>
      res.sendFile(path.join(config.publicDir!, "index.html")),
    );
    business.use(
      express.static(config.publicDir!, {
        index: false,
        dotfiles: "deny",
      }),
    );
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      root: config.root,
      server: { middlewareMode: true, hmr: { server } },
      appType: "custom",
    });
    closeFrontend = () => vite.close();
    // Vite serves client source in development, never private runtime/server files.
    business.use((req, res, next) => {
      let requestPath: string;
      try {
        requestPath = path.posix.normalize(decodeURIComponent(req.path));
      } catch {
        res.status(400).json({ error: "无效路径" });
        return;
      }
      const pages = ["/", "/index.html", "/intro", "/intro.html"];
      const prefixes = [
        "/src/client/",
        "/src/shared/",
        "/@vite/",
        "/@id/",
        "/node_modules/",
      ];
      if (
        pages.includes(requestPath) ||
        requestPath === "/@react-refresh" ||
        prefixes.some((prefix) => requestPath.startsWith(prefix))
      )
        next();
      else res.status(404).json({ error: "页面或文件不存在" });
    });
    business.use(vite.middlewares);
    business.get(["/", "/intro", "/intro.html"], async (req, res, next) => {
      try {
        const html = await readFile(
          path.join(config.root, "index.html"),
          "utf8",
        );
        res
          .type("html")
          .send(await vite.transformIndexHtml(req.originalUrl, html));
      } catch (err) {
        next(err);
      }
    });
  }
  app.use((_req, res) => res.status(404).json({ error: "页面或文件不存在" }));
  app.use(errorHandler);
  server.listen(
    config.port,
    config.production && !process.env.RDFZ_LESSON_ID ? "0.0.0.0" : "127.0.0.1",
    () =>
      console.log(
        `拾光已启动：http://localhost:${config.port}\n数据目录：${config.dataDir}\nAI：${config.aiKey ? "DeepSeek 已配置" : "未配置，支持手动填写"}\n身份：${platform ? "平台学生身份" : "独立试用模式"}`,
      ),
  );
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const drained = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    );
    void (async () => {
      try {
        await closeFrontend();
      } finally {
        await drained;
        await closeRuntimes();
      }
      process.exit(0);
    })().catch(() => {
      console.error("关闭服务失败，请检查数据目录锁状态");
      process.exit(1);
    });
  };
  server.on("error", async (err) => {
    console.error("启动失败：", err.message);
    await closeFrontend();
    await closeRuntimes().catch(() => {});
    process.exit(1);
  });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (err) {
  await closeRuntimes();
  throw err;
}
