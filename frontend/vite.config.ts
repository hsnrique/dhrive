/// <reference types="vitest/config" />
import { configDefaults } from "vitest/config";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Tauri serves this as a static SPA. The dev server runs on a fixed port that
// tauri.conf.json's devUrl points at; strictPort makes a busy port fail loudly.
// Build target matches the macOS WebKit webview.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // The bench's fixture is a project of its own, with its own tests.
  test: { exclude: [...configDefaults.exclude, "bench/fixture/**"] },
  build: {
    target: "safari15",
    outDir: "dist",
    emptyOutDir: true,
  },
});
