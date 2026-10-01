import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "evals/**/*.test.ts"],
    env: { PGLITE_DIR: "memory://", STORAGE_DIR: ".data/test-storage", SAFE_MODE: "on" },
    testTimeout: 30000,
    pool: "forks",
  },
});
