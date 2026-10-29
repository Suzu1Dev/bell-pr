import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { product } from "../shared/product";
import { adoptApiToken, ApiError, api, apiUrl, send } from "./api";
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

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

beforeEach(() => {
  calls = [];
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
});

afterEach(async () => {
  globalThis.fetch = realFetch;
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
  for (const call of calls) {
    assert.equal(call.headers.get("Content-Type"), "application/json");
    assert.equal(call.headers.get("Authorization"), null);
  }
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
  assert.equal(error.name, "ApiError");
  assert.equal(error.message, "Git is not installed.");
  assert.equal(error.status, 424);
  assert.equal(error.code, "git_missing");
  assert.deepEqual(error.params, { tool: "git", min: 2 });
  assert.deepEqual(error.fixes, fixes);
  assert.deepEqual(error.details, { stderr: "git: not found" });
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

function tokenWindow(initial: string) {
  const stored = new Map<string, string>();
  const session = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
    clear: () => stored.clear(),
    key: () => null,
    get length() {
      return stored.size;
    },
  } satisfies Storage;
  let href = initial;
  const win = {
    location: {
      get hash() {
        return new URL(href).hash;
      },
      get search() {
        return new URL(href).search;
      },
      get pathname() {
        return new URL(href).pathname;
      },
    },
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, url?: string | URL | null) => {
        href = String(url);
      },
    },
    sessionStorage: session,
  };
  return {
    win,
    session,
    stored,
    href: () => href,
  };
}

test("?bell_token= is ignored and #bell_token= is stored then removed", async () => {
  const token = "ab".repeat(32);
  const query = tokenWindow(`http://127.0.0.1:4311/?bell_token=${token}`);
  adoptApiToken(query.win);
  assert.equal(query.stored.get("bellpr-api-token"), undefined);
  assert.equal(query.href(), `http://127.0.0.1:4311/?bell_token=${token}`);

  const hashed = tokenWindow(`http://127.0.0.1:4311/#/runs/abc?bell_token=${token}`);
  adoptApiToken(hashed.win);
  assert.equal(hashed.stored.get("bellpr-api-token"), undefined);
  assert.equal(hashed.href(), `http://127.0.0.1:4311/#/runs/abc?bell_token=${token}`);

  const fragment = tokenWindow(`http://127.0.0.1:4311/#bell_token=${token}`);
  adoptApiToken(fragment.win);
  assert.equal(fragment.stored.get("bellpr-api-token"), token);
  assert.equal(fragment.href(), "/");
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = fragment.session;
  try {
    await api("/status");
    assert.equal(calls.at(-1)?.headers.get("Authorization"), `Bearer ${token}`);
  } finally {
    globalThis.sessionStorage = previous;
    fragment.stored.clear();
  }
});

test("a 401 becomes the open instruction, not the bearer header text", async () => {
  respond = () =>
    json(401, {
      error:
        "This request needs the API token. Send it as Authorization: Bearer <token>, or as the X-Bell-Token header.",
    });
  const error = await rejection(api("/status"));
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 401);
  assert.equal(
    error.message,
    "Run `bell-pr` on the computer hosting BELL PR to reopen your workspace.",
  );
  assert.doesNotMatch(error.message, /Bearer|X-Bell-Token/);
});
