import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { eulaVersion } from "../../shared/product";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { EulaPrompt } from "./EulaPrompt";

const element = () => createElement(EulaPrompt, { onAccepted() {} });

test("the agreement prompt reads in English with no Chinese left", () => {
  const html = renderEn(element());
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="eula-prompt-title"/);
  assert.match(html, /<h2 id="eula-prompt-title" tabindex="-1">Accept the license agreement to continue<\/h2>/);
  assert.ok(html.includes(`Version ${eulaVersion} of the BELL PR End User License Agreement applies to this build.`));
  assert.match(html, /<li>AI output can be wrong\./);
  assert.match(html, /<a href="\/legal\/EULA\.txt" target="_blank" rel="noreferrer">Read the full agreement/);
  assert.match(html, /<button type="button" class="button primary">Accept and continue<\/button>/);
  assertNoHan(html);
  assert.match(renderZh(element()), />接受並繼續<\/button>/);
});

test("the prompt cannot be closed, and with no docs URL it offers no other way out", () => {
  const html = renderEn(element());
  assert.doesNotMatch(html, /modal-close|Close dialog|Not now|Cancel/);
  // shared/product.ts has no docsUrl yet, so no documentation link and no empty href.
  assert.doesNotMatch(html, /documentation|href=""/);
  assert.equal(html.match(/<a /g)?.length, 1);
});
