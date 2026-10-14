import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mergeSetupNeeds } from "../../shared/setup";
import { SetupChecklist } from "./SetupChecklist";

const render = (needs: ReturnType<typeof mergeSetupNeeds>) =>
  renderToStaticMarkup(createElement(SetupChecklist, { needs, onCopy: () => {} }));

test("missing setup becomes a checklist of commands to verify and copy, and nothing shows when none is missing", () => {
  const html = render(
    mergeSetupNeeds([
      {
        from: "Teammate 1",
        needs: [{ need: "GLib 開發標頭", command: "sudo apt install libglib2.0-dev", reason: "cargo test 需要。" }],
      },
      {
        from: "Teammate 2",
        needs: [{ need: "GLib 開發標頭", command: "sudo apt install libglib2.0-dev", reason: "同上。" }],
      },
    ]),
  );
  assert.match(html, /需要你在這台機器準備的環境/);
  assert.match(html, /<code>sudo apt install libglib2\.0-dev<\/code>/);
  assert.match(html, /aria-label="複製指令：sudo apt install libglib2\.0-dev"/);
  assert.match(html, /回報者：Teammate 1、Teammate 2/);
  assert.match(html, /執行前請對照專案文件確認/);
  assert.equal(render([]), "");
});
