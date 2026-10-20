import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { DoctorCheck, DoctorReport } from "../../shared/doctor";
import { chooseLocale, saveLocale } from "../i18n/LanguageSwitcher";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { CopyCommand } from "./CopyCommand";
import { maskedDetail } from "./mask";
import { ReadinessNotice, readinessOf } from "./ReadinessNotice";
import { SetupChecklist } from "./SetupChecklist";
import { requiredCheckFails, type DoctorState } from "./useDoctor";

const check = (value: Partial<DoctorCheck> & Pick<DoctorCheck, "id">): DoctorCheck => ({
  status: "ok",
  required: false,
  ...value,
});

/** A report as GET /api/doctor answers it: GitHub signed out, no provider ready. */
const notReady: DoctorReport = {
  checkedAt: "2026-10-14T09:30:00.000Z",
  platform: "linux",
  ready: false,
  checks: [
    check({ id: "node", required: true, version: "v22.22.1" }),
    check({ id: "git", required: true, version: "2.45.1" }),
    check({ id: "git-identity", detail: "Octo Cat <octo@example.com>" }),
    check({ id: "gh", version: "2.46.0" }),
    check({
      id: "gh-auth",
      status: "warn",
      reason: "signed-out",
      detail: "Not signed in.",
      fixes: [{ label: "Sign in to GitHub", command: "gh auth login" }],
    }),
    check({ id: "gh-scopes", status: "skip" }),
    check({
      id: "codex",
      status: "skip",
      reason: "missing",
      detail: "Not installed.",
      fixes: [{ label: "Install the Codex CLI", command: "npm install -g @openai/codex" }],
    }),
    check({ id: "codex-auth", status: "skip" }),
    check({ id: "claude", version: "2.1.292" }),
    check({
      id: "claude-auth",
      status: "warn",
      reason: "signed-out",
      detail: "Not signed in.",
      fixes: [{ label: "Sign in to Claude Code", command: "claude auth login" }],
    }),
    check({ id: "claude-sandbox", detail: "Available." }),
    check({
      id: "provider-ready",
      required: true,
      status: "fail",
      reason: "none-ready",
      detail: "Install and sign in to the Codex CLI or Claude Code.",
      fixes: [
        { label: "Install the Codex CLI", command: "npm install -g @openai/codex" },
        { label: "Sign in to Claude Code", command: "claude auth login" },
      ],
    }),
    check({
      id: "data-dir",
      required: true,
      detail: "Writable, 20 GB free.",
      params: { path: "/home/octo/.bellpr", freeBytes: 20 * 1024 ** 3 },
    }),
    check({ id: "app", version: "1.0.0", detail: "Version 1.0.0." }),
    check({ id: "platform", detail: "linux x64" }),
  ],
};

/** The same machine after signing in to GitHub and Claude Code. */
const ready: DoctorReport = {
  ...notReady,
  ready: true,
  checks: notReady.checks.map((value) =>
    value.id === "gh-auth"
      ? check({ id: "gh-auth", detail: "octocat", params: { login: "octocat" } })
      : value.id === "gh-scopes"
        ? check({ id: "gh-scopes", detail: "repo, workflow" })
        : value.id === "claude-auth"
          ? check({ id: "claude-auth", detail: "claude.ai · Max" })
          : value.id === "provider-ready"
            ? check({ id: "provider-ready", required: true, detail: "Ready: Claude Code." })
            : value,
  ),
};

const doctor = (report: DoctorReport | null, extra: Partial<DoctorState> = {}): DoctorState => ({
  report,
  checking: false,
  error: "",
  refresh: async () => undefined,
  ...extra,
});

const mask = {
  maskUser: () => "you",
  maskPath: (value: string) => value.replace("/home/octo", "~"),
};

test("the checklist shows each check with its state, version, detail and the fixes of problem rows", () => {
  const html = renderEn(createElement(SetupChecklist, { ...doctor(notReady), ...mask }));
  assertNoHan(html);
  assert.equal(html.match(/<li class="setup-check /g)?.length, notReady.checks.length);
  assert.match(html, /1 required item needs your attention\./);
  assert.match(html, /data-check="provider-ready".*?<strong>AI provider<\/strong><span class="setup-check-required">Required<\/span>.*?<span class="setup-check-status">Not ready<\/span>/);
  assert.match(html, /<code class="setup-check-version">2\.45\.1<\/code>/);
  // Fix commands appear on the rows that need attention only.
  assert.match(html, /<code>gh auth login<\/code>/);
  assert.match(html, /<code>claude auth login<\/code>/);
  assert.doesNotMatch(html, /data-check="codex".*?npm install -g @openai\/codex.*?data-check="codex-auth"/);
  assert.match(html, /aria-label="Copy the command: gh auth login"/);
  // Personal details are masked: the Git identity and the data directory.
  assert.doesNotMatch(html, /octo@example\.com|\/home\/octo/);
  assert.match(html, /Folder: ~\/\.bellpr/);
  // A problem keeps its explanation.
  assert.match(html, /data-check="gh-auth".*?<p class="setup-check-detail">Not signed in\.<\/p>/);
  assert.match(html, /data-check="claude-auth".*?<p class="setup-check-detail">Not signed in\.<\/p>/);
  assert.match(html, />Re-check</);
  assert.match(html, /Checked at /);
  // Every fix, also on rows that are fine or not used, on request.
  const all = renderEn(createElement(SetupChecklist, { report: notReady, fixes: "all" }));
  assert.match(all, /data-check="codex".*?npm install -g @openai\/codex.*?data-check="codex-auth"/s);
});

test("the checklist masks the GitHub login and the Claude account in presentations", () => {
  const html = renderEn(createElement(SetupChecklist, { ...doctor(ready), ...mask }));
  assertNoHan(html);
  assert.match(html, /Everything BELL PR needs is ready\./);
  assert.doesNotMatch(html, /octocat|claude\.ai · Max/);
  assert.equal(html.match(/<p class="setup-check-detail">you<\/p>/g)?.length, 3);
  assert.doesNotMatch(html, /setup-check-fixes/);
  const plain = renderEn(createElement(SetupChecklist, { report: ready }));
  assert.match(plain, /octocat/);
});

test("a Git identity problem keeps its words, and only the e-mail addresses are masked in presentations", () => {
  const noreply = "583231+octocat@users.noreply.github.com";
  const identity = (value: DoctorCheck): DoctorReport => ({
    ...ready,
    checks: ready.checks.map((entry) => (entry.id === "git-identity" ? value : entry)),
  });
  const guessed = check({
    id: "git-identity",
    status: "warn",
    reason: "autodetected",
    detail: "No e-mail address is set. Git guessed octo@octo-laptop.local, which would be published with your commits.",
    params: { email: "octo@octo-laptop.local", noreply },
    fixes: [{ label: "Use your private GitHub no-reply address", command: `git config --global user.email "${noreply}"` }],
  });
  const html = renderEn(createElement(SetupChecklist, { ...doctor(identity(guessed)), ...mask }));
  assertNoHan(html);
  assert.doesNotMatch(html, /octocat|583231|octo-laptop/);
  assert.match(html, /No e-mail address is set\. Git guessed you, which would be published with your commits\./);
  assert.match(html, /<code>git config --global user\.email &quot;you&quot;<\/code>/);
  const missing = check({
    id: "git-identity",
    status: "fail",
    reason: "missing",
    detail: "Not set: Git does not know your name and e-mail address, so nothing can be committed or published.",
    params: { noreply },
    fixes: guessed.fixes,
  });
  const notice = renderEn(
    createElement(ReadinessNotice, { requires: ["git-identity"], doctor: doctor(identity(missing)), ...mask }),
  );
  assertNoHan(notice);
  assert.match(notice, /Git name and e-mail: Not set: Git does not know your name and e-mail address/);
  assert.doesNotMatch(notice, /583231|octocat/);
  // Outside presentations the command is the real one.
  const plain = renderEn(createElement(SetupChecklist, { report: identity(missing) }));
  assert.match(plain, /583231\+octocat@users\.noreply\.github\.com/);
});

test("a problem's detail keeps its words, and its absolute paths are masked in presentations", () => {
  const broken = check({
    id: "codex",
    status: "warn",
    reason: "broken",
    detail:
      "Installed, but `codex --version` failed: Error: Cannot find module '/home/octo/.nvm/versions/node/v22/lib/codex.js' (see ~/.codex/log or C:\\Users\\octo\\codex.log).",
  });
  const hide = (value: string) => `…/${value.split(/[\\/]/).pop()}`;
  assert.equal(
    maskedDetail(broken, mask.maskUser, hide),
    "Installed, but `codex --version` failed: Error: Cannot find module '…/codex.js' (see …/log or …/codex.log).",
  );
  // Without a path masker, and for words, URLs and fractions, nothing changes.
  assert.equal(maskedDetail(broken, mask.maskUser), broken.detail);
  const words = check({
    id: "gh",
    status: "warn",
    reason: "broken",
    detail: "Read https://cli.github.com/manual and/or retry 1/2 times.",
  });
  assert.equal(maskedDetail(words, mask.maskUser, hide), words.detail);
  // The checklist and the readiness notice mask the same way.
  const report: DoctorReport = {
    ...notReady,
    checks: notReady.checks.map((entry) => (entry.id === "codex" ? broken : entry)),
  };
  const html = renderEn(createElement(SetupChecklist, { report, maskUser: mask.maskUser, maskPath: hide }));
  assert.doesNotMatch(html, /\/home\/octo|~\/\.codex|Users/);
  assert.match(html, /Cannot find module &#x27;…\/codex\.js&#x27;/);
  const brokenGh = { ...broken, id: "gh" as const, detail: broken.detail!.replaceAll("codex", "gh") };
  const notice = renderEn(
    createElement(ReadinessNotice, {
      requires: ["gh"],
      doctor: doctor({
        ...notReady,
        checks: notReady.checks.map((entry) => (entry.id === "gh" ? brokenGh : entry)),
      }),
      maskPath: hide,
    }),
  );
  assert.match(notice, /GitHub CLI: Installed, but `gh --version` failed: Error: Cannot find module &#x27;…\/gh\.js&#x27;/);
  assert.doesNotMatch(notice, /\/home\/octo/);
});

test("the summary says what a failing optional check blocks, and it is not called ready without a word", () => {
  const blocked: DoctorReport = {
    ...ready,
    checks: ready.checks.map((value) =>
      value.id === "git-identity"
        ? check({ id: "git-identity", status: "fail", reason: "missing", detail: "Not set." })
        : value.id === "gh-scopes"
          ? check({ id: "gh-scopes", status: "warn", reason: "missing-workflow", detail: "No workflow scope." })
          : value,
    ),
  };
  const html = renderEn(createElement(SetupChecklist, { report: blocked }));
  assertNoHan(html);
  assert.match(html, /Ready to start, but 1 item must be fixed before every step works\./);
  assert.doesNotMatch(html, /items? worth a look/);
  assert.match(renderZh(createElement(SetupChecklist, { report: blocked })), /可以開始使用，但還有 1 個項目需要修正，否則有些步驟無法進行。/);
});

test("token permissions that cannot be read are not checked, rather than not used", () => {
  const unknown: DoctorReport = {
    ...ready,
    checks: ready.checks.map((value) =>
      value.id === "gh-scopes"
        ? check({ id: "gh-scopes", status: "skip", reason: "unknown", detail: "This kind of token does not report its permissions, so they are not checked." })
        : value,
    ),
  };
  const html = renderEn(createElement(SetupChecklist, { report: unknown }));
  assertNoHan(html);
  assert.match(html, /data-check="gh-scopes".*?<span class="setup-check-status">Not checked<\/span>/);
  assert.match(html, /data-check="codex-auth".*?<span class="setup-check-status">Not used<\/span>/);
  assert.match(renderZh(createElement(SetupChecklist, { report: unknown })), /data-check="gh-scopes".*?<span class="setup-check-status">未檢查<\/span>/);
});

test("the checklist says it is checking while the first report loads, and reports a failed request", () => {
  const html = renderEn(createElement(SetupChecklist, { ...doctor(null, { checking: true }) }));
  assertNoHan(html);
  assert.match(html, /Checking your environment…/);
  assert.match(html, /aria-busy="true"/);
  assert.equal(html.match(/setup-check-checking/g)?.length, 15);
  assert.doesNotMatch(html, /Not installed|Not ready/);
  assert.match(html, /<button type="button" class="button secondary setup-recheck" disabled="">/);
  const failed = renderEn(
    createElement(SetupChecklist, { ...doctor(notReady, { error: "The server did not answer." }) }),
  );
  assert.match(failed, /role="alert">The environment check did not answer: The server did not answer\./);
});

test("the checklist summary lists only what needs attention and links to the details", () => {
  const html = renderEn(
    createElement(SetupChecklist, {
      report: notReady,
      variant: "summary",
      detailsHref: "#/settings/environment",
    }),
  );
  assertNoHan(html);
  assert.equal(html.match(/<li class="setup-check /g)?.length, 3);
  assert.doesNotMatch(html, /setup-check-fixes|<code/);
  assert.match(html, /<a class="setup-checklist-link" href="#\/settings\/environment">Open the environment settings<\/a>/);
  const fine = renderEn(createElement(SetupChecklist, { report: ready, variant: "summary" }));
  assert.match(fine, /Everything BELL PR needs is ready\./);
  assert.doesNotMatch(fine, /<ul/);
});

test("the checklist reads in zh-TW", () => {
  const html = renderZh(createElement(SetupChecklist, { ...doctor(notReady) }));
  assert.match(html, /有 1 個必要項目需要處理。/);
  assert.match(html, /<strong>AI 服務<\/strong><span class="setup-check-required">必要<\/span>/);
  assert.match(html, />重新檢查</);
  assert.match(html, /請執行以下指令修正：/);
});

test("a copyable command shows the command and a labelled copy button", () => {
  const html = renderEn(
    createElement(CopyCommand, { command: "codex login", label: "Sign in to Codex" }),
  );
  assertNoHan(html);
  assert.match(html, /<span class="copy-command-label">Sign in to Codex<\/span>/);
  assert.match(html, /<code>codex login<\/code>/);
  assert.match(html, /<button type="button" class="button secondary copy-command-button" aria-label="Copy the command: codex login">/);
  assert.match(html, /role="status" aria-live="polite"><\/span>/);
  const zh = renderZh(createElement(CopyCommand, { command: "codex login" }));
  assert.match(zh, /aria-label="複製指令：codex login"/);
  assert.match(zh, /<span>複製<\/span>/);
});

test("readiness follows the provider, GitHub and Git identity checks", () => {
  assert.deepEqual(readinessOf(null, ["provider"]), { ready: false, checking: true, missing: [] });
  const blocked = readinessOf(notReady, ["provider", "gh", "git-identity"]);
  assert.equal(blocked.ready, false);
  assert.deepEqual(
    blocked.missing.map(({ requirement, checks }) => [requirement, checks.map((value) => value.id)]),
    [
      ["provider", ["provider-ready"]],
      ["gh", ["gh-auth"]],
    ],
  );
  assert.equal(readinessOf(ready, ["provider", "gh", "git-identity"]).ready, true);
  // A guessed e-mail address still commits; a missing identity does not.
  const guessed = {
    ...ready,
    checks: ready.checks.map((value) =>
      value.id === "git-identity" ? { ...value, status: "warn" as const } : value,
    ),
  };
  assert.equal(readinessOf(guessed, ["git-identity"]).ready, true);
  const missing = {
    ...ready,
    checks: ready.checks.map((value) =>
      value.id === "git-identity" ? { ...value, status: "fail" as const } : value,
    ),
  };
  assert.equal(readinessOf(missing, ["git-identity"]).ready, false);
  // Unknown token scopes (fine-grained) do not block; missing repo access does.
  const unknownScopes = {
    ...ready,
    checks: ready.checks.map((value) =>
      value.id === "gh-scopes" ? { ...value, status: "skip" as const } : value,
    ),
  };
  assert.equal(readinessOf(unknownScopes, ["gh"]).ready, true);
  assert.equal(requiredCheckFails(notReady), true);
  assert.equal(requiredCheckFails(ready), false);
  assert.equal(requiredCheckFails(null), false);
});

test("the readiness notice explains the requirement with fixes, and renders nothing when ready or bypassed", () => {
  const html = renderEn(
    createElement(ReadinessNotice, { requires: ["provider", "gh"], doctor: doctor(notReady), maskUser: () => "you" }),
  );
  assertNoHan(html);
  assert.match(html, /This needs an AI provider: install and sign in to the Codex CLI or Claude Code\./);
  assert.match(html, /This needs the GitHub CLI, installed and signed in\./);
  assert.match(html, /Unavailable until this is fixed\./);
  assert.match(html, /AI provider: Install and sign in to the Codex CLI or Claude Code\./);
  assert.match(html, /<code>npm install -g @openai\/codex<\/code>/);
  assert.match(html, /<code>gh auth login<\/code>/);
  // The problem is told, not masked.
  assert.match(html, /GitHub sign-in: Not signed in\./);
  assert.equal(renderEn(createElement(ReadinessNotice, { requires: ["provider"], doctor: doctor(ready) })), "");
  // The demo needs no tools: nothing is shown, whatever the report says.
  assert.equal(
    renderEn(createElement(ReadinessNotice, { requires: ["provider", "gh"], doctor: doctor(notReady), bypass: true })),
    "",
  );
  assert.equal(renderEn(createElement(ReadinessNotice, { requires: ["provider"], bypass: true })), "");
  const checking = renderEn(createElement(ReadinessNotice, { requires: ["provider"], doctor: doctor(null) }));
  assert.match(checking, /Checking your environment…/);
  const zh = renderZh(createElement(ReadinessNotice, { requires: ["git-identity"], doctor: doctor({
    ...ready,
    checks: ready.checks.map((value) =>
      value.id === "git-identity"
        ? { ...value, status: "fail" as const, detail: "尚未設定。", fixes: [{ label: "設定你的名字", command: 'git config --global user.name "你的名字"' }] }
        : value,
    ),
  }) }));
  assert.match(zh, /這需要你的 Git 名字與電子郵件地址/);
  assert.match(zh, /Git 名字與電子郵件：尚未設定。/);
});

test("choosing a language also saves it in the app settings, and a failure is ignored", async (t) => {
  const previous = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = previous;
  });
  const requests: { url: string; method?: string; body?: unknown }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method, body: init?.body });
    return new Response(JSON.stringify({ settings: { locale: "zh-TW" }, lockedBy: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const changed: string[] = [];
  chooseLocale("zh-TW", (locale) => changed.push(locale));
  assert.deepEqual(changed, ["zh-TW"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requests, [
    { url: "/api/app-settings", method: "PUT", body: JSON.stringify({ locale: "zh-TW" }) },
  ]);
  // Keeping the suggested language in the welcome flow saves it the same way.
  saveLocale("en");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requests.at(-1), {
    url: "/api/app-settings",
    method: "PUT",
    body: JSON.stringify({ locale: "en" }),
  });
  // In the demo or before sign-in the request fails; nothing else happens.
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  chooseLocale("en", (locale) => changed.push(locale));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(changed, ["zh-TW", "en"]);
});
