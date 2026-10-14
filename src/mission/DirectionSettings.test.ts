import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import type { ModelCatalog } from "../../shared/models";
import { ApiError } from "../api";
import { setLocale } from "../i18n";
import { loadModelCatalog } from "./DirectionSettings";

const realFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = realFetch;
  await setLocale("en");
});

function stubFetch(respond: (signal?: AbortSignal | null) => Response) {
  const calls: { url: string; headers: Headers; signal?: AbortSignal | null }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      signal: init?.signal,
    });
    if (init?.signal?.aborted) throw init.signal.reason;
    return respond(init?.signal);
  }) as typeof fetch;
  return calls;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("the model catalog is read through api() with the UI locale and the caller's signal", async () => {
  const catalog: ModelCatalog = { source: "claude", models: [] };
  const calls = stubFetch(() => json(200, catalog));
  await setLocale("zh-TW");
  const controller = new AbortController();
  assert.deepEqual(await loadModelCatalog("claude", controller.signal), catalog);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/models?provider=claude");
  assert.equal(calls[0].headers.get("X-Bell-Locale"), "zh-TW");
  assert.equal(calls[0].signal, controller.signal);
});

test("a failed catalog request gives the server's structured error, and an abort stays an abort", async () => {
  stubFetch(() => json(400, { error: "Unsupported agent.", code: "codex_missing" }));
  const failure = await loadModelCatalog("codex").then(
    () => assert.fail("expected the request to fail"),
    (error: unknown) => error,
  );
  assert.ok(failure instanceof ApiError);
  assert.equal(failure.message, "Unsupported agent.");
  assert.equal(failure.status, 400);
  assert.equal(failure.code, "codex_missing");

  stubFetch(() => json(200, {}));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadModelCatalog("codex", controller.signal), (error: unknown) => {
    assert.ok(!(error instanceof ApiError));
    assert.equal((error as Error).name, "AbortError");
    return true;
  });
});
