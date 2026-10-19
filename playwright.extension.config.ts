import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "challenge/e2e",
  testMatch: "config-extension-ui.spec.ts",
  globalSetup: "./challenge/e2e/config-extension-global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  outputDir: "challenge/evidence/playwright-extension-artifacts",
  use: {
    baseURL: "http://127.0.0.1:4273",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node challenge/e2e/start-api-extension-e2e.mjs",
      url: "http://127.0.0.1:3100/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run dev:ui:e2e",
      url: "http://127.0.0.1:4273",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
