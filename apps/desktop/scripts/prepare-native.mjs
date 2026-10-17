import { createRequire } from "node:module";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronVersion = require("electron/package.json").version;
const storeRequire = createRequire(
  resolve(root, "../../packages/event-store/package.json"),
);
const sqliteSource = dirname(
  storeRequire.resolve("better-sqlite3/package.json"),
);
const sqliteVersion = JSON.parse(
  readFileSync(resolve(sqliteSource, "package.json"), "utf8"),
).version;
const platform =
  process.platform === "linux" &&
  !process.report.getReport().header.glibcVersionRuntime
    ? "linuxmusl"
    : process.platform;
const source = resolve(
  sqliteSource,
  `prebuilds/${platform}-${process.arch}.node`,
);
if (!existsSync(source))
  throw new Error("No official SQLite Node-API binary for this platform.");
const nativeRoot = resolve(root, ".native");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const signature = `${process.platform}-${process.arch}-${electronVersion}-${sqliteVersion}-${digest(readFileSync(source))}`;
const marker = resolve(nativeRoot, "version.txt");
const binding = resolve(
  nativeRoot,
  "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
);
if (
  !existsSync(binding) ||
  !existsSync(marker) ||
  readFileSync(marker, "utf8") !== signature
) {
  mkdirSync(dirname(binding), { recursive: true });
  copyFileSync(source, binding);
  if (digest(readFileSync(binding)) !== digest(readFileSync(source)))
    throw new Error("SQLite copy integrity check failed.");
  writeFileSync(marker, signature);
}
console.log(`Official SQLite Node-API binary prepared: ${signature}`);
