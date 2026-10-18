import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { resolveDesktopPaths } from "../src/runtime-paths.js";

const options = {
  packaged: false,
  desktopRoot: resolve("checkout/apps/desktop"),
  resourcesRoot: resolve("application/resources"),
  appDataRoot: resolve("user/AppData/Roaming"),
};

describe("desktop runtime locations", () => {
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
