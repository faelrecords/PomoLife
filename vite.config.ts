import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "/",
  plugins: [react()],
  resolve: process.env.POMOLIFE_E2E_MOCK_WEBLLM === "1"
    ? {
        alias: {
          "@mlc-ai/web-llm": fileURLToPath(
            new URL("./e2e/mocks/webllm.ts", import.meta.url),
          ),
        },
      }
    : undefined,
  build: {
    target: "es2022",
    sourcemap: true,
    outDir: process.env.POMOLIFE_E2E_MOCK_WEBLLM === "1" ? "dist-e2e" : "dist",
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
