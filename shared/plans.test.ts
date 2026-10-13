import test from "node:test";
import assert from "node:assert/strict";
import { defaultContributionSettings } from "./insights.js";
import { reasoningEfforts } from "./models.js";
import * as plans from "./plans.js";
import {
  clampContributionSettings,
  freeEntitlements,
  planFeatureIds,
  planFeatureTable,
  proEntitlements,
  proFeatures,
  proOnlyEfforts,
  type Entitlements,
} from "./plans.js";
import en from "./i18n/plans.en.js";
import zh from "./i18n/plans.zh-TW.js";

const trial: Entitlements = { ...proEntitlements(2), plan: "trial" };

test("Free lowers 3 or 4 teammates to 2 and says so", () => {
  for (const maxTeammates of [3, 4] as const) {
    const settings = { ...defaultContributionSettings, maxTeammates };
    const result = clampContributionSettings(settings, freeEntitlements);
    assert.deepEqual(result, {
      settings: { ...settings, maxTeammates: 2 },
      clamped: true,
    });
    // The caller's object is not modified.
    assert.equal(settings.maxTeammates, maxTeammates);
  }
});

test("Pro and the trial leave the team size unchanged", () => {
  for (const ent of [proEntitlements(2), trial])
    for (const maxTeammates of [2, 3, 4] as const) {
      const settings = { ...defaultContributionSettings, maxTeammates };
      const result = clampContributionSettings(settings, ent);
      assert.equal(result.clamped, false);
      assert.equal(result.settings, settings);
    }
});

test("clamping never raises a team of 2", () => {
  for (const ent of [freeEntitlements, proEntitlements(1), trial]) {
    const result = clampContributionSettings({ maxTeammates: 2 as const }, ent);
    assert.deepEqual(result, { settings: { maxTeammates: 2 }, clamped: false });
  }
});

test("Free grants no Pro feature, one active run and 2 teammates", () => {
  assert.equal(freeEntitlements.plan, "free");
  assert.equal(freeEntitlements.maxTeammates, 2);
  assert.equal(freeEntitlements.maxActiveRuns, 1);
  assert.deepEqual(Object.keys(freeEntitlements.features).sort(), [...proFeatures].sort());
  assert.ok(Object.values(freeEntitlements.features).every((on) => on === false));
  // A shared constant must not be unlocked by accident.
  assert.ok(Object.isFrozen(freeEntitlements));
  assert.ok(Object.isFrozen(freeEntitlements.features));
});

test("Pro grants every feature, 4 teammates and the configured concurrency", () => {
  const pro = proEntitlements(3);
  assert.equal(pro.plan, "pro");
  assert.equal(pro.maxTeammates, 4);
  assert.equal(pro.maxActiveRuns, 3);
  assert.deepEqual(Object.keys(pro.features).sort(), [...proFeatures].sort());
  assert.ok(Object.values(pro.features).every((on) => on === true));
  // Each call returns its own object.
  assert.notEqual(proEntitlements(3).features, pro.features);
  for (const invalid of [0, -1, 1.5, Number.NaN])
    assert.throws(() => proEntitlements(invalid), RangeError);
});

test("re-running the review is Free and Pro-only efforts are real efforts", () => {
  assert.equal((proFeatures as readonly string[]).includes("reviewRerun"), false);
  assert.deepEqual([...proOnlyEfforts], ["xhigh", "max", "ultra"]);
  for (const effort of proOnlyEfforts) assert.ok(reasoningEfforts.includes(effort));
});

test("the plan table has the 19 rows in order, and every Pro feature gates one row", () => {
  assert.equal(planFeatureIds.length, 19);
  assert.deepEqual(planFeatureTable.map((row) => row.id), [...planFeatureIds]);
  for (const feature of proFeatures) {
    const rows = planFeatureTable.filter((row) => row.feature === feature);
    assert.equal(rows.length, 1, feature);
    assert.notEqual(rows[0].tier, "free", feature);
  }
  const tier = (id: string) => planFeatureTable.find((row) => row.id === id)?.tier;
  assert.equal(tier("reviewRerun"), "free");
  assert.equal(tier("teamSize"), "free-limited");
  assert.equal(tier("parallelRuns"), "free-limited");
  assert.equal(tier("discovery"), "pro");
  assert.equal(tier("licenseTerm"), "pro");
});

test("the purchase link is not part of the plans module", () => {
  assert.equal("purchaseUrl" in plans, false);
});

test("both locales have label and limit copy for every row and tier", () => {
  for (const copy of [en, zh]) {
    for (const id of planFeatureIds) {
      assert.ok(copy.features[id].label.trim(), id);
      assert.ok(copy.features[id].limit.trim(), id);
    }
    for (const row of planFeatureTable) assert.ok(copy.tiers[row.tier].trim());
    assert.ok(Object.values(copy.columns).every((text) => text.trim()));
  }
  assert.deepEqual(Object.keys(zh.features), Object.keys(en.features));
});

test("the English copy uses the amended Free/Pro wording", () => {
  const all = JSON.stringify(en);
  assert.match(en.features.parallelRuns.limit, /one contribution at a time/);
  assert.match(en.features.deepReasoning.limit, /"Default" uses the model's own default effort on every plan/);
  assert.doesNotMatch(all, /one analysis per project/i);
  assert.doesNotMatch(all, /\p{Script_Extensions=Han}/u);
  assert.match(zh.features.parallelRuns.limit, /一次進行一項貢獻/);
});
