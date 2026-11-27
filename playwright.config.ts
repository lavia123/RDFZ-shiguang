import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "ui.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3188",
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3188/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "3188",
      DATA_DIR: ".data-ui",
      DEEPSEEK_API_KEY: "",
    },
    timeout: 45000,
  },
});
