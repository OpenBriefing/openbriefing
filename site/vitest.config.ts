import { defineConfig } from "vitest/config";

// The browser tests in e2e/ belong to Playwright.
export default defineConfig({ resolve: { dedupe: ["yaml"] }, test: { include: ["test/**/*.test.ts"] } });
