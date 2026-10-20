import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  addEfficiency,
  applyPonytail,
  efficiencyMetricsSchema,
  emptyEfficiency,
  trackEfficiency,
} from "./efficiency.js";

test("usage accumulates per role, and unreported calls count calls but not tokens", () => {
  const usage = {
    type: "result",
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 4,
      output_tokens: 3,
    },
  };
  const lead = trackEfficiency("lite");
  lead.observe(usage);
  let total = addEfficiency(undefined, lead.finish(true), "lead");
  const member = trackEfficiency("lite");
  member.observe(usage);
  total = addEfficiency(total, member.finish(true), "member-1");
  // A call without usage still counts as a call, never as a measured zero.
  total = addEfficiency(total, trackEfficiency("lite").finish(false), "member-1");
  // A call without a role leaves byRole untouched.
  total = addEfficiency(total, trackEfficiency("lite").finish(true));
  // Claude Code input = uncached + cache write + cache read = 14 per measured call.
  assert.equal(total.calls, 4);
  assert.equal(total.inputTokens, 28);
  assert.deepEqual(Object.keys(total.byRole ?? {}), ["lead", "member-1"]);
  assert.equal(total.byRole?.lead.inputTokens, 14);
  assert.equal(total.byRole?.lead.cachedInputTokens, 4);
  assert.equal(total.byRole?.lead.outputTokens, 3);
  assert.equal(total.byRole?.["member-1"].calls, 2);
  assert.equal(total.byRole?.["member-1"].measuredCalls, 1);
  assert.equal(total.byRole?.["member-1"].inputTokens, 14);
  assert.ok((total.byRole?.["member-1"].durationMs ?? -1) >= 0);
  assert.equal(
    addEfficiency(undefined, trackEfficiency("off").finish(true)).byRole,
    undefined,
  );
  // Records saved before byRole existed still parse, and parsed byRole keeps its shape.
  const legacy = emptyEfficiency("lite");
  assert.deepEqual(efficiencyMetricsSchema.parse(legacy), legacy);
  assert.deepEqual(efficiencyMetricsSchema.parse(total), total);
  assert.ok(
    !efficiencyMetricsSchema.safeParse({
      ...legacy,
      byRole: { lead: { calls: 1 } },
    }).success,
  );
});

test("Ponytail modes preserve role boundaries and the exact pinned full rules", async () => {
  const prompt = "Return ONLY valid JSON. Keep the assigned file scopes.";
  assert.equal(applyPonytail(prompt, "off", "member-1", false), prompt);
  const lite = applyPonytail(prompt, "lite", "member-1", false);
  assert.ok(lite.startsWith(prompt));
  assert.match(lite, /mode=lite/);
  assert.match(lite, /owned file scopes/);
  const full = applyPonytail(prompt, "full", "lead", true);
  assert.ok(
    full.includes(
      await readFile(
        new URL("../vendor/ponytail/rules.md", import.meta.url),
        "utf8",
      ),
    ),
  );
  assert.match(full, /read-only/);
  assert.match(full, /exact requested JSON/);
  assert.match(
    applyPonytail(prompt, "full", "guide", true),
    /complete teaching explanation/,
  );
  assert.match(
    applyPonytail(prompt, "lite", "insights", true),
    /Do not call tools/,
  );
});

test("usage is provider-reported, deduplicated, and cached input remains a subset", () => {
  const call = trackEfficiency("lite");
  const event = {
    type: "turn.completed",
    usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20 },
  };
  call.observe(event);
  call.observe(event);
  const metrics = call.finish(true);
  assert.equal(metrics.calls, 1);
  assert.equal(metrics.completedCalls, 1);
  assert.equal(metrics.measuredCalls, 1);
  assert.equal(metrics.inputTokens, 100);
  assert.equal(metrics.cachedInputTokens, 80);
  assert.equal(metrics.outputTokens, 20);
  assert.ok(metrics.durationMs >= 0);
  const failed = trackEfficiency("lite");
  failed.observe(event);
  const total = addEfficiency(metrics, failed.finish(false));
  assert.equal(total.calls, 2);
  assert.equal(total.failedCalls, 1);
  assert.equal(total.measuredCalls, 2);
  assert.equal(total.inputTokens, 200);
});

test("missing and invalid usage never becomes a measured zero-token call", () => {
  for (const usage of [
    undefined,
    {},
    { input_tokens: 0, output_tokens: 0 },
    { input_tokens: -1, cached_input_tokens: 0, output_tokens: 1 },
    { input_tokens: 1, cached_input_tokens: 2, output_tokens: 1 },
    { input_tokens: "1", cached_input_tokens: 0, output_tokens: 1 },
    { input_tokens: NaN, cached_input_tokens: 0, output_tokens: 1 },
    { input_tokens: 1, cached_input_tokens: 0, output_tokens: Infinity },
  ]) {
    const call = trackEfficiency("off");
    call.observe({ type: "turn.completed", usage });
    assert.equal(call.finish(false).measuredCalls, 0);
  }
  const call = trackEfficiency("off");
  call.observe(null);
  call.observe("non JSON output");
  call.observe({
    type: "item.completed",
    usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 1 },
  });
  assert.equal(call.finish(true).measuredCalls, 0);
});

test("Claude Code usage counts cache writes and reads as input, with reads as cached input", () => {
  const call = trackEfficiency("lite");
  call.observe({
    type: "result",
    usage: {
      input_tokens: 9,
      cache_creation_input_tokens: 7408,
      cache_read_input_tokens: 100,
      output_tokens: 145,
    },
  });
  const metrics = call.finish(true);
  assert.equal(metrics.measuredCalls, 1);
  assert.equal(metrics.inputTokens, 7517);
  assert.equal(metrics.cachedInputTokens, 100);
  assert.equal(metrics.outputTokens, 145);
  for (const usage of [
    { input_tokens: 9, output_tokens: 1 },
    { input_tokens: 9, cache_creation_input_tokens: 0, output_tokens: 1 },
    {
      input_tokens: 9,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: -1,
      output_tokens: 1,
    },
  ]) {
    const missing = trackEfficiency("lite");
    missing.observe({ type: "result", usage });
    assert.equal(missing.finish(true).measuredCalls, 0);
  }
});
