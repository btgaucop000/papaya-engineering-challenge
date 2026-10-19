import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "challenge/e2e",
  testMatch: "claims-ui.spec.ts",
  globalSetup: "./challenge/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  outputDir: "challenge/evidence/playwright-artifacts",
  use: {
    baseURL: "http://127.0.0.1:4273",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run start:api:e2e",
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
