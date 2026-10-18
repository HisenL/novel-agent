import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  resolveDesktopCodeDirectory,
  resolveDesktopPaths,
} from "../src/runtime-paths.js";

const options = {
  packaged: false,
  desktopRoot: resolve("checkout/apps/desktop"),
  resourcesRoot: resolve("application/resources"),
  appDataRoot: resolve("user/AppData/Roaming"),
};

describe("desktop runtime locations", () => {
  it("canonicalizes the physical resource parent before constructing virtual ASAR URLs", () => {
    const temporary = mkdtempSync(join(tmpdir(), "novel-agent-resource-path-"));
    const resources = join(temporary, "Resources");
    mkdirSync(resources);
    const alias =
      process.platform === "win32"
        ? resources.toUpperCase()
        : join(resources, ".");
    expect(resolveDesktopCodeDirectory(true, alias, temporary)).toBe(
      join(realpathSync.native(resources), "app.asar/dist"),
    );
  });

  it("keeps development entry URLs on the canonical physical directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "novel-agent-dev-entry-"));
    expect(resolveDesktopCodeDirectory(false, directory, directory)).toBe(
      realpathSync.native(directory),
    );
  });

  it("preserves development settings and native binding locations", () => {
    const paths = resolveDesktopPaths(options);
    expect(paths.localState).toBe(resolve("checkout/.novel-agent/desktop"));
    expect(paths.worker).toBe(join(options.desktopRoot, "dist/worker.js"));
    expect(paths.nativeBinding).toContain(join(".native", "node_modules"));
  });

  it("uses persistent user settings and unpacked resources when packaged", () => {
    const paths = resolveDesktopPaths({ ...options, packaged: true });
    expect(paths.localState).toBe(join(options.appDataRoot, "Novel Agent"));
    expect(paths.nativeBinding).toBe(
      join(options.resourcesRoot, "native/better_sqlite3.node"),
    );
    expect(paths.worker).toBe(
      join(options.resourcesRoot, "app.asar.unpacked/dist/worker.mjs"),
    );
    expect(paths.localState.startsWith(options.resourcesRoot)).toBe(false);
  });

  it("keeps explicit test state isolated in both launch modes", () => {
    const testStateDir = resolve("temporary/independent-test-state");
    for (const packaged of [true, false]) {
      expect(
        resolveDesktopPaths({ ...options, packaged, testStateDir }).localState,
      ).toBe(testStateDir);
    }
  });
});
