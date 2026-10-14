import assert from "node:assert/strict";
import test from "node:test";
import { ProjectInsightsCache } from "./useProjectInsights";

test("a refresh after the clone is updated reads again instead of joining an analysis in flight", async () => {
  const calls: string[] = [];
  let finishAnalysis = () => {};
  const cache = new ProjectInsightsCache(async (_repoId, operation) => {
    calls.push(operation);
    if (operation === "analyze")
      await new Promise<void>((resolve) => (finishAnalysis = resolve));
    return { insights: null, stale: operation === "load" };
  });
  const analysis = cache.analyze("repo");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const refresh = cache.refresh("repo");
  finishAnalysis();
  await Promise.all([analysis, refresh]);
  assert.deepEqual(calls, ["analyze", "load"]);
  assert.equal(cache.snapshot("repo").stale, true);
});
