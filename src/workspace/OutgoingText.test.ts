import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { outgoingPublishText } from "../../shared/publish-payload";
import { renderEn } from "../test-utils/render";
import type { Run } from "../types";
import { OutgoingText } from "./PublishModal";

test("the confirm dialog shows the exact title, commit message and PR body", () => {
  const draft = {
    title: "Update hello",
    body: "Line one.\nLine two.\n",
    commitMessage: "Update hello\n\nDetails.",
  };
  const text = outgoingPublishText(draft, false);
  const html = renderEn(
    createElement(OutgoingText, {
      run: { draft } as Run,
      followUp: false,
      demo: false,
    }),
  );
  const pres = [...html.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map((match) =>
    match[1].replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"),
  );
  assert.deepEqual(pres, [text.title, text.commitMessage, text.body]);
});
