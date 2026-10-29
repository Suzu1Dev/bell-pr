import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import { mount } from "../mission/test-dom";
import { HistoricalDiff } from "./HistoricalDiff";

const response = (path: string, blocked?: string) => new Response(JSON.stringify({
  baseSha: "a".repeat(40), headSha: "b".repeat(40),
  files: [{ path, language: "TypeScript", status: "added", additions: 1, deletions: 0,
    patch: `@@ -0,0 +1 @@\n+${path} contents`, blocked }],
}), { headers: { "Content-Type": "application/json" } });

test("historical diff ignores late replies for another round or run and exposes no review or AI controls", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const requests: string[] = [];
  const pending: ((response: Response) => void)[] = [];
  globalThis.fetch = ((url, init) => {
    assert.equal(init?.method ?? "GET", "GET");
    requests.push(String(url));
    return new Promise<Response>((resolve) => pending.push(resolve));
  }) as typeof fetch;
  const view = await mount(createElement(HistoricalDiff, { runId: "run/a", round: "initial" }));
  try {
    await view.rerender(createElement(HistoricalDiff, { runId: "run/a", round: "all" }));
    await act(async () => { pending[1](response("all.ts")); });
    assert.match(view.text(), /all\.ts contents/);
    await act(async () => { pending[0](response("old.ts")); });
    assert.doesNotMatch(view.text(), /old\.ts/);
    await view.rerender(createElement(HistoricalDiff, { runId: "other", round: "initial" }));
    assert.doesNotMatch(view.text(), /all\.ts/);
    await act(async () => { pending[2](response("blocked.ts", "Patch withheld.")); });
    assert.match(view.text(), /Patch withheld/);
    assert.doesNotMatch(view.text(), /blocked\.ts contents/);
    assert.equal(view.container.querySelectorAll((node) => ["INPUT", "TEXTAREA", "FORM"].includes(node.nodeName)).length, 0);
    assert.doesNotMatch(view.text(), /Reviewed|Ask the agent|Explain it back/);
    assert.deepEqual(requests, [
      "/api/runs/run%2Fa/diff-view?round=initial", "/api/runs/run%2Fa/diff-view?round=all", "/api/runs/other/diff-view?round=initial",
    ]);
  } finally { await view.unmount(); }
});
