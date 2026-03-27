import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/integration.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 60_000,
    sequence: {
      concurrent: false,
    },
  },
});
