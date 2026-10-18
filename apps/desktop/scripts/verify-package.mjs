import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const builderRequire = createRequire(import.meta.resolve("electron-builder"));
const libRequire = createRequire(
  builderRequire.resolve("app-builder-lib/package.json"),
);
const { listPackage, extractFile } = libRequire("@electron/asar");
const output = join(root, ".tmp/releases/win-unpacked");
const resources = join(output, "resources");
const archive = join(resources, "app.asar");
for (const file of [
  join(output, "Novel Agent.exe"),
  archive,
  join(resources, "app.asar.unpacked/dist/worker.mjs"),
  join(resources, "app.asar.unpacked/node_modules/better-sqlite3/lib/index.js"),
  join(resources, "native/better_sqlite3.node"),
]) {
  if (!existsSync(file)) throw new Error(`Missing runtime resource: ${file}`);
}
for (const entry of listPackage(archive)) {
  const name = entry.replaceAll("\\", "/");
  if (!/^\/(?:package\.json|dist|node_modules|licenses)(?:\/|$)/.test(name))
    throw new Error(`Unexpected packaged input: ${name}`);
  if (
    /(?:^|\/)(?:\.novel-agent|\.git|\.env(?:\..*)?|settings\.json)(?:\/|$)|\.(?:sqlite(?:-wal|-shm)?|db|map)$/.test(
      name,
    )
  )
    throw new Error(`Private or development data in package: ${name}`);
}
const { version } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const packagedManifest = JSON.parse(
  extractFile(archive, "package.json").toString("utf8"),
);
if (
  packagedManifest.version !== version ||
  packagedManifest.main !== "dist/main.mjs"
)
  throw new Error("Packaged entry or version mismatch.");
if (!extractFile(archive, "licenses/LICENSE").length)
  throw new Error("Missing project license.");
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
if (
  hash(join(resources, "native/better_sqlite3.node")) !==
  hash(
    join(
      root,
      "apps/desktop/.native/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    ),
  )
)
  throw new Error("Packaged native binary differs from the verified input.");
console.log(
  `Packaged resources and allowlisted inputs verified for ${version}.`,
);
