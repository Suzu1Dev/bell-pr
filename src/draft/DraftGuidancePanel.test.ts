import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoDraftPreparation } from "../demo";
import { DraftGuidancePanel } from "./DraftGuidancePanel";
import type { DraftPreparation } from "../../shared/drafts";

const render = (preparation: DraftPreparation, applied?: boolean) =>
  renderToStaticMarkup(
    createElement(DraftGuidancePanel, {
      preparation,
      busy: false,
      onGenerate: () => {},
      onApply: () => {},
      applied,
    }),
  );

test("an applied proposal says the editor holds its unrevised text and cannot be applied again", () => {
  const pending = render(demoDraftPreparation);
  assert.match(pending, /套用建議草稿/);
  const applied = render(demoDraftPreparation, true);
  assert.match(applied, /已套用/);
  assert.match(applied, /會原樣送到 GitHub/);
  assert.match(applied, /<button[^>]*disabled=""[^>]*>[\s\S]*?已套用/);
});

test("a project's issue rule is quoted next to the issue reminders with its source", () => {
  const preparation: DraftPreparation = {
    ...demoDraftPreparation,
    context: {
      ...demoDraftPreparation.context!,
      sources: [
        ...demoDraftPreparation.context!.sources,
        {
          id: "base:CONTRIBUTING.md",
          kind: "contributing",
          label: "CONTRIBUTING.md",
          content: "**All PRs must reference an existing issue.**",
        },
        {
          id: "base:.github/workflows/pr-standards.yml",
          kind: "automation",
          label: ".github/workflows/pr-standards.yml",
          content: "on: pull_request",
        },
      ],
    },
  };
  const html = render(preparation);
  assert.match(html, /這個專案的規範/);
  assert.match(html, /All PRs must reference an existing issue\./);
  assert.match(html, /來源：CONTRIBUTING\.md/);
  assert.match(html, /自動檢查/);
  // The demo sources carry no issue rule, so no quote is invented.
  assert.doesNotMatch(render(demoDraftPreparation), /這個專案的規範/);
});
