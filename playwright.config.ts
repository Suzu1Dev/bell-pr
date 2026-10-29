// End-to-end tests against the real `bell-pr start`, with a
// temporary data dir (see e2e/start-server.mjs).
//
//   BELLPR_E2E_PORT=<port> npm run test:e2e
//
// BELLPR_E2E_PORT is the shared server's port (default 4599);
// BELLPR_E2E_SKIP_BUILD=1 skips `npm run build`; PLAYWRIGHT_CHROMIUM_EXECUTABLE
// points at an installed Chromium build instead of Playwright's download.
import { defineConfig, devices } from "@playwright/test";
import { e2eApiHeaders } from "./e2e/api-token.mjs";

const port = Number(process.env.BELLPR_E2E_PORT || 4599);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  // Traces, screenshots and the report stay out of the repository.
  outputDir: "e2e/output/results",
  globalSetup: "./e2e/start-server.mjs",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "e2e/output/report", open: "never" }]]
    : "list",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${port}`,
        extraHTTPHeaders: e2eApiHeaders,
        viewport: { width: 1440, height: 900 },
        locale: "en-US",
        timezoneId: "UTC",
        trace: "retain-on-failure",
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
});
