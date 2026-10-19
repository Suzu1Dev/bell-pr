// Records every class name the pages of a Playwright run render, for
// `node scripts/unused-css.mjs --dom <folder>`. Preload it into an e2e run:
//
//   CSS_USAGE_DIR=<empty folder> NODE_OPTIONS="--import ./scripts/css-usage-hook.mjs" \
//     BELLPR_E2E_PORT=<port> npm run test:e2e
//
// Every browser context gets an init script whose MutationObserver collects
// the classes of each element that appears or changes, so the states a test
// passes through count too. When a page or its context closes, the classes
// go to <folder>/classes-<process>-<n>.json. It wraps chromium.launch() and
// the browsers it returns, which is how the test runner and the specs open
// pages. Without CSS_USAGE_DIR it does nothing.
import { writeFileSync } from "node:fs";
import path from "node:path";
import playwright from "playwright-core";

const directory = process.env.CSS_USAGE_DIR;

/** Runs in the page: collects class names into __cssUsageClasses(). */
function record() {
  const seen = new Set();
  const add = (element) => {
    if (element.classList) for (const name of element.classList) seen.add(name);
  };
  const scan = (root) => {
    add(root);
    if (root.querySelectorAll) for (const element of root.querySelectorAll("[class]")) add(element);
  };
  new globalThis.MutationObserver((records) => {
    for (const change of records) {
      if (change.type === "attributes") add(change.target);
      else for (const node of change.addedNodes) if (node.nodeType === 1) scan(node);
    }
  }).observe(globalThis.document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  Object.defineProperty(globalThis, "__cssUsageClasses", { value: () => [...seen] });
}

if (directory) {
  let written = 0;
  const collected = new WeakSet();
  const collect = async (page) => {
    if (collected.has(page) || page.isClosed()) return;
    collected.add(page);
    try {
      const names = await page.evaluate(() => globalThis.__cssUsageClasses?.() ?? []);
      writeFileSync(path.join(directory, `classes-${process.pid}-${written++}.json`), JSON.stringify(names));
    } catch {
      // The page crashed or was already gone; its classes are lost.
    }
  };
  // Wraps a method once on the object's prototype, which every later
  // object of that class shares.
  const wrapped = new WeakSet();
  const wrap = (object, name, around) => {
    const prototype = Object.getPrototypeOf(object);
    if (wrapped.has(prototype[name])) return;
    const original = prototype[name];
    prototype[name] = function (...args) {
      return around.call(this, original, args);
    };
    wrapped.add(prototype[name]);
  };
  const { chromium } = playwright;
  const launch = chromium.launch;
  chromium.launch = async function (...args) {
    const browser = await launch.apply(this, args);
    wrap(browser, "newContext", async function (original, args) {
      const context = await original.apply(this, args);
      await context.addInitScript(record);
      wrap(context, "close", async function (original, args) {
        await Promise.all(this.pages().map(collect));
        return original.apply(this, args);
      });
      context.on("page", (page) =>
        wrap(page, "close", async function (original, args) {
          await collect(this);
          return original.apply(this, args);
        }),
      );
      return context;
    });
    return browser;
  };
}
