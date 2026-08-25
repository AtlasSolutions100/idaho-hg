import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The e2e route tests share ONE database. Seed it once up front, and run
    // files sequentially so they don't race on that shared state (e.g. one
    // file's global "approve-all" sweeping another file's entries).
    globalSetup: ["./src/test-setup/seed-global.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
