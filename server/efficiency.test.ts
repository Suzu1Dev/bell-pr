import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { addEfficiency, applyPonytail, trackEfficiency } from "./efficiency.js";

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
