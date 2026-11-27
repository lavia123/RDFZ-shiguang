import process from "node:process";
import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
await build({
  entryPoints: ["src/server/index.ts"],
  outfile: "dist/server/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["vite"],
  banner: {
    js: 'import { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(import.meta.url);',
  },
});

// sharp loads its native addon and libvips at runtime from the release directory.
const sharpRequire = createRequire(import.meta.resolve("sharp"));
const libc = process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime ? "musl" : "";
const target = `${process.platform}${libc}-${process.arch}`;
const packages = [`@img/sharp-${target}`];
const addon = sharpRequire(packages[0] + "/package");
packages.push(...Object.keys(addon.optionalDependencies ?? {}));
for (const name of packages) {
  const source = path.dirname(sharpRequire.resolve(name + "/package"));
  const destination = path.join("dist/server/node_modules", name);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, dereference: true });
}
