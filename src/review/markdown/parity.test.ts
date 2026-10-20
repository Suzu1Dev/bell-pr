/**
 * Renderings that a differential fuzz against the earlier unified pipeline
 * (remark-parse, remark-rehype, hast-util-to-jsx-runtime) found to differ,
 * with the HTML that pipeline rendered. corpus.test.ts holds the rest.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderEn } from "../../test-utils/render";
import { MarkdownContent } from "../MarkdownContent";

const render = (children: string) => renderEn(createElement(MarkdownContent, { children }));

test("a fence whose info starts with a Unicode space keeps an empty language class", () => {
  // The parser trims only spaces and tabs, so the info's first word, split
  // at any white space, is empty: "language-", as before.
  for (const space of [" ", " ", "　", "﻿"])
    assert.equal(
      render(`\`\`\`${space}ts x\nrun();\n\`\`\``),
      '<div class="markdown-content"><pre><code class="language-">run();\n</code></pre></div>',
    );
});
