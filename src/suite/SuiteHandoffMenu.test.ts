import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { SuiteHandoffMenu } from "./SuiteHandoffMenu";

const links = {
  explain: "http://127.0.0.1:22102",
  personal: "http://127.0.0.1:22101",
  reader: "http://127.0.0.1:22104",
  campaign: "http://127.0.0.1:22105",
};

test("SuiteHandoffMenu renders nothing when links are missing/unsafe or text is blank", () => {
  assert.equal(renderEn(createElement(SuiteHandoffMenu, { text: "Retry logic" })), "");
  assert.equal(renderEn(createElement(SuiteHandoffMenu, { links: {}, text: "Retry logic" })), "");
  assert.equal(
    renderEn(createElement(SuiteHandoffMenu, { links: { explain: "javascript:alert(1)" }, text: "Retry logic" })),
    "",
  );
  assert.equal(renderEn(createElement(SuiteHandoffMenu, { links, text: "   \n\t " })), "");
});

test("SuiteHandoffMenu renders an accessible menu trigger in en and zh-TW with optional className", () => {
  const enHtml = renderEn(
    createElement(SuiteHandoffMenu, {
      links,
      title: "src/utils/retry.ts",
      text: "Exponential backoff",
      className: "suite-handoff-compact",
    }),
  );
  assertNoHan(enHtml);
  assert.match(enHtml, /class="suite-handoff-menu suite-handoff-compact"/);
  assert.match(enHtml, /aria-label="Send to BELL"/);
  assert.match(enHtml, /aria-haspopup="menu" aria-expanded="false"/);
  assert.match(enHtml, /<span>Send to BELL<\/span>/);

  const zhHtml = renderZh(
    createElement(SuiteHandoffMenu, {
      links,
      text: "Exponential backoff",
    }),
  );
  assert.match(zhHtml, /aria-label="送到 BELL 工具"/);
  assert.match(zhHtml, /<span>送到 BELL 工具<\/span>/);
});
