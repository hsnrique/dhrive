import { defineConfig } from "vitest/config";

// The cache stays in the project: node_modules is shared with dhrive's own frontend.
export default defineConfig({ cacheDir: ".cache", test: { include: ["src/**/*.test.ts"] } });
