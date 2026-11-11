import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  timeout: 30000,
  fullyParallel: true,
  workers: 2,
  use: { baseURL: "http://127.0.0.1:4318", trace: "retain-on-failure" },
  webServer: {
    command: "node tests/browser/server.mjs",
    url: "http://127.0.0.1:4318/vanilla",
    reuseExistingServer: false,
  },
});
