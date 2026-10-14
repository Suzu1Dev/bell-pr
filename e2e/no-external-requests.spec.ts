// BELL PR is local-first: no page may load anything from another host,
// fonts included (they are bundled).
import { expect, test } from "@playwright/test";

const routes = [
  "#/runs/demo-run/overview",
  "#/runs/demo-run/changes",
  "#/runs/demo-run/activity",
  "#/runs/demo-run/draft",
  "#/home",
  "#/demo",
  "#/about",
  "#/repos",
  "#/repos/demo-repo",
  "#/discover",
  "#/team",
  "#/learning",
  "#/settings",
];

test("every page asks only 127.0.0.1", async ({ page, context }) => {
  const external: string[] = [];
  const fonts: string[] = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (["data:", "blob:", "about:"].includes(url.protocol)) return;
    if (url.hostname !== "127.0.0.1") external.push(request.url());
    else if (request.resourceType() === "font") fonts.push(url.pathname);
  });
  for (const route of routes) {
    await page.goto(`/${route}`);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
  }
  expect(external).toEqual([]);
  // The interface fonts came from this server.
  expect(fonts.some((path) => /^\/assets\/.+\.woff2$/.test(path))).toBe(true);
});
