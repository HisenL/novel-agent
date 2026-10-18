import { build as bundle } from "esbuild";
import { build as packageApp } from "electron-builder";
import { createRequire } from "node:module";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");
const require = createRequire(import.meta.url);
const manifest = JSON.parse(
  readFileSync(join(desktop, "package.json"), "utf8"),
);
const product = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("Windows x64 packaging must run on Windows x64.");
if (manifest.version !== product.version)
  throw new Error("Desktop and product versions must match.");
mkdirSync(join(root, ".tmp"), { recursive: true });
const stage = mkdtempSync(join(root, ".tmp/desktop-package-"));
// Explicit build inputs only: never copy a workspace, desktop settings or history.
mkdirSync(stage, { recursive: true });
await bundle({
  entryPoints: [join(desktop, "src/main.ts"), join(desktop, "src/worker.ts")],
  outdir: join(stage, "dist"),
  outExtension: { ".js": ".mjs" },
  platform: "node",
  format: "esm",
  bundle: true,
  external: ["electron", "better-sqlite3"],
  target: "node22",
  banner: {
    js: 'import { createRequire as __bundleCreateRequire } from "node:module"; const require = __bundleCreateRequire(import.meta.url);',
  },
});
copyFileSync(
  join(desktop, "dist/preload.cjs"),
  join(stage, "dist/preload.cjs"),
);
cpSync(join(desktop, "dist/renderer"), join(stage, "dist/renderer"), {
  recursive: true,
});
const storeRequire = createRequire(
  join(root, "packages/event-store/package.json"),
);
const sqliteRoot = dirname(storeRequire.resolve("better-sqlite3/package.json"));
const sqliteRequire = createRequire(join(sqliteRoot, "package.json"));
const addonRoot = dirname(sqliteRequire.resolve("node-addon-api/package.json"));
for (const [name, source, files] of [
  ["better-sqlite3", sqliteRoot, ["package.json", "LICENSE", "lib"]],
  ["node-addon-api", addonRoot, readdirSync(addonRoot)],
]) {
  const target = join(stage, "node_modules", name);
  mkdirSync(target, { recursive: true });
  for (const file of files)
    cpSync(join(source, file), join(target, file), { recursive: true });
}
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: "novel-agent",
      productName: "Novel Agent",
      version: product.version,
      description: "Local-first desktop agent for novel writing",
      author: "Novel Agent contributors",
      license: "Apache-2.0",
      type: "module",
      main: "dist/main.mjs",
      dependencies: {
        "better-sqlite3": JSON.parse(
          readFileSync(join(sqliteRoot, "package.json"), "utf8"),
        ).version,
      },
    },
    null,
    2,
  ),
);
const licenses = join(stage, "licenses");
mkdirSync(licenses, { recursive: true });
for (const file of ["LICENSE", "NOTICE"])
  copyFileSync(join(root, file), join(licenses, file));
// Retain license texts for dependencies bundled by esbuild/Vite, including transitive packages.
for (const entry of readdirSync(join(root, "node_modules/.pnpm"), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory() || entry.name === "node_modules") continue;
  const modules = join(root, "node_modules/.pnpm", entry.name, "node_modules");
  if (!existsSync(modules)) continue;
  const candidates = [];
  for (const child of readdirSync(modules, { withFileTypes: true })) {
    if (!child.isDirectory() || child.isSymbolicLink()) continue;
    if (child.name.startsWith("@")) {
      for (const scoped of readdirSync(join(modules, child.name)))
        candidates.push(join(modules, child.name, scoped));
    } else candidates.push(join(modules, child.name));
  }
  for (const dependency of candidates) {
    for (const file of readdirSync(dependency)) {
      if (!/^(licen[sc]e|notice|copying)(\.|$)/i.test(file)) continue;
      const destination = join(licenses, entry.name);
      mkdirSync(destination, { recursive: true });
      cpSync(join(dependency, file), join(destination, file), {
        recursive: true,
      });
    }
  }
}
await packageApp({
  projectDir: root,
  config: {
    extends: join(root, "electron-builder.json"),
    directories: { app: stage, output: join(root, ".tmp/releases") },
    electronVersion: require("electron/package.json").version,
    electronDist: dirname(require("electron")),
  },
});
const output = join(root, ".tmp/releases");
const verification = spawnSync(
  process.execPath,
  [join(desktop, "scripts/verify-package.mjs")],
  { stdio: "inherit" },
);
if (verification.error) throw verification.error;
if (verification.status !== 0)
  throw new Error("Packaged resource verification failed.");
const artifacts = ["exe", "zip"].map(
  (extension) => `Novel-Agent-${product.version}-windows-x64.${extension}`,
);
for (const artifact of artifacts)
  if (!existsSync(join(output, artifact)))
    throw new Error(`Missing release artifact: ${artifact}`);
const checksums = artifacts.map(
  (artifact) =>
    `${createHash("sha256")
      .update(readFileSync(join(output, artifact)))
      .digest("hex")}  ${artifact}`,
);
writeFileSync(join(output, "SHA256SUMS.txt"), checksums.join("\n") + "\n");
console.log(`Release ${product.version} prepared in ${output}`);
