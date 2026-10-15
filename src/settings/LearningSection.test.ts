import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { AppSettingsView } from "../../shared/app-settings";
import { learningCounts, type LearningCounts } from "../../shared/practice";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { CheckCounts, CheckOffDialog, LearningSection } from "./LearningSection";
import type { AppSettingsState } from "./useAppSettings";

const appSettings = (view: AppSettingsView | null): AppSettingsState => ({
  view,
  error: "",
  save: async () => view ?? { settings: {}, lockedBy: {} },
  reload: async () => undefined,
});

const section = (view: AppSettingsView | null) =>
  createElement(LearningSection, { settings: appSettings(view) });

/** The checkbox labelled `label`, with its attributes. */
function checkbox(html: string, label: string) {
  const id = html.match(new RegExp(`<label for="([^"]+)">${label}</label>`))?.[1];
  assert.ok(id, `no checkbox labelled ${label}`);
  const input = html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0];
  assert.ok(input, `no input for ${label}`);
  return input;
}

const checkLabel = "Ask me to explain each change back before approval";
const tryFirstLabel = "Try-first prompts during review";

test("Learning shows the understanding check on by default, and the try-first prompts", () => {
  const html = renderEn(section({ settings: {}, lockedBy: {} }));
  assertNoHan(html);
  assert.match(html, /<h2 id="settings-learning-title">Learning<\/h2>/);
  assert.match(html, /<h3>Understanding check<\/h3>/);
  assert.match(html, /No AI model grades you\./);
  const check = checkbox(html, checkLabel);
  assert.match(check, / checked=""/);
  assert.doesNotMatch(check, /disabled/);
  assert.match(html, /On by default\. While it is on, approving and publishing wait/);
  assert.match(checkbox(html, tryFirstLabel), / checked=""/);
  assert.match(html, /<h3>Try first<\/h3>/);
  // Nothing is locked, and no dialog shows until the switch is turned off.
  assert.doesNotMatch(html, /settings-lock-badge|role="dialog"/);

  const zh = renderZh(section({ settings: {}, lockedBy: {} }));
  assert.match(zh, /<h3>理解檢查<\/h3>/);
  assert.match(zh, /核准前，請我用自己的話講一遍每個變更/);
  assert.match(zh, /審查時先試著答/);
});

test("the switches show what is saved, and wait while the settings load", () => {
  const off = renderEn(
    section({ settings: { skipUnderstandingCheck: true, hideTryFirst: true }, lockedBy: {} }),
  );
  assertNoHan(off);
  assert.doesNotMatch(checkbox(off, checkLabel), /checked/);
  assert.doesNotMatch(checkbox(off, tryFirstLabel), /checked/);

  const loading = renderEn(section(null));
  assert.match(checkbox(loading, checkLabel), /disabled=""/);
  assert.match(checkbox(loading, tryFirstLabel), /disabled=""/);
});

test("BELLPR_REQUIRE_UNDERSTANDING_CHECK keeps the check on and read-only, and says so", () => {
  const variable = "BELLPR_REQUIRE_UNDERSTANDING_CHECK";
  const html = renderEn(
    section({ settings: { skipUnderstandingCheck: false }, lockedBy: { skipUnderstandingCheck: variable } }),
  );
  assertNoHan(html);
  const check = checkbox(html, checkLabel);
  assert.match(check, / checked=""/);
  assert.match(check, /disabled=""/);
  const lock = check.match(/aria-describedby="[^"]*\s([^"\s]+-lock)"/)?.[1];
  assert.ok(lock, "the switch is described by its lock note");
  assert.match(
    html,
    new RegExp(
      `<p class="settings-locked" id="${lock}"><span class="settings-lock-badge">.*?Set by environment</span><span>Kept on by ${variable}\\. Remove the variable and restart BELL PR to change this\\.</span></p>`,
    ),
  );
  // The try-first prompts are not locked by it.
  assert.doesNotMatch(checkbox(html, tryFirstLabel), /disabled/);
  assert.match(
    renderZh(section({ settings: {}, lockedBy: { skipUnderstandingCheck: variable } })),
    new RegExp(`由 ${variable} 保持開啟。`),
  );
});

test("the confirmation says what is lost, kept and recorded, and Keep the check is its first action", () => {
  const html = renderEn(createElement(CheckOffDialog, { onKeep() {}, onTurnOff() {} }));
  assertNoHan(html);
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="modal-title"/);
  assert.match(html, /<h2 id="modal-title">Approve without explaining the change back\?<\/h2>/);
  for (const sentence of [
    "You will be able to approve a pull request you have not explained.",
    "Every file still has to be reviewed, you still approve the pull request yourself, and every project-rule, issue and pacing check still applies.",
    "Runs approved without the check are marked “Check off” for good: in the workspace, your learning record and the export.",
    "You can turn it back on any time; runs already approved are then held to it before they are published.",
  ])
    assert.ok(html.includes(`<p class="settings-dialog-text">${sentence}</p>`), sentence);
  // Modal focuses the first field or action that is not its close button,
  // so Keep the check has the focus when the dialog opens.
  const buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map(
    ([, attributes, label]) => ({ attributes, label: label.replace(/<[^>]+>/g, "") }),
  );
  assert.match(buttons[0].attributes, /class="icon-button modal-close"/);
  assert.equal(buttons[1].label, "Keep the check");
  assert.doesNotMatch(buttons[1].attributes, /disabled/);
  assert.equal(buttons[2].label, "Turn it off");
  assert.match(buttons[2].attributes, /class="button primary settings-danger-button"/);
  const keep = html.indexOf(">Keep the check<");
  assert.doesNotMatch(html.slice(0, keep), /<(input|textarea|select)\b|<a [^>]*href/);

  const zh = renderZh(createElement(CheckOffDialog, { onKeep() {}, onTurnOff() {} }));
  assert.match(zh, /「檢查已關閉」/);
  assert.match(zh, />保留檢查<\/button>.*>關閉檢查<\/button>/);
});

const counts = (extra: Partial<LearningCounts>): LearningCounts => ({
  ...learningCounts([]),
  ...extra,
});

test("the counts name the runs approved without the check, and the median time from 3 timed checks", () => {
  const two = renderEn(createElement(CheckCounts, { counts: counts({ checkOff: 2, checkSeconds: { timed: 2, median: 150 } }) }));
  assertNoHan(two);
  assert.match(two, /<li>Runs approved without the check: 2<\/li>/);
  assert.doesNotMatch(two, /Median/);
  assert.match(two, /Measured on this computer only\./);

  const three = renderEn(createElement(CheckCounts, { counts: counts({ checkSeconds: { timed: 3, median: 145 } }) }));
  assert.match(three, /<li>Runs approved without the check: 0<\/li><li>Median time of your last 3 checks: 2\.4 min<\/li>/);
  // The median covers the latest 10 checks.
  const many = renderEn(createElement(CheckCounts, { counts: counts({ checkSeconds: { timed: 14, median: 240 } }) }));
  assert.match(many, /Median time of your last 10 checks: 4 min/);
  assert.match(
    renderZh(createElement(CheckCounts, { counts: counts({ checkSeconds: { timed: 4, median: 210 } }) })),
    /最近 4 次檢查花費時間的中位數：3\.5 分鐘/,
  );
  // Before the counts arrive, or when they fail, the section shows none.
  assert.doesNotMatch(renderEn(section({ settings: {}, lockedBy: {} })), /Runs approved without the check/);
});
