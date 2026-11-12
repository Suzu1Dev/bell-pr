import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement } from "react";
import type { MergedSetupNeed } from "../../shared/setup-needs";
import { mount, type FakeElement } from "../mission/test-dom";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { SetupHandOff } from "./SetupHandOff";

const need = (n: number, command = `sudo apt-get install -y pkg${n}`): MergedSetupNeed => ({
  need: `Package ${n}`,
  command,
  reason: `Check ${n} needs it.`,
  from: ["member-1"],
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers GET /api/system/sudo with `body` and `status`. */
function stubSudo(status: number, body: unknown) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return urls;
}

/** The handlers React gave `element`: the fake DOM dispatches no events. */
const handlers = (element: FakeElement) =>
  Object.entries(element).find(([name]) => name.startsWith("__reactProps$"))?.[1] as {
    onClick(): void;
    onChange(event: { target: { checked: boolean } }): void;
    checked?: boolean;
    disabled?: boolean;
  };
const click = (element: FakeElement) => act(async () => handlers(element).onClick());
const tick = (element: FakeElement, checked: boolean) => act(async () => handlers(element).onChange({ target: { checked } }));
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

test("a blocked hand-off is a disabled button that says why, in words", () => {
  const html = renderEn(createElement(SetupHandOff, { needs: [need(1)], block: "A turn is already running.", async onStart() {} }));
  assertNoHan(html);
  assert.match(html, /<button type="button" class="button secondary" disabled="" aria-describedby="([^"]+)">.*Let the agent set this up<\/button><p id="\1" class="field-help">A turn is already running\.<\/p>/);
  assert.match(renderZh(createElement(SetupHandOff, { needs: [need(1)], async onStart() {} })), /讓 Agent 準備這些環境/);
});

test("the dialog lists every command to tick, at most 10, says whether sudo needs a password, and starts only the ticked ones", async () => {
  const urls = stubSudo(200, { sudo: { user: "octo", available: true, installed: false, passwordless: false } });
  const started: string[][] = [];
  const needs = [...Array.from({ length: 11 }, (_, index) => need(index + 1)), need(12, "corepack enable")];
  const view = await mount(createElement(SetupHandOff, { needs, async onStart(commands) { started.push(commands); } }));
  try {
    const find = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match);
    await click(find((element) => element.nodeName === "BUTTON" && element.textContent === "Let the agent set this up")[0]);
    await settle();
    assert.deepEqual(urls, ["/api/system/sudo"]);
    assert.match(view.text(), /sudo asks octo for a password here, and the agent never enters one/);
    assert.match(view.text(), /At most 10 items per turn/);
    const boxes = find((element) => element.nodeName === "INPUT");
    assert.equal(boxes.length, 12);
    assert.deepEqual(boxes.map((box) => handlers(box).checked), [...Array(10).fill(true), false, false]);
    assert.deepEqual(boxes.map((box) => handlers(box).disabled), [...Array(10).fill(false), true, true]);
    assert.equal(find((element) => element.getAttribute("class") === "setup-sudo-tag").length, 11);
    // Cancel comes first.
    const actions = find((element) => element.getAttribute("class") === "modal-actions")[0];
    assert.deepEqual(actions.querySelectorAll((element) => element.nodeName === "BUTTON").map((button) => button.textContent), [
      "Cancel",
      "Start the agent (10 commands)",
    ]);
    // Unticking one frees a place; ticking the last command takes it.
    await tick(boxes[0], false);
    await tick(boxes[11], true);
    const confirm = find((element) => element.nodeName === "BUTTON" && element.textContent === "Start the agent (10 commands)")[0];
    await click(confirm);
    await settle();
    assert.deepEqual(started, [[...needs.slice(1, 10).map((entry) => entry.command), "corepack enable"]]);
    // A started turn closes the dialog.
    assert.equal(find((element) => element.getAttribute("role") === "dialog").length, 0);
  } finally {
    await view.unmount();
  }
});

test("a refused start keeps the dialog open with the reason, and an unreadable sudo status says it is unknown", async () => {
  stubSudo(404, { error: "not found" });
  const view = await mount(
    createElement(SetupHandOff, {
      needs: [need(1)],
      async onStart() {
        throw new Error("That setup item is no longer on this run's list.");
      },
    }),
  );
  try {
    const find = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match);
    await click(find((element) => element.nodeName === "BUTTON" && element.textContent === "Let the agent set this up")[0]);
    await settle();
    assert.match(view.text(), /BELL PR could not tell whether sudo needs a password here/);
    const box = find((element) => element.nodeName === "INPUT")[0];
    await tick(box, false);
    const confirm = () => find((element) => element.nodeName === "BUTTON" && /^Start the agent/.test(element.textContent))[0];
    assert.equal(handlers(confirm()).disabled, true);
    await tick(box, true);
    await click(confirm());
    await settle();
    assert.equal(find((element) => element.getAttribute("role") === "alert")[0]?.textContent, "That setup item is no longer on this run's list.");
    assert.equal(find((element) => element.getAttribute("role") === "dialog").length, 1);
  } finally {
    await view.unmount();
  }
});

test("without sudo in the commands, the dialog does not ask about sudo", async () => {
  const urls = stubSudo(200, { sudo: { user: "octo", available: true, installed: false, passwordless: true } });
  const view = await mount(createElement(SetupHandOff, { needs: [need(1, "corepack enable")], async onStart() {} }), "zh-TW");
  try {
    const button = view.container.querySelectorAll((element) => element.nodeName === "BUTTON")[0];
    await click(button);
    await settle();
    assert.deepEqual(urls, []);
    assert.match(view.text(), /要讓 Agent 準備這台機器的環境嗎？/);
    assert.match(view.text(), /開始處理（1 項）/);
  } finally {
    await view.unmount();
  }
});

test("the sudo line says when sudo needs no password or is missing, and commands go in the list's order", async () => {
  for (const [status, line] of [
    [{ user: "octo", available: true, installed: true, passwordless: true }, /sudo runs without a password for octo here, so the agent can run these sudo commands as root, unless a sudo rule limits/],
    [{ user: "octo", available: false, installed: false, passwordless: false }, /sudo is not installed here/],
  ] as const) {
    stubSudo(200, { sudo: status });
    const started: string[][] = [];
    const needs = [need(1), need(2), need(3)];
    const view = await mount(createElement(SetupHandOff, { needs, async onStart(commands) { started.push(commands); } }));
    try {
      const find = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match);
      await click(find((element) => element.nodeName === "BUTTON" && element.textContent === "Let the agent set this up")[0]);
      await settle();
      assert.match(view.text(), line);
      // Unticking and ticking the first again keeps it first.
      const boxes = find((element) => element.nodeName === "INPUT");
      await tick(boxes[0], false);
      await tick(boxes[0], true);
      await click(find((element) => element.nodeName === "BUTTON" && element.textContent === "Start the agent (3 commands)")[0]);
      await settle();
      assert.deepEqual(started, [needs.map((entry) => entry.command)]);
    } finally {
      await view.unmount();
    }
  }
});

test("a command no longer listed is not sent, and the count says so", async () => {
  stubSudo(200, { sudo: { user: "octo", available: true, installed: false, passwordless: true } });
  const started: string[][] = [];
  const onStart = async (commands: string[]) => {
    started.push(commands);
  };
  const view = await mount(createElement(SetupHandOff, { needs: [need(1), need(2)], onStart }));
  try {
    const find = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match);
    await click(find((element) => element.nodeName === "BUTTON" && element.textContent === "Let the agent set this up")[0]);
    await settle();
    // A poll closed the first item while the dialog was open.
    await view.rerender(createElement(SetupHandOff, { needs: [need(2)], onStart }));
    await click(find((element) => element.nodeName === "BUTTON" && element.textContent === "Start the agent (1 command)")[0]);
    await settle();
    assert.deepEqual(started, [[need(2).command]]);
  } finally {
    await view.unmount();
  }
});

test("the sudo line follows the ticked commands: none of them uses sudo, no line", async () => {
  stubSudo(200, { sudo: { user: "octo", available: true, installed: false, passwordless: false } });
  const view = await mount(createElement(SetupHandOff, { needs: [need(1), need(2, "corepack enable")], async onStart() {} }));
  try {
    const find = (match: (element: FakeElement) => boolean) => view.container.querySelectorAll(match);
    await click(find((element) => element.nodeName === "BUTTON" && element.textContent === "Let the agent set this up")[0]);
    await settle();
    assert.match(view.text(), /sudo asks octo for a password here/);
    await tick(find((element) => element.nodeName === "INPUT")[0], false);
    assert.doesNotMatch(view.text(), /sudo asks octo/);
  } finally {
    await view.unmount();
  }
});
