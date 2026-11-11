// The Group page (#/group) with two people on one instance that runs with
// group work on (BELLPR_GROUP=1): Ada at the host, with the install token,
// and Ben on a paired device. Each has a browser context of their own, and
// what one does reaches the other's page through the feed, without a reload.
// The invite code is read from Ada's dialog and typed into Ben's page; it and
// the tokens stay in the test and are never printed. Where a step needs an
// answer to be late, the page's own request is kept back and then sent on to
// the server unchanged. Then axe on the board
// and on the invite dialog, in both languages and at both widths. On the
// shared server, which runs without the switch, the page says how to turn
// group work on and the sidebar has no Group item.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type Page, type Route } from "@playwright/test";
import { locales } from "../shared/i18n/locale";
import { product } from "../shared/product";
import { e2eApiHeaders } from "./api-token.mjs";
import { messages } from "./helpers/messages";
import { launchServer, type LaunchedServer } from "./start-server.mjs";

const en = messages.en.collab;
const sidebarItem = (page: Page) =>
  page.locator(`#workspace-sidebar button[title="${messages.en.app.pages.group}"]`);
const viewports = [
  { width: 1440, height: 900 },
  { width: 360, height: 844 },
  { width: 320, height: 780 },
];

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });

/** A repository of this instance for the group to add: a checkout with one commit on main. */
async function seed(dataDir: string) {
  const checkout = path.join(dataDir, "projects", "shop");
  await mkdir(checkout, { recursive: true });
  git(checkout, "init", "-q", "-b", "main");
  await writeFile(path.join(checkout, "README.md"), "# shop\n");
  git(checkout, "add", ".");
  git(checkout, "-c", "user.name=Sample Author", "-c", "user.email=author@example.com", "commit", "-q", "-m", "Start");
  await writeFile(
    path.join(dataDir, "state.json"),
    JSON.stringify({
      version: 1,
      repos: [{ id: "e2e-group-repo", name: "shop", owner: "local", fullName: "shop", path: checkout, defaultBranch: "main", url: "" }],
      runs: [],
    }),
  );
}

/** Fails on serious or critical axe issues, color contrast included, as e2e/a11y.spec.ts does. */
async function expectAccessible(page: Page, include?: string) {
  await page.evaluate(() => document.fonts.ready);
  // Let transitions (focus rings, the dialog) settle before colors are read.
  await page.waitForTimeout(300);
  const builder = new AxeBuilder({ page }).options({ rules: { "color-contrast": { enabled: true } } });
  const results = await (include ? builder.include(include) : builder).analyze();
  // The contrast rule really ran.
  expect(
    [...results.passes, ...results.violations, ...results.incomplete].some((rule) => rule.id === "color-contrast"),
  ).toBe(true);
  const problems = results.violations
    .filter(({ impact }) => impact === "serious" || impact === "critical")
    .flatMap(({ id, nodes }) => nodes.map((node) => `${id} at ${node.target.join(" ")}\n  ${node.html}`));
  expect(problems, problems.join("\n")).toEqual([]);
}

/** Nothing is wider than the screen. */
const expectFits = async (page: Page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBe(0);

/** Keeps the page's requests to `url` back until the function it returns is called. */
async function keepBack(page: Page, url: RegExp) {
  const kept: Route[] = [];
  await page.route(url, (route) => void kept.push(route));
  return async () => {
    await page.unroute(url);
    // A request the page gave up meanwhile has nothing to send on.
    for (const route of kept) await route.continue().catch(() => undefined);
  };
}
const checks = /\/check$/;

/** Fills Start work and waits for the answer that nothing is in the way, then takes the hold. */
async function takeHold(page: Page, title: string, paths: string) {
  await page.locator("#hold-title").fill(title);
  await page.locator("#hold-paths").fill(paths);
  await expect(page.locator("#hold-answer .split-info")).toContainText(en.free);
  await page.getByRole("button", { name: en.takeHold }).click();
}

test.describe("two people on one group", () => {
  test.describe.configure({ mode: "serial" });
  let server: LaunchedServer;
  let ada: Page;
  let ben: Page;

  test.beforeAll(async ({ browser }) => {
    server = await launchServer({ env: { BELLPR_GROUP: "1" }, seed });
    const options = { baseURL: server.baseURL, viewport: viewports[0] };
    ada = await (await browser.newContext({ ...options, extraHTTPHeaders: e2eApiHeaders })).newPage();
    // Ben's browser is a paired device: it has a device token and never the
    // install token, which a new context would take from the configuration.
    const host = await request.newContext({ baseURL: server.baseURL, extraHTTPHeaders: e2eApiHeaders });
    const { code } = await (await host.post("/api/pair/codes", { data: {} })).json();
    const { token } = await (await host.post("/api/pair", { data: { code, name: "Ben's laptop" } })).json();
    await host.dispose();
    const context = await browser.newContext({ ...options, extraHTTPHeaders: {} });
    await context.addInitScript((value) => localStorage.setItem("bellpr-device-token", value), token);
    ben = await context.newPage();
  });
  test.afterAll(async () => {
    await ada?.context().close();
    await ben?.context().close();
    await server?.stop();
  });

  test("a hold reaches the other person, one that meets it is refused in the form, and a release frees it", async () => {
    // Ada starts group work at the host, adds the repository and invites Ben.
    // Each card goes with its button, and the page's heading takes the focus.
    await ada.goto("/#/group?locale=en");
    await expect(sidebarItem(ada)).toBeVisible();
    await ada.locator("#host-name").fill("Ada");
    await ada.getByRole("button", { name: en.host.submit }).click();
    await expect(ada.locator(".group-page h1")).toBeFocused();
    await ada.getByRole("button", { name: en.addRepository }).click();
    await expect(ada.locator("#hold-title")).toBeVisible();
    await expect(ada.locator(".group-page h1")).toBeFocused();
    await ada.getByRole("button", { name: en.invite, exact: true }).click();
    const dialog = ada.getByRole("dialog");
    await dialog.locator("#invite-name").fill("Ben");
    await dialog.getByRole("button", { name: en.inviteDialog.create }).click();
    await expect(dialog).toContainText(en.inviteDialog.codeFor({ name: "Ben" }));
    const code = await dialog.locator("code").innerText();
    await dialog.getByRole("button", { name: en.inviteDialog.done }).click();

    // Ben types a wrong code and presses Join by keyboard: the server's sentence, and the focus stays on the button.
    await ben.goto("/#/group?locale=en");
    await ben.locator("#join-code").fill("not-the-code");
    await ben.keyboard.press("Tab");
    const join = ben.getByRole("button", { name: en.join.submit, exact: true });
    await expect(join).toBeFocused();
    await ben.keyboard.press("Space");
    await expect(ben.locator("#card-error")).toBeVisible();
    await expect(join).toBeFocused();

    // Ben joins with the code: the same board, and nothing only an admin has.
    await ben.locator("#join-code").fill(code);
    await join.click();
    await expect(ben.locator("#hold-title")).toBeVisible();
    await expect(ben.locator(".group-page h1")).toBeFocused();
    await expect(ben.getByRole("button", { name: en.invite, exact: true })).toHaveCount(0);

    // Ben asks for a file while nothing is held: nothing is in the way.
    await ben.locator("#hold-title").fill("Rename users");
    const paths = ben.locator("#hold-paths");
    await paths.fill("src/api/users.ts");
    const box = ben.locator("#hold-answer");
    await expect(box.locator(".split-info")).toContainText(en.free);

    // Ada's hold shows on Ben's page by itself, and the answer for the board
    // before goes with it, however long the next answer takes.
    let answer = await keepBack(ben, checks);
    await takeHold(ada, "Fix pagination", "src/api");
    await expect(ada.locator(".group-hold.mine")).toContainText(en.me);
    const adas = ben.locator(".group-hold", { hasText: "Fix pagination" });
    await expect(adas).toContainText("Ada");
    await expect(adas.locator("code")).toHaveText("src/api");
    await expect(adas.getByRole("button")).toHaveCount(0);
    await expect(box).toBeEmpty();
    await answer();

    // A file inside the held folder: the form says who holds it, and the button is off.
    const refused = box.locator(".split-warning");
    await expect(refused.locator("strong")).toHaveText("Ada");
    await expect(refused.locator("code")).toHaveText("src/api");
    await expect(refused).toContainText("Fix pagination");
    const take = ben.getByRole("button", { name: en.takeHold });
    await expect(take).toBeDisabled();

    // Other paths: the answer for the paths before goes at once.
    answer = await keepBack(ben, checks);
    await paths.fill("src/api");
    await expect(box).toBeEmpty();
    await answer();
    await expect(refused.locator("strong")).toHaveText("Ada");

    // Ada releases: Ben's form turns free without a key, and his hold shows for Ada.
    await ada.getByRole("button", { name: en.release.unfinishedAria({ title: "Fix pagination" }) }).click();
    await expect(ada.locator(".group-hold")).toContainText(en.gone);
    await expect(box.locator(".split-info")).toContainText(en.free);
    await take.click();
    await expect(ben.locator(".group-hold.mine")).toContainText("Rename users");
    await expect(ada.locator(".group-hold", { hasText: "Rename users" })).toContainText("Ben");

    // Ben presses Take hold by keyboard, and Ada gets there first while his request is on its way:
    // it is refused, the form says who holds the path, and the focus is on Paths.
    await ben.locator("#hold-title").fill("Add tests");
    await paths.fill("test");
    await expect(box.locator(".split-info")).toContainText(en.free);
    const send = await keepBack(ben, /\/work$/);
    await take.press("Space");
    await takeHold(ada, "Fix the tests", "test");
    await expect(refused.locator("strong")).toHaveText("Ada");
    await send();
    await expect(paths).toBeFocused();
    await expect(refused.locator("strong")).toHaveText("Ada");

    // For the pages below: Ada holds one thing and Ben another.
    await ada.getByRole("button", { name: en.release.unfinishedAria({ title: "Fix the tests" }) }).click();
    await takeHold(ada, "Write the guide", "docs");
    await expect(ben.locator(".group-hold")).toHaveCount(2);
  });

  test("a page opened while the host does not answer says that it is reconnecting, then shows the board", async () => {
    const page = await ada.context().newPage();
    const info = /\/api\/collab$/;
    await page.route(info, (route) => route.abort());
    await page.goto("/#/group?locale=en");
    await expect(page.locator(".group-page > [role=status]")).toHaveText(en.reconnecting);
    await page.unroute(info);
    await expect(page.locator(".group-hold")).toHaveCount(2, { timeout: 20_000 });
    await page.close();
  });

  for (const locale of locales)
    for (const viewport of viewports)
      test(`the board and the invite dialog have no serious or critical issue (${locale}, ${viewport.width} px)`, async () => {
        const t = messages[locale].collab;
        const page = await ada.context().newPage();
        await page.setViewportSize(viewport);
        await page.goto(`/#/group?locale=${locale}`);
        // Ben's hold and Ada's own, with Ben's in the way of the path asked for.
        await expect(page.locator(".group-hold")).toHaveCount(2);
        await page.locator("#hold-paths").fill("src");
        await expect(page.locator("#hold-answer .split-warning strong")).toHaveText("Ben");
        await expectAccessible(page);
        await expectFits(page);
        await page.locator("#hold-paths").fill("test");
        await expect(page.locator("#hold-answer .split-info")).toContainText(t.free);
        await expectAccessible(page, "#hold-answer");

        await page.getByRole("button", { name: t.invite, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.locator("#invite-name").fill("Chen");
        await expectAccessible(page, ".modal");
        await dialog.getByRole("button", { name: t.inviteDialog.create }).click();
        await expect(dialog).toContainText(t.inviteDialog.codeFor({ name: "Chen" }));
        await expectAccessible(page, ".modal");
        await expectFits(page);
        await page.close();
      });
});

test("without the switch the page says how to turn group work on, and the sidebar has no Group item", async ({ page }) => {
  await page.goto("/#/group?locale=en");
  const card = page.locator(".group-page .settings-card");
  await expect(card).toContainText(en.off.title);
  await expect(card.locator("code")).toHaveText(`${product.binNames[0]} start --group`);
  await expect(page.locator("#workspace-sidebar")).toBeVisible();
  await expect(sidebarItem(page)).toHaveCount(0);
});
