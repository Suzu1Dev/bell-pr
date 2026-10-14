import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { AppSettingsView } from "../../shared/app-settings";
import type { DoctorCheck, DoctorReport } from "../../shared/doctor";
import { freeEntitlements, proEntitlements, type LicenseSummary } from "../../shared/plans";
import { product } from "../../shared/product";
import type { Status } from "../app/hooks/useAppData";
import { withoutOtherLanguages } from "../app/test-markup";
import type { DoctorState } from "../setup/useDoctor";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { appVersion } from "../version";
import { AboutSection } from "./AboutSection";
import { DataSection } from "./DataSection";
import { EnvironmentSection } from "./EnvironmentSection";
import { GeneralSection } from "./GeneralSection";
import { LicenseSection } from "./LicenseSection";
import { PerformanceSection } from "./PerformanceSection";
import { ProviderSection } from "./ProviderSection";
import { SafetySection } from "./SafetySection";
import { SettingsPage, sectionHref } from "./SettingsPage";
import type { AppSettingsState } from "./useAppSettings";

const check = (value: Partial<DoctorCheck> & Pick<DoctorCheck, "id">): DoctorCheck => ({
  status: "ok",
  required: false,
  ...value,
});

/** A machine with Claude Code signed in, Codex missing and GitHub connected. */
const report: DoctorReport = {
  checkedAt: "2026-10-14T09:30:00.000Z",
  platform: "linux",
  ready: true,
  checks: [
    check({ id: "node", required: true, version: "v22.22.1" }),
    check({ id: "git", required: true, version: "2.45.1" }),
    check({ id: "git-identity", detail: "Real Person <person@example.com>" }),
    check({ id: "gh", version: "2.46.0" }),
    check({ id: "gh-auth", detail: "real-user", params: { login: "real-user" } }),
    check({ id: "gh-scopes", detail: "repo, workflow" }),
    check({
      id: "codex",
      status: "skip",
      reason: "missing",
      detail: "Not installed.",
      fixes: [{ label: "Install the Codex CLI", command: "npm install -g @openai/codex" }],
    }),
    check({ id: "codex-auth", status: "skip" }),
    check({ id: "claude", version: "2.1.292" }),
    check({ id: "claude-auth", detail: "person@example.com (Claude Max)" }),
    check({
      id: "claude-sandbox",
      status: "warn",
      reason: "missing",
      detail: "Not available: install bubblewrap and socat.",
      fixes: [{ label: "Install bubblewrap and socat", command: "sudo apt install bubblewrap socat" }],
    }),
    check({
      id: "provider-ready",
      required: true,
      detail: "Ready: Claude Code.",
      params: { providers: "claude" },
    }),
    check({
      id: "data-dir",
      required: true,
      detail: "Writable, 20 GB free.",
      params: { path: "/home/real-user/.bellpr", freeBytes: 20 * 1024 ** 3 },
    }),
    check({ id: "app", version: "1.0.0" }),
    check({ id: "platform", detail: "linux x64" }),
  ],
};

/** No agent CLI works: both missing, so no provider is ready. */
const noProvider: DoctorReport = {
  ...report,
  ready: false,
  checks: report.checks.map((value) =>
    value.id === "claude"
      ? check({
          id: "claude",
          status: "skip",
          reason: "missing",
          detail: "Not installed.",
          fixes: [{ label: "Install Claude Code", command: "npm install -g @anthropic-ai/claude-code" }],
        })
      : value.id === "claude-auth"
        ? check({ id: "claude-auth", status: "skip" })
        : value.id === "provider-ready"
          ? check({
              id: "provider-ready",
              required: true,
              status: "fail",
              reason: "none-ready",
              detail: "Install and sign in to the Codex CLI or Claude Code.",
            })
          : value,
  ),
};

const doctor = (value: DoctorReport | null): DoctorState => ({
  report: value,
  checking: value === null,
  error: "",
  refresh: async () => undefined,
});

const appSettings = (view: AppSettingsView | null): AppSettingsState => ({
  view,
  error: "",
  save: async () => view ?? { settings: {}, lockedBy: {} },
  reload: async () => undefined,
});

const presenting = {
  maskUser: (value: string) => (value ? "you" : value),
  maskPath: (value: string) => `…/${value.split("/").pop()}`,
};
const plain = { maskUser: (value: string) => value, maskPath: (value: string) => value };

const status: Status = {
  codex: false,
  codexAuthenticated: false,
  claude: true,
  claudeAuthenticated: true,
  github: true,
  githubUser: "real-user",
  limits: { maxActiveRuns: 2, maxAgentProcesses: 3, maxQueued: 8 },
};

const page = (value: Status | null) =>
  createElement(SettingsPage, {
    status: value,
    setStatus() {},
    setApiError() {},
    notify() {},
    configureContributionModels() {},
    setTab() {},
    navigate() {},
  });

/** The text a person reads: tags and attributes dropped. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ");

test("the settings page lists its sections, each at its own address, and opens on General", () => {
  const html = renderEn(page(status));
  assertNoHan(withoutOtherLanguages(html));
  assert.match(html, /<span class="eyebrow">SETTINGS<\/span><h1 tabindex="-1">Get your workspace ready\.<\/h1>/);
  assert.match(html, /<nav class="settings-nav" aria-label="Settings sections">/);
  const links = [...html.matchAll(/<a href="([^"]+)"[^>]*data-section="(\w+)"/g)].map(
    ([, href, section]) => [href, section],
  );
  assert.deepEqual(links, [
    ["#/settings/general", "general"],
    ["#/settings/provider", "provider"],
    ["#/settings/safety", "safety"],
    ["#/settings/performance", "performance"],
    ["#/settings/environment", "environment"],
    ["#/settings/data", "data"],
    ["#/settings/license", "license"],
    ["#/settings/about", "about"],
  ]);
  // Without an address the first section is the current one.
  assert.match(html, /href="#\/settings\/general" aria-current="page"/);
  assert.match(html, /<h2 id="settings-general-title">General<\/h2>/);
  assert.doesNotMatch(renderZh(page(null)), /General/);
});

test("a section link keeps the presentation flags", () => {
  assert.equal(
    sectionHref("data", { present: "1", locale: "en" }),
    "#/settings/data?present=1&locale=en",
  );
  assert.equal(sectionHref("about"), "#/settings/about");
});

test("General has the language, the sample project switch and its reset", () => {
  const view = { settings: { showSampleProject: true }, lockedBy: {} };
  const html = renderEn(createElement(GeneralSection, { settings: appSettings(view) }));
  assertNoHan(withoutOtherLanguages(html));
  assert.match(
    html,
    /<label for="settings-language">Language<\/label><select id="settings-language" class="settings-language-select" aria-label="Language">/,
  );
  assert.match(html, /<input id="[^"]+" type="checkbox"[^>]* checked=""\/><div class="settings-switch-body"><label for="[^"]+">Show the sample project<\/label>/);
  assert.match(html, /aria-expanded="false"[^>]*><svg[^>]*>.*?<\/svg>Reset sample project<\/button>/);
  // While the settings load, the switch waits.
  const loading = renderEn(createElement(GeneralSection, { settings: appSettings(null) }));
  assert.match(loading, /type="checkbox" disabled=""/);
  assert.match(renderZh(createElement(GeneralSection, { settings: appSettings(view) })), /顯示範例專案/);
});

test("AI provider shows each CLI's state, needs one provider, and keeps the Claude copy neutral", () => {
  const html = renderEn(
    createElement(ProviderSection, { doctor: doctor(report), ...plain, showCurrentRun() {} }),
  );
  assertNoHan(html);
  assert.match(html, /Ready to work with Claude Code\./);
  const card = (name: string) =>
    html.match(new RegExp(`<h3>${name}</h3>.*?<span class="service-status[^"]*">([^<]+)</span>`))?.[1];
  assert.equal(card("Codex CLI"), "Not installed");
  assert.equal(card("Claude Code"), "Ready");
  assert.match(html, /<code>npm install -g @openai\/codex<\/code>/);
  assert.match(html, /person@example\.com \(Claude Max\)/);
  assert.ok(
    html.includes(
      "Uses the Claude Code CLI you installed and signed in to (Claude plan or Anthropic API key). Usage counts against your own account.",
    ),
  );
  // The models are edited in place; they load after the first render.
  assert.match(html, /Loading model settings…/);

  const none = renderEn(
    createElement(ProviderSection, { doctor: doctor(noProvider), ...plain, showCurrentRun() {} }),
  );
  assert.match(none, /class="settings-readiness not-ready" role="status">.*?You need at least one provider\./);
  assert.match(none, /<code>npm install -g @anthropic-ai\/claude-code<\/code>/);

  // Before the first report nothing reads as missing.
  const checking = renderEn(
    createElement(ProviderSection, { doctor: doctor(null), ...plain, showCurrentRun() {} }),
  );
  assert.doesNotMatch(checking, /Not installed|Not signed in/);
  assert.equal(checking.match(/>Checking…<\/span>/g)?.length, 2);
});

test("the retired plan and billing wording is gone from every section, in both languages", () => {
  // Spelled with escapes, so that a search of the source for the wording
  // comes back empty.
  const retired = [
    /sub\u0073cription|\u8a02\u95b1/i,
    /API\u0020billing|API \u8a08\u8cbb/i,
    /system\u0064|\.config\/bell-pr/,
  ];
  assert.match("Claude \u8a02\u95b1", retired[0]);
  assert.match("Sub\u0073cription, not API\u0020billing", retired[1]);
  const view = { settings: {}, lockedBy: {} };
  const sections = [
    createElement(GeneralSection, { settings: appSettings(view) }),
    createElement(ProviderSection, { doctor: doctor(report), ...plain, showCurrentRun() {} }),
    createElement(SafetySection, {
      doctor: doctor(report),
      settings: appSettings(view),
      ...plain,
      webAccessLocked: true,
      providerHref: "#/settings/provider",
    }),
    createElement(PerformanceSection, {
      settings: appSettings(view),
      limits: status.limits,
      entitlements: freeEntitlements,
      onSaved() {},
    }),
    createElement(EnvironmentSection, { doctor: doctor(report), refresh() {}, ...plain }),
    createElement(DataSection, { doctor: doctor(report), settings: appSettings(view), ...plain }),
  ];
  for (const element of sections)
    for (const html of [renderEn(element), renderZh(element)])
      for (const pattern of retired) assert.doesNotMatch(html, pattern);
});

test("Agent safety shows the sandbox, the unsandboxed opt-in, web access and the AI note", () => {
  const props = {
    doctor: doctor(report),
    ...plain,
    webAccessLocked: true,
    providerHref: "#/settings/provider?present=1",
  };
  const html = renderEn(
    createElement(SafetySection, {
      ...props,
      settings: appSettings({ settings: { alwaysDiscloseAi: true }, lockedBy: {} }),
    }),
  );
  assertNoHan(html);
  assert.match(html, /<h3>Claude Code sandbox<\/h3><span class="service-status">Check<\/span>/);
  assert.match(html, /Not available: install bubblewrap and socat\./);
  assert.match(html, /<code>sudo apt install bubblewrap socat<\/code>/);
  assert.match(html, /<input id="[^"]+" type="checkbox" aria-describedby="[^"]+"\/><div class="settings-switch-body"><label for="[^"]+">Allow unsandboxed Claude Code agents<\/label>/);
  assert.match(html, /<h3>Web access<\/h3><span class="pro-badge"/);
  assert.match(html, /<a class="settings-link" href="#\/settings\/provider\?present=1">Open the AI provider settings<\/a>/);
  assert.match(html, /type="checkbox"[^>]* checked=""\/><div class="settings-switch-body"><label for="[^"]+">Always add an AI-assistance note to my pull requests<\/label>/);
  assert.match(html, /pull request drafts mention AI only when the project&#x27;s own rules ask for it/);
  // No confirmation is open until the switch is turned on.
  assert.doesNotMatch(html, /role="dialog"/);

  // An environment variable sets the opt-in: read-only, with a badge.
  const locked = renderEn(
    createElement(SafetySection, {
      ...props,
      settings: appSettings({
        settings: { allowUnsandboxedAgents: true },
        lockedBy: { allowUnsandboxedAgents: "BELLPR_ALLOW_UNSANDBOXED_AGENTS" },
      }),
    }),
  );
  assert.match(locked, /type="checkbox" disabled=""[^>]* checked=""\/>/);
  assert.match(locked, /Set by environment<\/span><span>The BELLPR_ALLOW_UNSANDBOXED_AGENTS environment variable sets this\./);
  const zh = renderZh(
    createElement(SafetySection, { ...props, settings: appSettings({ settings: {}, lockedBy: {} }) }),
  );
  assert.match(zh, /一律在我的 pull request 加上 AI 協助說明/);
});

test("Performance edits the limits, shows what Free runs and marks a locked limit", () => {
  const html = renderEn(
    createElement(PerformanceSection, {
      settings: appSettings({ settings: { maxActiveRuns: 3 }, lockedBy: {} }),
      limits: { ...status.limits!, maxActiveRuns: 3, maxQueued: 8 },
      entitlements: freeEntitlements,
      onSaved() {},
    }),
  );
  assertNoHan(html);
  const field = (label: string) =>
    html.match(new RegExp(`<label for="[^"]+">${label}</label><input [^>]*>`))?.[0] ?? "";
  assert.match(field("Runs at the same time"), /type="number"[^>]*min="1" max="8" step="1"[^>]* value="3"/);
  assert.match(field("Agent CLI processes at the same time"), /min="1" max="32" step="1"[^>]* value="3"/);
  assert.match(field("Agent timeout multiplier"), /min="0.5" max="10" step="0.1"[^>]* value="1"/);
  assert.match(html, /Configured 3, effective 1 \(Free\)\.<\/span><span class="pro-badge"/);
  assert.match(html, /Heavy parallel use of a personal Claude plan may exceed its intended individual use\./);
  assert.match(html, /Up to 8 runs can be running, queued or waiting for plan approval at once\./);
  // Nothing changed yet, so there is nothing to save.
  assert.match(html, /<button type="submit" class="button primary" aria-disabled="true">/);

  const locked = renderEn(
    createElement(PerformanceSection, {
      settings: appSettings({
        settings: { maxActiveRuns: 2 },
        lockedBy: { maxActiveRuns: "BELLPR_MAX_ACTIVE_RUNS" },
      }),
      limits: status.limits,
      entitlements: proEntitlements(8),
      onSaved() {},
    }),
  );
  assert.match(locked, /<input [^>]*disabled=""[^>]* value="2"\/>/);
  assert.match(locked, /<span class="settings-lock-badge">.*?Set by environment<\/span><span>The BELLPR_MAX_ACTIVE_RUNS environment variable sets this\./);
  // Pro runs what is configured: no Free line.
  assert.doesNotMatch(locked, /effective/);
  assert.match(
    renderZh(
      createElement(PerformanceSection, {
        settings: appSettings({ settings: {}, lockedBy: {} }),
        limits: status.limits,
        entitlements: freeEntitlements,
        onSaved() {},
      }),
    ),
    /設定為 2，實際為 1（Free）。/,
  );
  // Until the settings and the limits arrive the form waits.
  const waiting = renderEn(
    createElement(PerformanceSection, {
      settings: appSettings(null),
      entitlements: freeEntitlements,
      onSaved() {},
    }),
  );
  assert.match(waiting, /role="status">Loading…/);
});

test("Environment shows the GitHub connection without the brand icon, the checklist and the variables", () => {
  const html = renderEn(
    createElement(EnvironmentSection, { doctor: doctor(report), refresh() {}, ...plain }),
  );
  assertNoHan(html);
  assert.match(html, /<h3>GitHub CLI<\/h3><p>Connected as real-user<\/p><\/div><span class="service-status connected">Connected<\/span>/);
  assert.match(html, /lucide-git-pull-request/);
  assert.doesNotMatch(html, /lucide-github/);
  assert.match(html, /class="setup-checklist"/);
  assert.match(html, />Re-check</);
  const advanced = html.match(/<details class="settings-advanced">.*?<\/details>/)?.[0] ?? "";
  assert.match(advanced, /<summary>Advanced: environment variables<\/summary>/);
  for (const variable of [
    "BELLPR_MAX_ACTIVE_RUNS",
    "BELLPR_MAX_AGENT_PROCESSES",
    "BELLPR_AGENT_TIMEOUT_SCALE",
    "BELLPR_ALLOW_UNSANDBOXED_AGENTS",
    "BELLPR_LOG_LEVEL",
  ])
    assert.match(advanced, new RegExp(`<code>${variable}</code>`));
  assert.match(advanced, /<code>BELLPR_RETENTION_DAYS<\/code><\/dt><dd>Days to keep the files of stopped and failed runs: 1 to 365, default 14\.<\/dd>/);
  // No documentation link, and no sentence pointing to one, while the
  // product has no docs URL.
  assert.doesNotMatch(advanced, /<a |documentation/);
  const saved = product.docsUrl;
  product.docsUrl = "https://docs.example.test/";
  try {
    const linked = renderEn(
      createElement(EnvironmentSection, { doctor: doctor(report), refresh() {}, ...plain }),
    );
    assert.match(linked, /<a href="https:\/\/docs\.example\.test\/" target="_blank" rel="noreferrer">See the documentation\.<\/a>/);
  } finally {
    product.docsUrl = saved;
  }
  // Signed out, the row says what GitHub is for.
  const signedOut = renderEn(
    createElement(EnvironmentSection, {
      doctor: doctor({
        ...report,
        checks: report.checks.map((value) =>
          value.id === "gh-auth" ? check({ id: "gh-auth", status: "warn", reason: "signed-out" }) : value,
        ),
      }),
      refresh() {},
      ...plain,
    }),
  );
  assert.match(signedOut, /<p>Import projects, push branches and open Draft PRs<\/p><\/div><span class="service-status">Not signed in<\/span>/);
});

test("while presenting, no section shows the login, the account, the licensee or a full path", () => {
  const license: LicenseSummary = {
    plan: "pro",
    source: "file",
    status: "active",
    licenseId: "lic_01",
    name: "Real Person",
    email: "licensee@example.com",
  };
  const view = { settings: {}, lockedBy: {} };
  const sections = [
    createElement(ProviderSection, { doctor: doctor(report), ...presenting, showCurrentRun() {} }),
    createElement(SafetySection, {
      doctor: doctor(report),
      settings: appSettings(view),
      ...presenting,
      webAccessLocked: false,
      providerHref: "#/settings/provider",
    }),
    createElement(EnvironmentSection, { doctor: doctor(report), refresh() {}, ...presenting }),
    createElement(DataSection, { doctor: doctor(report), settings: appSettings(view), ...presenting }),
    createElement(LicenseSection, { status: { license }, ...presenting }),
  ];
  for (const element of sections) {
    const html = renderEn(element);
    assert.doesNotMatch(html, /real-user|person@example\.com|Real Person|licensee@example\.com|\/home\//);
  }
  const environment = renderEn(sections[2]);
  assert.match(environment, /Connected as you/);
  assert.match(environment, /Folder: …\/\.bellpr/);
  assert.match(renderEn(sections[3]), /<code>…\/\.bellpr<\/code>/);
  assert.match(renderEn(sections[3]), /aria-label="Copy the data directory&#x27;s path"/);
  assert.match(renderEn(sections[4]), /<span>you<\/span>/);
  // Not presenting, the same sections show them.
  assert.match(
    renderEn(createElement(EnvironmentSection, { doctor: doctor(report), refresh() {}, ...plain })),
    /Connected as real-user/,
  );
  // A broken CLI's error loses the folders of the paths it names.
  const broken = {
    ...report,
    checks: report.checks.map((value) =>
      value.id === "codex"
        ? check({
            id: "codex",
            status: "warn",
            reason: "broken",
            detail: "Installed, but `codex --version` failed: Cannot find module '/home/real-user/.nvm/codex.js'",
          })
        : value,
    ),
  };
  const provider = renderEn(
    createElement(ProviderSection, { doctor: doctor(broken), ...presenting, showCurrentRun() {} }),
  );
  assert.doesNotMatch(provider, /\/home\/|real-user/);
  assert.match(provider, /Cannot find module &#x27;…\/codex\.js&#x27;/);
});

test("Data & privacy has the data directory, storage, retention, erasing and the privacy summary", () => {
  const html = renderEn(
    createElement(DataSection, {
      doctor: doctor(report),
      settings: appSettings({ settings: { retentionDays: 30 }, lockedBy: {} }),
      ...plain,
    }),
  );
  assertNoHan(html);
  assert.match(html, /<h3>Data directory<\/h3>.*?<code>\/home\/real-user\/\.bellpr<\/code>/);
  assert.match(html, /<h3>Storage<\/h3>/);
  assert.match(html, /Measuring the data directory…/);
  assert.match(html, /<label for="[^"]+">Days to keep the files of stopped and failed runs<\/label><input [^>]*min="1" max="365" step="1"[^>]* value="30"/);
  assert.match(html, /Published runs are kept until you free them\./);
  assert.match(html, /<h3>Delete all data<\/h3>/);
  assert.match(html, /aria-expanded="false"[^>]*>.*?Delete all data…<\/button>/);
  assert.match(html, /<h3>What leaves this computer<\/h3>/);
  assert.match(html, /<a class="settings-link" href="\/legal\/PRIVACY\.txt" target="_blank" rel="noreferrer">Read the privacy policy/);
  const locked = renderEn(
    createElement(DataSection, {
      doctor: doctor(null),
      settings: appSettings({
        settings: { retentionDays: 7 },
        lockedBy: { retentionDays: "BELLPR_RETENTION_DAYS" },
      }),
      ...plain,
    }),
  );
  assert.match(locked, /<input [^>]*disabled=""[^>]* value="7"\/>/);
  assert.match(locked, /The BELLPR_RETENTION_DAYS environment variable sets this\./);
  assert.match(locked, /<h3>Data directory<\/h3><\/div><p class="settings-help" role="status">Checking…<\/p>/);
  assert.match(renderZh(createElement(DataSection, { doctor: doctor(report), settings: appSettings(null), ...plain })), /資料與隱私/);
});

test("License shows the license card with the plan chip, and About the version and the About link", () => {
  const trial: LicenseSummary = {
    plan: "trial",
    source: "trial",
    status: "active",
    trialDaysLeft: 14,
  };
  const license = renderEn(createElement(LicenseSection, { status: { license: trial }, ...plain }));
  assertNoHan(license);
  assert.match(license, /<h2 id="settings-license-title">License<\/h2>/);
  assert.match(license, /class="license-card"/);
  assert.match(license, />TRIAL · 14d<\/span>/);
  const about = renderEn(createElement(AboutSection, { aboutHref: "#/about?present=1" }));
  assertNoHan(about);
  assert.ok(about.includes(`<code>${appVersion}</code>`));
  assert.match(about, /<a class="button secondary" href="#\/about\?present=1">.*?About BELL PR<\/a>/);
  // Product links show only once they are set.
  assert.doesNotMatch(about, /Documentation|Website/);
  assert.match(renderZh(createElement(AboutSection, { aboutHref: "#/about" })), /關於 BELL PR/);
});

test("every section reads in English with no Chinese left, and in zh-TW", () => {
  const view = { settings: {}, lockedBy: {} };
  const elements = [
    createElement(GeneralSection, { settings: appSettings(view) }),
    createElement(ProviderSection, { doctor: doctor(noProvider), ...plain, showCurrentRun() {} }),
    createElement(SafetySection, {
      doctor: doctor(null),
      settings: appSettings(view),
      ...plain,
      webAccessLocked: false,
      providerHref: "#/settings/provider",
    }),
    createElement(PerformanceSection, {
      settings: appSettings(view),
      limits: status.limits,
      entitlements: proEntitlements(8),
      onSaved() {},
    }),
    createElement(EnvironmentSection, { doctor: doctor(null), refresh() {}, ...plain }),
    createElement(DataSection, { doctor: doctor(null), settings: appSettings(view), ...plain }),
    createElement(LicenseSection, { status: null, ...plain }),
    createElement(AboutSection, { aboutHref: "#/about" }),
  ];
  for (const element of elements) {
    assertNoHan(withoutOtherLanguages(renderEn(element)));
    assert.match(text(renderZh(element)), /\p{Script=Han}/u);
  }
});
