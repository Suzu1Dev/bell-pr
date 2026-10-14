import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import type { ApiErrorBody } from "../shared/errors";
import { product } from "../shared/product";
import {
  ApiError,
  ProRequiredError,
  api,
  apiUrl,
  proRequiredEvent,
  send,
} from "./api";
import { setLocale } from "./i18n";

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];
let respond: (call: Call) => Response | Promise<Response>;
let events: Event[] = [];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

beforeEach(() => {
  calls = [];
  events = [];
  respond = () => json(200, {});
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    if (init?.signal?.aborted) throw init.signal.reason;
    return respond(call);
  }) as typeof fetch;
  const target = new EventTarget();
  target.addEventListener(proRequiredEvent, (event) => events.push(event));
  Object.defineProperty(globalThis, "window", {
    value: target,
    configurable: true,
    writable: true,
  });
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete (globalThis as { window?: unknown }).window;
  await setLocale("en");
});

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected the request to fail");
}

test("every request carries the UI locale in X-Bell-Locale", async () => {
  await api("/status");
  await api("/runs", send("POST", { title: "Fix" }));
  await api("/runs/1", { headers: { "X-Custom": "1" } });
  await api("/runs/2", { headers: new Headers({ Accept: "text/markdown" }) });
  await setLocale("zh-TW");
  await api("/repos", send("DELETE"));

  assert.deepEqual(
    calls.map((call) => [call.method, call.url, call.headers.get("X-Bell-Locale")]),
    [
      ["GET", "/api/status", "en"],
      ["POST", "/api/runs", "en"],
      ["GET", "/api/runs/1", "en"],
      ["GET", "/api/runs/2", "en"],
      ["DELETE", "/api/repos", "zh-TW"],
    ],
  );
  for (const call of calls)
    assert.equal(call.headers.get("Content-Type"), "application/json");
  assert.equal(calls[1].body, '{"title":"Fix"}');
  assert.equal(calls[2].headers.get("X-Custom"), "1");
  assert.equal(calls[3].headers.get("Accept"), "text/markdown");
});

test("a request may name its own locale", async () => {
  await api("/runs/1/export.md", { headers: { "X-Bell-Locale": "zh-TW" } });
  assert.equal(calls[0].headers.get("X-Bell-Locale"), "zh-TW");
});

test("successful answers resolve with JSON, plain text or nothing", async () => {
  respond = () => json(200, { repos: [{ id: "r1" }] });
  assert.deepEqual(await api<{ repos: { id: string }[] }>("/repos"), {
    repos: [{ id: "r1" }],
  });
  respond = () =>
    new Response("# Notes\n", {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  assert.equal(await api<string>("/runs/1/export.md"), "# Notes\n");
  respond = () => new Response(null, { status: 204 });
  assert.equal(await api("/runs/1"), undefined);
});

test("an error body becomes an ApiError with its status, code, params and fixes", async () => {
  const fixes = [
    { label: "Install Git", command: "sudo apt install git", platform: "linux" },
  ];
  respond = () =>
    json(424, {
      error: "Git is not installed.",
      code: "git_missing",
      params: { tool: "git", min: 2, bad: { nested: true } },
      fixes: [...fixes, { label: "no command" }],
      stderr: "git: not found",
    });
  const error = await rejection(api("/repos", send("POST", { url: "x" })));
  assert.ok(error instanceof ApiError);
  assert.ok(error instanceof Error);
  assert.ok(!(error instanceof ProRequiredError));
  assert.equal(error.name, "ApiError");
  assert.equal(error.message, "Git is not installed.");
  assert.equal(error.status, 424);
  assert.equal(error.code, "git_missing");
  assert.deepEqual(error.params, { tool: "git", min: 2 });
  assert.deepEqual(error.fixes, fixes);
  assert.deepEqual(error.details, { stderr: "git: not found" });
  assert.equal(events.length, 0);
});

test("an error without a code or message gets the generic message", async () => {
  respond = () => json(500, { error: "" });
  const empty = await rejection(api("/status"));
  assert.ok(empty instanceof ApiError);
  assert.equal(empty.message, "Something went wrong. Please try again.");
  assert.equal(empty.status, 500);
  assert.equal(empty.code, undefined);

  respond = () => json(400, { error: "Bad input.", code: "not_a_code" });
  const unknown = await rejection(api("/status"));
  assert.ok(unknown instanceof ApiError);
  assert.equal(unknown.message, "Bad input.");
  assert.equal(unknown.code, undefined);

  await setLocale("zh-TW");
  respond = () => json(500, {});
  const zh = await rejection(api("/status"));
  assert.equal((zh as Error).message, "操作未完成，請再試一次。");
});

test("402 pro_required throws ProRequiredError and sends bellpr:pro-required", async () => {
  const body: ApiErrorBody = {
    error: "Discovery needs BELL PR Pro.",
    code: "pro_required",
    feature: "discovery",
    plan: "free",
    reason: "no_license",
  };
  respond = () => json(402, body);
  const error = await rejection(api("/discovery", send("POST")));
  assert.ok(error instanceof ProRequiredError);
  assert.ok(error instanceof ApiError);
  assert.equal(error.name, "ProRequiredError");
  assert.equal(error.message, "Discovery needs BELL PR Pro.");
  assert.equal(error.status, 402);
  assert.equal(error.code, "pro_required");
  assert.equal(error.feature, "discovery");
  assert.deepEqual(error.body, body);
  assert.deepEqual(error.details, {
    feature: "discovery",
    plan: "free",
    reason: "no_license",
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "bellpr:pro-required");
  assert.deepEqual((events[0] as CustomEvent<ApiErrorBody>).detail, body);
});

test("only a 402 with code pro_required counts as a Pro gate", async () => {
  respond = () => json(402, { error: "Payment required." });
  const plain = await rejection(api("/discovery", send("POST")));
  assert.ok(plain instanceof ApiError);
  assert.ok(!(plain instanceof ProRequiredError));
  respond = () => json(403, { error: "Forbidden.", code: "pro_required" });
  const forbidden = await rejection(api("/discovery", send("POST")));
  assert.ok(!(forbidden instanceof ProRequiredError));
  assert.equal(events.length, 0);
});

const unreachable = `Cannot reach the local ${product.name} service. Is it still running?`;

test("a failed fetch gives server_unreachable with the English message", async () => {
  const cause = new TypeError("fetch failed");
  respond = () => {
    throw cause;
  };
  const error = await rejection(api("/status"));
  assert.ok(error instanceof ApiError);
  assert.equal(
    error.message,
    "Cannot reach the local BELL PR service. Is it still running?",
  );
  assert.equal(error.message, unreachable);
  assert.equal(error.code, "server_unreachable");
  assert.equal(error.status, 0);
  assert.equal(error.cause, cause);
  assert.doesNotMatch(error.message, /npm run dev/);

  await setLocale("zh-TW");
  const zh = await rejection(api("/status"));
  assert.equal(
    (zh as Error).message,
    `無法連線至本機 ${product.name} 服務，請確認它仍在執行。`,
  );
});

test("a body that is not the API's JSON gives server_unreachable", async () => {
  respond = () =>
    new Response("<html><body>Bad gateway</body></html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });
  const proxy = await rejection(api("/status"));
  assert.ok(proxy instanceof ApiError);
  assert.equal(proxy.message, unreachable);
  assert.equal(proxy.code, "server_unreachable");
  assert.equal(proxy.status, 502);

  respond = () => new Response("", { status: 504 });
  const empty = await rejection(api("/status"));
  assert.equal((empty as ApiError).code, "server_unreachable");

  // An HTML page with status 200 is not the API either.
  respond = () =>
    new Response("<!doctype html><title>BELL PR</title>", {
      headers: { "Content-Type": "text/html" },
    });
  const page = await rejection(api("/status"));
  assert.equal((page as ApiError).code, "server_unreachable");
  assert.equal((page as ApiError).status, 200);
});

test("aborting a request rejects with the abort error, not an ApiError", async () => {
  const controller = new AbortController();
  controller.abort();
  const error = await rejection(api("/models", { signal: controller.signal }));
  assert.ok(!(error instanceof ApiError));
  assert.equal((error as Error).name, "AbortError");
});

test("apiUrl adds the UI locale for plain links", async () => {
  assert.equal(apiUrl("/runs/r1/export.md"), "/api/runs/r1/export.md?locale=en");
  assert.equal(
    apiUrl("/runs/r1/export.md", { locale: "zh-TW" }),
    "/api/runs/r1/export.md?locale=zh-TW",
  );
  assert.equal(
    apiUrl("/models", { provider: "claude", fresh: true, skip: undefined }),
    "/api/models?provider=claude&fresh=true&locale=en",
  );
  assert.equal(
    apiUrl("/runs?repo=r1", { page: 2 }),
    "/api/runs?repo=r1&page=2&locale=en",
  );
  await setLocale("zh-TW");
  assert.equal(apiUrl("/runs/r1/export.md"), "/api/runs/r1/export.md?locale=zh-TW");
});

test("send builds a JSON request body", () => {
  assert.deepEqual(send("POST", { a: 1 }), { method: "POST", body: '{"a":1}' });
  assert.deepEqual(send("DELETE"), { method: "DELETE", body: "{}" });
});
