import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

// Exercise Windows PowerShell's real script decoding and file checks without
// launching Electron or displaying a blocking message box.
it.skipIf(process.platform !== "win32")(
  "checks all desktop entrypoints before launching",
  () => {
    const root = mkdtempSync(join(tmpdir(), "novel-launch-check-"));
    const script = join(root, "scripts/launch-desktop.ps1");
    mkdirSync(dirname(script), { recursive: true });
    copyFileSync(
      new URL("../../../scripts/launch-desktop.ps1", import.meta.url),
      script,
    );
    const check = () =>
      spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          "-CheckOnly",
        ],
        { encoding: "utf8", timeout: 10000 },
      );
    expect(check().status).toBe(1);
    for (const file of [
      "node_modules/electron/dist/electron.exe",
      "dist/main.js",
      "dist/worker.js",
      "dist/preload.cjs",
      "dist/renderer/index.html",
    ]) {
      expect(check().status).toBe(1);
      const path = join(root, "apps/desktop", file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "fixture");
    }
    const ready = check();
    expect(ready.status).toBe(0);
    expect(ready.stdout.trim()).toBe("READY");
  },
  20000,
);
