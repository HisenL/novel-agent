import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "../..");
const { version } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const zip = join(root, `.tmp/releases/Novel-Agent-${version}-windows-x64.zip`);
if (!existsSync(zip)) throw new Error("Build the Windows package first.");
const unpacked = mkdtempSync(join(tmpdir(), "novel-agent-packaged-check-"));
const portable = process.argv.includes("--portable");
const executable = join(unpacked, "Novel Agent.exe");
if (portable) {
  copyFileSync(
    join(root, `.tmp/releases/Novel-Agent-${version}-windows-x64.exe`),
    executable,
  );
} else {
  const extraction = spawnSync(
    join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    ),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Expand-Archive -LiteralPath $env:NOVEL_AGENT_RELEASE_ZIP -DestinationPath $env:NOVEL_AGENT_RELEASE_TEST_DIR",
    ],
    {
      env: {
        ...process.env,
        NOVEL_AGENT_RELEASE_ZIP: zip,
        NOVEL_AGENT_RELEASE_TEST_DIR: unpacked,
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (extraction.error) throw extraction.error;
  if (extraction.status !== 0) throw new Error("ZIP extraction failed.");
}
if (!existsSync(executable)) throw new Error("ZIP is missing Novel Agent.exe.");
// Exercise the same 8.3 path aliases returned by Windows hosted runners.
const shortPathResult = spawnSync(
  join(process.env.SystemRoot ?? "C:\\Windows", "System32/cmd.exe"),
  ["/d", "/c", 'for %I in ("%NOVEL_AGENT_RELEASE_EXE%") do @echo %~sI'],
  {
    env: { ...process.env, NOVEL_AGENT_RELEASE_EXE: executable },
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    windowsVerbatimArguments: true,
  },
);
if (shortPathResult.error) throw shortPathResult.error;
const launchExecutable = shortPathResult.stdout.trim();
if (shortPathResult.status !== 0 || !existsSync(launchExecutable))
  throw new Error("Could not resolve the Windows launch path.");
console.log(
  `Testing the ${portable ? "portable EXE" : "extracted ZIP"} outside the checkout: ${unpacked}`,
);
const result = spawnSync(
  process.execPath,
  portable
    ? [resolve(desktop, "scripts/smoke-portable.mjs"), launchExecutable]
    : [resolve(desktop, "node_modules/@playwright/test/cli.js"), "test"],
  {
    cwd: desktop,
    env: { ...process.env, NOVEL_AGENT_E2E_EXECUTABLE: launchExecutable },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
