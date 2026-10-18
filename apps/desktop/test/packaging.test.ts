import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const readJson = (relativePath: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8"),
  );
const config = readJson("electron-builder.json");

describe("Windows distribution boundaries", () => {
  it("bundles format validation without a source node_modules fallback", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "novel-agent-validator-"));
    const bundled = join(temporary, "validation.mjs");
    await build({
      entryPoints: [
        fileURLToPath(
          new URL(
            "../../../packages/protocol/src/validation.ts",
            import.meta.url,
          ),
        ),
      ],
      outfile: bundled,
      bundle: true,
      platform: "node",
      format: "esm",
      banner: {
        js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
      },
    });
    const { validateContract } = await import(pathToFileURL(bundled).href);
    expect(
      validateContract("json-rpc-message", {
        jsonrpc: "2.0",
        id: "bundled-contract",
        method: "session.create",
        params: {},
      }).valid,
    ).toBe(true);
    expect(
      validateContract("event-envelope", { timestamp: "not-a-date" }).valid,
    ).toBe(false);
  });

  it("packages an isolated staging directory rather than the checkout", () => {
    expect(config.directories.app).toBe(".tmp/desktop-package");
    expect(config.files).toEqual([
      "package.json",
      "dist/**/*",
      "node_modules/**/*",
      "licenses/**/*",
    ]);
    expect(config.asar).toBe(true);
    expect(config.asarUnpack).toContain("dist/worker.mjs");
    expect(config.asarUnpack).toContain("node_modules/**/*");
    expect(config.extraResources).toEqual([
      {
        from: "apps/desktop/.native/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
        to: "native/better_sqlite3.node",
      },
    ]);
  });

  it("offers x64 EXE and ZIP without elevation or automatic publishing", () => {
    expect(config.win.target).toEqual([
      { target: "portable", arch: ["x64"] },
      { target: "zip", arch: ["x64"] },
    ]);
    expect(config.win.requestedExecutionLevel).toBe("asInvoker");
    expect(config.portable.requestExecutionLevel).toBe("user");
    expect(config.publish).toBeNull();
  });

  it("keeps the desktop and product release versions aligned", () => {
    expect(readJson("package.json").version).toBe(
      readJson("apps/desktop/package.json").version,
    );
    expect(readJson("packages/protocol/package.json").version).toBe("0.1.0");
  });
});
