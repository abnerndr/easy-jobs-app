import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Without this, Vitest's default include glob also picks up
    // tests/e2e/*.spec.ts, which imports Playwright's own test/expect and
    // fails immediately under Vitest's runner.
    include: ["tests/unit/**/*.test.ts"],
  },
});
