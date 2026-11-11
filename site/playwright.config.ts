import { defineConfig } from "@playwright/test";

// Runs against the built site, served the way GitHub Pages serves it
// (ns.html at /ns). Build first: npm run build.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4391" },
  webServer: {
    command: "node e2e/serve.mjs",
    url: "http://127.0.0.1:4391/healthz",
    reuseExistingServer: !process.env.CI,
  },
});
