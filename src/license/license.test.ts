import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement } from "react";
import type { ApiErrorBody } from "../../shared/errors";
import type { LicenseSummary, ProFeature } from "../../shared/plans";
import { product } from "../../shared/product";
import { proRequiredEvent } from "../api";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { LicenseCard } from "./LicenseCard";
import { PlanChip } from "./PlanChip";
import { ProBadge } from "./ProBadge";
import { UpgradeDialog } from "./UpgradeDialog";
import {
  activateLicense,
  applyFreeModelSettings,
  deactivateLicense,
  entitlementsOf,
  isPrerelease,
  licenseChangedEvent,
  modelSettingsChangedEvent,
  requestUpgrade,
  startTrial,
  useEntitlements,
} from "./useEntitlements";

const free: LicenseSummary = {
  plan: "free",
  source: "none",
  status: "none",
  reason: "no_license",
  trialAvailable: true,
};
const trial: LicenseSummary = {
  plan: "trial",
  source: "trial",
  status: "active",
  trialDaysLeft: 14,
  trialAvailable: false,
};
const pro: LicenseSummary = {
  plan: "pro",
  source: "file",
  status: "active",
  licenseId: "lic_01JABCDEFGHJKMNPQRSTVWXYZ0",
  name: "Ada Lovelace",
  email: "ada@example.com",
  updatesUntil: "2027-10-14",
  trialAvailable: false,
};

/** Runs `fn` with product links set, as the owner will set them. */
function withLinks(links: Partial<typeof product>, fn: () => void) {
  const saved = { ...product };
  Object.assign(product, links);
  try {
    fn();
  } finally {
    Object.assign(product, saved);
  }
}

test("the PRO badge reads as a Pro feature to screen readers", () => {
  const html = renderEn(createElement(ProBadge));
  assert.equal(
    html,
    '<span class="pro-badge" role="img" aria-label="Pro feature" title="Pro feature">PRO</span>',
  );
  assertNoHan(html);
  assert.match(renderZh(createElement(ProBadge)), /aria-label="Pro 功能"/);
});

test("the plan chip shows FREE, PRO or TRIAL · Nd, and BETA in a prerelease", () => {
  const chip = (summary?: LicenseSummary, version = "1.0.0", beta = true) =>
    renderEn(createElement(PlanChip, { summary, version, beta }));
  assert.match(chip(free), />FREE<\/span>/);
  assert.match(chip(free), /aria-label="Free plan"/);
  assert.match(chip(pro), /class="plan-chip plan-chip-pro"[^>]*>PRO<\/span>/);
  assert.match(chip(trial), />TRIAL · 14d<\/span>/);
  assert.match(chip(trial), /aria-label="Pro trial, 14 days left"/);
  assert.match(chip({ ...trial, trialDaysLeft: 1 }), /aria-label="Pro trial, 1 day left"/);
  for (const summary of [free, pro, trial]) assertNoHan(chip(summary, "1.0.0-beta.0"));
  // A prerelease adds BETA beside the plan; the license card leaves it out.
  assert.match(chip(free, "1.0.0-beta.0"), />FREE<\/span><span class="beta-chip"[^>]*>BETA<\/span>/);
  assert.doesNotMatch(chip(free, "1.0.0"), /BETA/);
  assert.doesNotMatch(chip(free, "1.0.0-beta.0", false), /BETA/);
  assert.match(chip(undefined, "1.0.0-rc.1"), /^<span class="plan-chips"><span class="beta-chip"/);
  assert.equal(chip(undefined, "1.0.0"), "");
  assert.match(renderZh(createElement(PlanChip, { summary: trial, version: "1.0.0" })), />試用 · 14 天</);
  assert.ok(isPrerelease("1.0.0-beta.0"));
  assert.ok(!isPrerelease("1.0.0"));
});

function dialog(feature: ProFeature | undefined, props: Partial<Parameters<typeof UpgradeDialog>[0]> = {}) {
  const initialRequest: ApiErrorBody = { error: "", code: "pro_required", ...(feature ? { feature } : {}) };
  return createElement(UpgradeDialog, { initialRequest, summary: free, ...props });
}

test("the upgrade dialog names the feature, lists Pro and offers the trial and a key", () => {
  const html = renderEn(dialog("discovery"));
  assertNoHan(html);
  assert.match(html, /<h2 id="modal-title">Upgrade to Pro<\/h2>/);
  assert.match(html, /Discovery \(GitHub-wide recommendations\) is part of Pro\./);
  assert.match(html, /What Pro adds/);
  for (const label of ["Agent team size", "Concurrent runs", "Learning record export (Markdown)", "Web access for agents"])
    assert.ok(html.includes(label), label);
  assert.match(html, /class="upgrade-feature current"><span class="pro-badge"[^>]*>PRO<\/span><span>Discovery \(GitHub-wide recommendations\)<\/span><span class="upgrade-feature-tag">The feature you tried<\/span>/);
  // Free rows, and the license term, which is not a feature, are not in the Pro list.
  assert.doesNotMatch(html, /Learning notes page/);
  assert.doesNotMatch(html, /Pro license term/);
  assert.equal(html.match(/class="upgrade-feature( current)?"/g)?.length, 8);
  assert.match(html, />Start 14-day trial</);
  assert.match(html, />Enter license key</);
  assert.match(html, />Not now</);
  // No purchase or pricing page yet: no Buy button and no "opens soon" text.
  assert.doesNotMatch(html, /Buy Pro|Purchasing opens soon|See pricing/);
  assert.doesNotMatch(html, /Use Free settings/);
  // The server's message wins over the generic sentence.
  assert.match(
    renderEn(dialog("discovery", { initialRequest: { error: "Finding projects needs a Pro license.", feature: "discovery" } })),
    /<p class="modal-subtitle">Finding projects needs a Pro license\.<\/p>/,
  );
  assert.match(renderEn(dialog(undefined)), /Pro adds bigger and parallel agent teams/);
  assert.match(renderZh(dialog("discovery")), /升級到 Pro/);
  // Closed until an event or a request opens it.
  assert.equal(renderEn(createElement(UpgradeDialog, { summary: free })), "");
});

test("the upgrade dialog offers Free settings for model features and hides what cannot apply", () => {
  for (const feature of ["webAccess", "deepReasoning"] as const) {
    const html = renderEn(dialog(feature));
    assert.match(html, />Use Free settings</, feature);
    assert.match(html, /Turns web access off/);
    assertNoHan(html);
  }
  // The trial is offered once; a set environment key locks the license.
  assert.doesNotMatch(renderEn(dialog("discovery", { summary: { ...free, trialAvailable: false, reason: "trial_ended" } })), /Start 14-day trial/);
  const locked = renderEn(dialog("discovery", { summary: { ...free, envLocked: true } }));
  assert.doesNotMatch(locked, /Start 14-day trial|Enter license key/);
  assert.match(locked, /set with the BELLPR_LICENSE_KEY environment variable/);
  // The demo never changes the server.
  const demo = renderEn(dialog("webAccess", { demo: true }));
  assert.doesNotMatch(demo, /Start 14-day trial|Enter license key|Use Free settings/);
});

test("Buy Pro appears only with a purchase URL; a pricing URL alone says purchasing opens soon", () => {
  withLinks({ purchaseUrl: "https://shop.example/bell-pr" }, () => {
    const html = renderEn(dialog("discovery"));
    assert.match(html, /<a class="button primary" href="https:\/\/shop.example\/bell-pr" target="_blank" rel="noreferrer">Buy Pro<\/a>/);
    assert.doesNotMatch(html, /Purchasing opens soon/);
  });
  withLinks({ pricingUrl: "https://example.com/pricing" }, () => {
    const html = renderEn(dialog("discovery"));
    assert.doesNotMatch(html, /Buy Pro/);
    assert.match(html, /Purchasing opens soon\. <a href="https:\/\/example.com\/pricing" target="_blank" rel="noreferrer">See pricing<\/a>/);
  });
  assert.equal(product.purchaseUrl, "");
});

const card = (summary: LicenseSummary | undefined, props: Partial<Parameters<typeof LicenseCard>[0]> = {}) =>
  createElement(LicenseCard, { status: summary ? { license: summary } : null, ...props });

test("the license card shows a Pro license and masks the licensee when asked", () => {
  const html = renderEn(card(pro));
  assertNoHan(html);
  assert.match(html, /<h3 id="[^"]+">License<\/h3>/);
  assert.match(html, />PRO</);
  assert.doesNotMatch(html, /BETA/);
  assert.match(html, /Pro is active\./);
  assert.match(html, /<dt>License ID<\/dt><dd><code>lic_01JABCDEFGHJKMNPQRSTVWXYZ0<\/code><\/dd>/);
  assert.match(html, /<dt>Licensed to<\/dt><dd><span>Ada Lovelace<\/span><span class="license-email">ada@example.com<\/span><\/dd>/);
  assert.match(html, /<dt>Expires<\/dt><dd>Never<\/dd>/);
  assert.match(html, /<dt>Updates until<\/dt><dd>Oct 14, 2027/);
  assert.match(html, />Remove license key</);
  assert.doesNotMatch(html, /License key<\/label>|Start 14-day trial/);

  const masked = renderEn(card(pro, { maskUser: () => "•••", maskPath: () => "…" }));
  assert.doesNotMatch(masked, /Ada|ada@example/);
  assert.match(masked, /<dt>Licensed to<\/dt><dd><span>•••<\/span><\/dd>/);
  const emailOnly = renderEn(card({ ...pro, name: undefined }, { maskUser: () => "•••" }));
  assert.match(emailOnly, /<dt>Licensed to<\/dt><dd><span class="license-email">•••<\/span><\/dd>/);

  // A key from a pool carries no name or e-mail, so there is no licensee row.
  const { name: _name, email: _email, ...pooled } = pro;
  assert.doesNotMatch(renderEn(card(pooled)), /Licensed to/);
  // Expiry and the grace period.
  assert.match(renderEn(card({ ...pro, expiresAt: "2027-01-31" })), /<dt>Expires<\/dt><dd>Jan 31, 2027<\/dd>/);
  assert.match(
    renderEn(card({ ...pro, status: "grace", expiresAt: "2026-10-10" })),
    /The license has expired; Pro stays on until Oct 17, 2026\./,
  );
  const zh = renderZh(card(pro));
  assert.match(zh, /授權給/);
  assert.match(zh, /移除授權金鑰/);
});

test("the license card offers a key and the trial on Free, and the trial days during it", () => {
  const html = renderEn(card(free));
  assertNoHan(html);
  assert.match(html, />FREE</);
  assert.match(html, /Free plan\. No license key is active\./);
  assert.match(html, /<label class="field-label" for="[^"]+">License key<\/label>/);
  assert.match(html, />Activate</);
  assert.match(html, />Start 14-day trial</);
  assert.doesNotMatch(html, /Remove license key|Buy Pro/);
  assert.match(renderEn(card({ ...free, reason: "trial_ended", source: "trial", status: "expired", trialAvailable: false })), /Your 14-day Pro trial has ended\./);
  assert.match(renderEn(card({ ...free, reason: "expired", source: "file", status: "expired", licenseId: "lic_X" })), /Remove license key/);

  const during = renderEn(card({ ...trial, trialDaysLeft: 13 }));
  assert.match(during, />TRIAL · 13d</);
  assert.match(during, /Pro trial: 13 days left\./);
  assert.match(during, />Activate</);
  assert.doesNotMatch(during, /Start 14-day trial/);
  withLinks({ purchaseUrl: "https://shop.example/bell-pr" }, () => {
    assert.match(renderEn(card(free)), />Buy Pro</);
    assert.doesNotMatch(renderEn(card(pro)), /Buy Pro/);
  });
  assert.match(renderZh(card(free)), /開始 14 天試用/);
});

test("the license card is read-only when the key comes from the environment", () => {
  const html = renderEn(card({ ...pro, source: "env", envLocked: true }));
  assertNoHan(html);
  assert.match(html, /<span class="license-env-badge">Set by environment<\/span>/);
  assert.match(html, /BELLPR_LICENSE_KEY/);
  assert.doesNotMatch(html, /Remove license key|Activate|Start 14-day trial/);
  assert.match(renderEn(card(undefined)), /Checking the license…/);
});

function Probe({ status, feature, demo }: { status: { license?: LicenseSummary } | null; feature: ProFeature; demo?: boolean }) {
  const { locked, entitlements } = useEntitlements(status);
  return createElement("i", null, `${locked(feature, { demo })}:${entitlements?.plan ?? "unknown"}`);
}

test("locked(feature, {demo}) is !features[feature] && !demo, and nothing is locked while the plan is unknown", () => {
  const probe = (status: { license?: LicenseSummary } | null, demo?: boolean) =>
    renderEn(createElement(Probe, { status, feature: "discovery", demo }));
  assert.equal(probe({ license: free }), "<i>true:free</i>");
  assert.equal(probe({ license: free }, true), "<i>false:free</i>");
  assert.equal(probe({ license: trial }), "<i>false:trial</i>");
  assert.equal(probe({ license: pro }), "<i>false:pro</i>");
  assert.equal(probe(null), "<i>false:unknown</i>");
  assert.equal(entitlementsOf(free).maxTeammates, 2);
  assert.equal(entitlementsOf(free).maxActiveRuns, 1);
  assert.equal(entitlementsOf(trial).maxTeammates, 4);
  assert.equal(entitlementsOf(trial).plan, "trial");
  assert.ok(Object.values(entitlementsOf(pro).features).every(Boolean));
});

// ---------------------------------------------------------------------------
// The calls that change the license

interface Call {
  url: string;
  method: string;
  contentType: string | null;
  body?: string;
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as { window?: unknown }).window;
});

/** Stubs fetch with `answer` and window with an EventTarget that records events. */
function stub(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const events: CustomEvent[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      contentType: new Headers(init?.headers).get("Content-Type"),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    return new Response(JSON.stringify(answer(call)), {
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const target = new EventTarget();
  for (const type of [licenseChangedEvent, modelSettingsChangedEvent, proRequiredEvent])
    target.addEventListener(type, (event) => events.push(event as CustomEvent));
  Object.defineProperty(globalThis, "window", { value: target, configurable: true, writable: true });
  return { calls, events };
}

test("activating, removing and starting the trial call the license routes and announce the change", async () => {
  const { calls, events } = stub((call) => ({
    license: call.url.endsWith("/trial") ? trial : call.method === "DELETE" ? free : pro,
  }));
  assert.deepEqual(await activateLicense("BELLPR1.a.b"), pro);
  assert.deepEqual(await deactivateLicense(), free);
  assert.deepEqual(await startTrial(), trial);
  assert.deepEqual(
    calls.map(({ url, method, body }) => [url, method, body]),
    [
      ["/api/license", "PUT", '{"key":"BELLPR1.a.b"}'],
      ["/api/license", "DELETE", "{}"],
      ["/api/license/trial", "POST", "{}"],
    ],
  );
  // The server's guard needs JSON on a DELETE as well.
  assert.ok(calls.every((call) => call.contentType === "application/json"));
  assert.deepEqual(
    events.map((event) => [event.type, (event.detail as LicenseSummary).plan]),
    [
      [licenseChangedEvent, "pro"],
      [licenseChangedEvent, "free"],
      [licenseChangedEvent, "trial"],
    ],
  );
});

test("Use Free settings turns web access off, resets only a Pro-only effort and announces it", async () => {
  for (const [effort, expected] of [["xhigh", ""], ["high", "high"]] as const) {
    const { calls, events } = stub((call) =>
      call.method === "GET"
        ? { settings: { provider: "codex", model: "gpt-x", reasoningEffort: effort, webAccess: true } }
        : { settings: JSON.parse(call.body!) },
    );
    const saved = await applyFreeModelSettings();
    assert.deepEqual(JSON.parse(calls[1].body!), {
      provider: "codex",
      model: "gpt-x",
      reasoningEffort: expected,
      webAccess: false,
    });
    assert.equal(calls[1].url, "/api/model-settings");
    assert.equal(calls[1].method, "PUT");
    assert.equal(saved.webAccess, false);
    assert.equal(events[0].type, modelSettingsChangedEvent);
  }
});

test("requestUpgrade opens the dialog for a feature without a request", () => {
  const { calls, events } = stub(() => ({}));
  requestUpgrade("learningExport");
  assert.equal(calls.length, 0);
  assert.equal(events[0].type, proRequiredEvent);
  assert.deepEqual(events[0].detail, { error: "", code: "pro_required", feature: "learningExport" });
});
