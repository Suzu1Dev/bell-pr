// Pixel baseline of the main screens, used to prove that a refactor leaves
// the rendered UI unchanged. See ui-baseline.spec.ts for how to run it.
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baselineDir = process.env.UI_BASELINE_DIR;
if (!baselineDir)
  throw new Error(
    "Set UI_BASELINE_DIR to a folder outside the repository for the baseline images.",
  );
const snapshotDir = path.resolve(baselineDir);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: ".",
  testMatch: "ui-baseline.spec.ts",
  // Diffs and traces go next to the baseline, never into the repository.
  outputDir: process.env.UI_BASELINE_OUTPUT_DIR ?? `${snapshotDir}-results`,
  snapshotPathTemplate: path.join(snapshotDir, "{arg}{ext}"),
  reporter: "list",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.UI_BASELINE_URL ?? "http://127.0.0.1:4511",
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        // Keep the page language Traditional Chinese so Chromium picks the
        // same fallback font for Han glyphs whatever <html lang> the app sets.
        locale: "zh-TW",
        timezoneId: "Asia/Taipei",
        colorScheme: "light",
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
});
