// Headroom item 1 (DESIGN v1.2 F14): "Ask a human" lists the project's own
// help channels, with where its files name each one.
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn } from "../../test-utils/render";
import { Channels } from "./Channels";

test("Ask a human lists the project's own channels, web links only", () => {
  const html = renderEn(
    createElement(Channels, {
      channels: [
        { label: "Zulip #t-compiler/help", url: "https://rust-lang.zulipchat.com/#narrow/stream/182449", path: "CONTRIBUTING.md", line: 12 },
        { label: "Not a link", url: "javascript:alert(1)" },
      ],
    }),
  );
  assertNoHan(html);
  assert.match(html, /<a href="https:\/\/rust-lang\.zulipchat\.com\/#narrow\/stream\/182449" target="_blank" rel="noreferrer">Zulip #t-compiler\/help<\/a> <code>CONTRIBUTING\.md:12<\/code>/);
  assert.doesNotMatch(html, /javascript:|Not a link/);
  assert.equal(renderEn(createElement(Channels, {})), "");
});
