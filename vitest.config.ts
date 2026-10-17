import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@novel-agent/kernel/builtin-skills": fileURLToPath(
        new URL("./packages/kernel/src/builtin-skills.ts", import.meta.url),
      ),
      "@novel-agent/protocol": fileURLToPath(
        new URL("./packages/protocol/src/index.ts", import.meta.url),
      ),
      "@novel-agent/event-store": fileURLToPath(
        new URL("./packages/event-store/src/index.ts", import.meta.url),
      ),
      "@novel-agent/kernel": fileURLToPath(
        new URL("./packages/kernel/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    passWithNoTests: false,
  },
});
