// A first start with no provider CLI: Welcome opens and shows the install
// commands and documentation links. Another required failure still exits.
import { expect, test, type Browser, type Page } from "@playwright/test";
import onboarding from "../src/i18n/en/onboarding";
import onboardingZh from "../src/i18n/zh-TW/onboarding";
import { e2eApiHeaders } from "./api-token.mjs";
import { switchLocale } from "./fixtures";
import { expectNoOverflow } from "./helpers/overflow";
import { launchServer } from "./start-server.mjs";

async function openWelcome(browser: Browser, baseURL: string) {
  const context = await browser.newContext({
    extraHTTPHeaders: e2eApiHeaders,
    baseURL,
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto("/#/home");
  return { page, close: () => context.close() };
}

async function providerStep(page: Page, next: string) {
  await page.getByRole("button", { name: next }).click();
  await page.getByRole("button", { name: next }).click();
}

async function fits(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await expectNoOverflow(page, [".welcome-screen"]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
}

const widths = [320, 375, 390, 768, 1280];

/** Each install command is one line, and the page around it does not scroll sideways. */
async function commandsOnOneLine(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    if (!document.querySelector(".welcome-install code")) found.push("no install command");
    const range = document.createRange();
    for (const code of document.querySelectorAll(".welcome-install code")) {
      const texts = [...code.childNodes].filter(
        (node): node is Text => node.nodeType === Node.TEXT_NODE && !!node.textContent,
      );
      const rects = texts.flatMap((text) => {
        range.selectNodeContents(text);
        return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      });
      const lines = new Set(rects.map((rect) => Math.round(rect.top)));
      if (lines.size !== 1) found.push(`${lines.size} lines: ${code.textContent}`);
    }
    for (const node of [
      document.documentElement,
      document.querySelector(".welcome-screen"),
      document.querySelector(".welcome"),
      document.querySelector(".welcome-card"),
    ]) {
      if (!(node instanceof HTMLElement)) continue;
      if (node.scrollWidth > node.clientWidth + 1)
        found.push(`sideways ${node.className || node.tagName}: ${node.scrollWidth}>${node.clientWidth}`);
    }
    return found;
  });
  expect(problems, `width ${width}`).toEqual([]);
}

test("a first start with no provider CLI opens Welcome and shows how to install one", async ({ browser }) => {
  const server = await launchServer({ settingsPut: false, force: false });
  const { page, close } = await openWelcome(browser, server.baseURL);
  try {
    await expect(page.locator(".welcome-screen")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: onboarding.title })).toBeVisible();
    await providerStep(page, onboarding.next);
    await expect(page.getByRole("heading", { level: 2, name: onboarding.provider.title })).toBeVisible();
    await expect(page.getByText("npm install -g @openai/codex", { exact: true })).toBeVisible();
    await expect(page.getByText("npm install -g @anthropic-ai/claude-code", { exact: true })).toBeVisible();
    await expect(page.getByText("agy", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Codex CLI" })).toHaveAttribute(
      "href",
      "https://github.com/openai/codex",
    );
    await expect(page.getByRole("link", { name: "Claude Code documentation" })).toHaveAttribute(
      "href",
      "https://code.claude.com/docs/en/overview",
    );
    await fits(page, 1280);
    await fits(page, 375);
    for (const width of widths) await commandsOnOneLine(page, width);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: onboarding.back }).click();
    await page.getByRole("button", { name: onboarding.back }).click();
    await switchLocale(page, "zh-TW");
    await providerStep(page, onboardingZh.next);
    await expect(page.getByRole("heading", { level: 1, name: onboardingZh.title })).toBeVisible();
    await expect(page.getByText("npm install -g @openai/codex", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Codex CLI" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Claude Code 文件" })).toHaveAttribute(
      "href",
      "https://code.claude.com/docs/en/overview",
    );
    await fits(page, 1280);
    await fits(page, 375);
    for (const width of widths) await commandsOnOneLine(page, width);
  } finally {
    await close();
    await server.stop();
  }
});

/** Whether each install command overflows, and whether a right-edge fade is showing. */
async function commandFade(page: Page) {
  return page.locator(".welcome-command").evaluateAll((codes) =>
    codes.map((code) => {
      if (!(code instanceof HTMLElement))
        return { text: "", overflow: false, atEnd: true, shown: false };
      const frame = code.parentElement;
      const after = frame ? getComputedStyle(frame, "::after") : null;
      const content = after?.content ?? "none";
      const shown =
        !!after &&
        content !== "none" &&
        content !== "normal" &&
        after.display !== "none" &&
        after.visibility !== "hidden" &&
        parseFloat(after.opacity) > 0 &&
        parseFloat(after.width) > 0;
      const overflow = code.scrollWidth > code.clientWidth + 1;
      const atEnd = code.scrollLeft + code.clientWidth >= code.scrollWidth - 1;
      return { text: code.textContent ?? "", overflow, atEnd, shown };
    }),
  );
}

/**
 * Narrow windows fade a command only while part of it is still hidden.
 * A wide window, where every command fits, shows no fade.
 */
test("an install command fades at the right edge only while it overflows", async ({ browser }) => {
  const server = await launchServer({ settingsPut: false, force: false });
  const context = await browser.newContext({
    extraHTTPHeaders: e2eApiHeaders,
    baseURL: server.baseURL,
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await page.goto("/#/home");
  try {
    await expect(page.locator(".welcome-screen")).toBeVisible();
    await providerStep(page, onboarding.next);
    await expect(page.locator(".welcome-command").first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const expectFade = async (width: number, narrow: boolean) => {
      await page.setViewportSize({ width, height: 800 });
      await expect
        .poll(async () => {
          const rows = await commandFade(page);
          const wanted = (row: (typeof rows)[number]) => row.overflow && !row.atEnd;
          if (!narrow) {
            return rows.every((row) => !row.overflow && !row.shown)
              ? "ok"
              : rows.map((row) => `${row.text} overflow=${row.overflow} fade=${row.shown}`).join("; ");
          }
          if (!rows.some((row) => row.overflow)) return "nothing overflows";
          const wrong = rows.filter((row) => row.shown !== wanted(row));
          return wrong.length === 0
            ? "ok"
            : wrong
                .map((row) => `${row.text} overflow=${row.overflow} atEnd=${row.atEnd} fade=${row.shown}`)
                .join("; ");
        })
        .toBe("ok");
    };

    const scrollCommands = (toEnd: boolean) =>
      page.locator(".welcome-command").evaluateAll((codes, end) => {
        for (const code of codes) {
          if (!(code instanceof HTMLElement)) continue;
          code.scrollLeft = end && code.scrollWidth > code.clientWidth + 1 ? code.scrollWidth : 0;
        }
      }, toEnd);

    for (const width of [320, 375]) {
      await expectFade(width, true);
      await scrollCommands(true);
      await expect
        .poll(async () => (await commandFade(page)).every((row) => !row.shown))
        .toBe(true);
      await scrollCommands(false);
      await expectFade(width, true);
    }

    await page.setViewportSize({ width: 320, height: 800 });
    const curled = "curl -fsSL https://antigravity.google/cli/install.sh | bash";
    const curl = page.locator(".welcome-command", { hasText: curled });
    await curl.evaluate((code) => {
      code.scrollLeft = 0;
    });
    await expect.poll(async () => (await commandFade(page)).find((row) => row.text === curled)?.shown).toBe(true);
    await curl.evaluate((code) => {
      code.focus({ focusVisible: true } as FocusOptions);
    });
    const ring = await curl.evaluate((code) => {
      const box = code.getBoundingClientRect();
      const frame = code.parentElement;
      const shadow = getComputedStyle(code).boxShadow;
      if (!(frame instanceof HTMLElement)) return { shadow, coversRing: true };
      const after = getComputedStyle(frame, "::after");
      if (after.content === "none" || after.content === "normal")
        return { shadow, coversRing: true };
      const frameBox = frame.getBoundingClientRect();
      const width = parseFloat(after.width);
      const right = parseFloat(after.right) || 0;
      const top = parseFloat(after.top) || 0;
      const fadeRight = frameBox.right - right;
      const fadeLeft = fadeRight - width;
      const fadeTop = frameBox.top + top;
      const coversRing = fadeLeft < box.left - 0.5 || fadeRight > box.right + 0.5 || fadeTop < box.top - 0.5;
      return { shadow, coversRing };
    });
    expect(ring.shadow).not.toBe("none");
    expect(ring.coversRing).toBe(false);
    const before = await curl.evaluate((code) => code.scrollLeft);
    await curl.press("ArrowRight");
    await expect.poll(() => curl.evaluate((code) => code.scrollLeft)).toBeGreaterThan(before);
    const atEnd = (code: HTMLElement) => code.scrollLeft + code.clientWidth >= code.scrollWidth - 1;
    await expect
      .poll(async () => {
        const done = await curl.evaluate(atEnd);
        if (!done) await curl.press("ArrowRight");
        return done;
      })
      .toBe(true);
    await expect.poll(async () => (await commandFade(page)).find((row) => row.text === curled)?.shown).toBe(false);

    await page.emulateMedia({ reducedMotion: "reduce" });
    const motion = await page.locator(".welcome-install").evaluate(() => {
      const frame = document.querySelector(".welcome-command")?.parentElement;
      const after = frame ? getComputedStyle(frame, "::after") : null;
      return {
        animation: after?.animationName ?? "none",
        transition: after?.transitionDuration ?? "0s",
      };
    });
    expect(motion.animation).toBe("none");
    expect(motion.transition).toBe("0s");

    await page.getByRole("button", { name: `Copy the command: ${curled}` }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(curled);
    await expect(curl).toHaveText(curled);

    await expectFade(1280, false);
    await commandsOnOneLine(page, 320);
    await commandsOnOneLine(page, 375);
    await commandsOnOneLine(page, 1280);
    await fits(page, 320);
    await fits(page, 1280);
  } finally {
    await context.close();
    await server.stop();
  }
});
