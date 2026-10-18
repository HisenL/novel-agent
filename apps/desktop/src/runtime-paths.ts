import { join, resolve } from "node:path";
import { realpathSync } from "node:fs";

export function resolveDesktopCodeDirectory(
  packaged: boolean,
  resourcesRoot: string,
  developmentDirectory: string,
): string {
  // Chromium canonicalizes Windows 8.3 paths. Build the allowlist and load URL
  // from the same real resource directory; do not broaden the resource policy.
  return packaged
    ? join(realpathSync.native(resourcesRoot), "app.asar/dist")
    : realpathSync.native(developmentDirectory);
}

interface DesktopPathOptions {
  packaged: boolean;
  desktopRoot: string;
  resourcesRoot: string;
  appDataRoot: string;
  testStateDir?: string | undefined;
}

export function resolveDesktopPaths(options: DesktopPathOptions): {
  localState: string;
  nativeBinding: string;
  worker: string;
} {
  return {
    localState:
      options.testStateDir ??
      (options.packaged
        ? join(options.appDataRoot, "Novel Agent")
        : resolve(options.desktopRoot, "../../.novel-agent/desktop")),
    nativeBinding: options.packaged
      ? join(options.resourcesRoot, "native/better_sqlite3.node")
      : join(
          options.desktopRoot,
          ".native/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
        ),
    worker: options.packaged
      ? join(options.resourcesRoot, "app.asar.unpacked/dist/worker.mjs")
      : join(options.desktopRoot, "dist/worker.js"),
  };
}
