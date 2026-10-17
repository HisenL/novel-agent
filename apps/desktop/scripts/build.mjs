import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [resolve(root, "src/main.ts"), resolve(root, "src/worker.ts")],
  outdir: resolve(root, "dist"),
  platform: "node",
  format: "esm",
  bundle: true,
  packages: "external",
  target: "node22",
  sourcemap: true,
});
await build({
  entryPoints: [resolve(root, "src/preload.ts")],
  outfile: resolve(root, "dist/preload.cjs"),
  platform: "node",
  format: "cjs",
  bundle: true,
  external: ["electron"],
  target: "node22",
});
await viteBuild({
  root: resolve(root, "src/renderer"),
  base: "./",
  build: { outDir: resolve(root, "dist/renderer"), emptyOutDir: true },
});
