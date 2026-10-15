import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import {
  freeEntitlements,
  proEntitlements,
  type Entitlements,
} from "../../shared/plans";
import { getDemo } from "../demo";
import type { EntitlementsState } from "../license/useEntitlements";
import { setCheckSettingsForTests } from "../app/hooks/useUnderstanding";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Run } from "../types";
import { WorkspacePage } from "./WorkspacePage";

type Props = Parameters<typeof WorkspacePage>[0];

const demo = getDemo("en");
const realRun: Run = {
  ...demo.run,
  id: "run-1",
  repoId: "repo-1",
  status: "review",
  baseSha: "c".repeat(40),
  worktreePath: "/tmp/run-1",
};

/** The plan as useEntitlements reports it. */
function planOf(entitlements: Entitlements): EntitlementsState {
  return {
    entitlements,
    locked: (feature, opts = {}) => !entitlements.features[feature] && !opts.demo,
    async refresh() {
      return undefined;
    },
  };
}

const element = (props: Partial<Props> = {}, plan = planOf(freeEntitlements)) =>
  createElement(WorkspacePage, {
    run: realRun,
    files: [],
    file: undefined,
    selectedPath: "",
    setSelectedPath() {},
    currentRepo: { ...demo.repo, id: "repo-1" },
    demo: false,
    reading: false,
    active: false,
    busy: false,
    editable: true,
    reviewRerunning: false,
    preparingDraft: false,
    additions: 0,
    deletions: 0,
    tab: "activity",
    setTab() {},
    focusMode: false,
    setFocusMode() {},
    showFiles: true,
    setShowFiles() {},
    showExplanation: true,
    setShowExplanation() {},
    codeFont: 14,
    setCodeFont() {},
    explanationWidth: 340,
    setExplanationWidth() {},
    fileSearch: "",
    setFileSearch() {},
    onlyUnreviewed: false,
    setOnlyUnreviewed() {},
    suggestedOrder: false,
    setSuggestedOrder() {},
    diffView: "unified",
    setDiffView() {},
    logFilter: "all",
    setLogFilter() {},
    intelligence: {} as Props["intelligence"],
    explanationRequests: new Set<string>(),
    async prepareExplanations() {},
    beginContribution() {},
    chooseRecommendation() {},
    draft: {
      draftDirty: false,
      draftUnfinished: undefined,
      followUp: undefined,
      commitMessageUnfinished: false,
    } as unknown as Props["draft"],
    actions: {
      plan,
      exporting: false,
      async exportLearning() {},
      async approve() {},
      async approveTeamPlan() {},
      async reviseTeamPlan() {},
      async sendTeamMessage() {},
      async retryTeam() {},
      async cancel() {},
    } as unknown as Props["actions"],
    rounds: {} as Props["rounds"],
    updatingRepo: false,
    ...props,
  });

/** The export control in the heading, from its opening tag to its end. */
const exportButton = (html: string) =>
  html.match(/<button type="button" class="export-link export-button"[^>]*>.*?<\/button>/)?.[0] ?? "";

test("on Free the learning export is a locked button with the PRO badge, never a download link", () => {
  const html = renderEn(element());
  const button = exportButton(html);
  assert.match(button, /lucide-lock/);
  assert.match(button, /Export learning record \(Markdown\)/);
  assert.match(button, /aria-label="Pro feature"/);
  assert.doesNotMatch(html, /<a [^>]*\bdownload\b/);
  assert.doesNotMatch(html, /export\.md/);
  assertNoHan(html);
});

test("on Pro the export saves the record, and the sample shows the PRO chip", () => {
  const pro = exportButton(renderEn(element({}, planOf(proEntitlements(2)))));
  assert.match(pro, /lucide-arrow-down-to-line/);
  assert.doesNotMatch(pro, /Pro feature/);
  const sample = renderEn(
    element({ run: demo.run, demo: true, editable: false }),
  );
  const button = exportButton(sample);
  assert.match(button, /lucide-arrow-down-to-line/);
  assert.match(button, /aria-label="Pro feature"/);
  assert.match(sample, /Sample data · never sent to GitHub/);
  assertNoHan(sample);
});

test("the current workflow step is marked as the current step", () => {
  const html = renderEn(element());
  const steps = html.match(/<div class="workflow-step[^"]*"[^>]*>/g) ?? [];
  assert.equal(steps.length, 4);
  assert.deepEqual(
    steps.map((step) => /aria-current="step"/.test(step)),
    [false, false, true, false],
  );
  // A failed run is current nowhere.
  assert.doesNotMatch(
    renderEn(element({ run: { ...realRun, status: "failed" } })),
    /aria-current="step"/,
  );
});

test("an unsandboxed run carries the warning badge; a sandboxed one does not", () => {
  assert.match(
    renderEn(element({ run: { ...realRun, unsandboxed: true } })),
    /<span class="unsandboxed-badge"><a href="#\/settings\/safety"/,
  );
  assert.doesNotMatch(renderEn(element()), /unsandboxed-badge/);
  assert.match(
    renderZh(element({ run: { ...realRun, unsandboxed: true } })),
    /未使用沙箱執行/,
  );
});

test("a queued run says why on Free only", () => {
  const queued = { ...realRun, status: "queued" as const };
  assert.match(
    renderEn(element({ run: queued, active: true })),
    /Queued: Free runs one contribution at a time/,
  );
  assert.doesNotMatch(
    renderEn(element({ run: queued, active: true }, planOf(proEntitlements(2)))),
    /Free runs one contribution/,
  );
  // The sample's playback is queued for a moment behind no other run.
  assert.doesNotMatch(
    renderEn(
      element({
        run: { ...demo.run, status: "queued" },
        demo: true,
        editable: false,
        active: true,
      }),
    ),
    /Free runs one contribution/,
  );
});

test("a published sample keeps its approve button off and links to no PR", () => {
  const html = renderEn(
    element({
      run: { ...demo.run, status: "published", prUrl: "#demo-pr" },
      demo: true,
      editable: false,
      files: demo.files,
    }),
  );
  assert.doesNotMatch(html, /href="#demo-pr"/);
  assert.match(
    html,
    /<button class="button primary" disabled=""[^>]*>.*?Approve and prepare the PR/,
  );
  assertNoHan(html);
  // A real published run links to its pull request.
  const real = renderEn(
    element({
      run: { ...realRun, status: "published", prUrl: "https://github.com/acme/widgets/pull/3" },
    }),
  );
  assert.match(real, /href="https:\/\/github\.com\/acme\/widgets\/pull\/3"/);
  assert.match(real, /View pull request/);
});

/** The footer's primary button, from its opening tag to its end. */
const primary = (html: string) =>
  html.match(/<footer class="review-footer">.*<button class="button primary"[^>]*>.*?<\/button>/)?.[0]?.replace(/^.*(<button class="button primary")/, "$1") ?? "";

test("once every file is ticked, the footer asks to explain the change back first", () => {
  const files = demo.files.map((file) => ({ ...file, fingerprint: file.path }));
  const ticked = { ...realRun, reviewedFiles: files.map((file) => file.path) };
  const html = renderEn(element({ run: ticked, files }));
  const button = primary(html);
  assert.match(button, /Explain it back/);
  assert.doesNotMatch(button, /disabled=""/);
  assert.match(button, /title="Explain the change back in your own words: a short, closed-book check next to the code"/);
  assert.match(html, /<span>Every file reviewed\.<\/span>/);
  assert.match(html, /Read it, then explain it back/);
  assertNoHan(html);
  // Before every file is ticked, the tooltip names both remaining steps.
  const partial = primary(renderEn(element({ run: realRun, files })));
  assert.match(partial, /disabled=""/);
  assert.match(partial, /title="Mark every file as reviewed, then explain the change back in your own words"/);
  assert.match(partial, /Approve and prepare the PR/);
  assert.match(renderZh(element({ run: ticked, files })), /<span>每一個檔案都已審閱。<\/span>/);
});

test("with the check turned off, approval needs the ticks only, and the run says so", () => {
  const files = demo.files.map((file) => ({ ...file, fingerprint: file.path }));
  const ticked = { ...realRun, reviewedFiles: files.map((file) => file.path) };
  try {
    setCheckSettingsForTests({ settings: { skipUnderstandingCheck: true }, lockedBy: {} });
    const html = renderEn(element({ run: ticked, files }));
    assert.match(primary(html), /Approve and prepare the PR/);
    assert.match(
      html,
      /<span>Every file reviewed · Understanding check off\. Approval needs your reviewed ticks only\.<\/span>/,
    );
    assert.match(html, /class="unsandboxed-badge check-off-badge"/);
    assert.match(html, /The understanding check is off, so you can approve without explaining the change back\./);
    assertNoHan(html);
  } finally {
    setCheckSettingsForTests(undefined);
  }
  // A run approved without the check keeps its badge, whatever the setting says now.
  const marked = renderEn(element({ run: { ...ticked, status: "approved", understandingCheckOff: true }, files }));
  assert.match(marked, /This run was approved without explaining the change back first\./);
  assert.doesNotMatch(renderEn(element({ run: ticked, files })), /check-off-badge/);
});
