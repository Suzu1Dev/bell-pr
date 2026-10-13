import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { request, type OutgoingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Locale } from "../shared/i18n/locale.js";
import { createApp } from "./app.js";
import {
  cancelled,
  currentLocale,
  setDefaultLocaleSource,
  shuttingDown,
  sm,
  withLocale,
} from "./i18n/index.js";
import en from "./i18n/en/index.js";
import zhTW from "./i18n/zh-TW/index.js";
import { Store } from "./store.js";
import { AppError } from "./types.js";
import { Workbench } from "./workbench.js";

const han = /\p{Script_Extensions=Han}/u;

/**
 * Runs `fn` with BELLPR_LOCALE set to `value` (removed when undefined), then
 * restores the variable and clears any default-locale source.
 */
async function withEnvLocale(
  value: string | undefined,
  fn: () => void | Promise<void>,
) {
  const saved = process.env.BELLPR_LOCALE;
  if (value === undefined) delete process.env.BELLPR_LOCALE;
  else process.env.BELLPR_LOCALE = value;
  try {
    await fn();
  } finally {
    if (saved === undefined) delete process.env.BELLPR_LOCALE;
    else process.env.BELLPR_LOCALE = saved;
    setDefaultLocaleSource();
  }
}

/**
 * Serves createApp over a throwaway data directory. `prepare` stubs
 * Workbench methods so routes can report what they saw without spawning
 * any CLI. Requests carry the local Host header the guard expects.
 */
async function startApp(prepare: (workbench: Workbench) => void = () => {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-pr-i18n-"));
  const workbench = new Workbench(new Store(directory));
  prepare(workbench);
  const app = createApp(workbench, {
    staticDirectory: path.join(directory, "missing"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  type Reply = { status: number; body: Record<string, unknown> };
  const call = (
    pathname: string,
    options: {
      method?: string;
      headers?: OutgoingHttpHeaders;
      body?: unknown;
    } = {},
  ) =>
    new Promise<Reply>((resolve, reject) => {
      const payload =
        options.body === undefined ? "" : JSON.stringify(options.body);
      const req = request(
        `http://127.0.0.1:${port}${pathname}`,
        {
          method: options.method ?? "GET",
          headers: {
            host: "127.0.0.1:4311",
            ...(payload
              ? {
                  "content-type": "application/json",
                  "content-length": Buffer.byteLength(payload),
                }
              : {}),
            ...options.headers,
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode!, body: JSON.parse(text) }),
          );
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await workbench.shutdown();
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await rm(directory, { recursive: true, force: true });
  };
  return { call, close };
}

/** Makes GET /api/runs/:id throw `error`, through the real error handler. */
function failingRun(error: unknown) {
  return (workbench: Workbench) => {
    workbench.run = () => {
      throw error;
    };
  };
}

test("currentLocale falls back from the scope to the default source, BELLPR_LOCALE and en", async () => {
  await withEnvLocale(undefined, () => {
    assert.equal(currentLocale(), "en");
    assert.equal(withLocale("zh-TW", currentLocale), "zh-TW");
  });
  await withEnvLocale("zh_TW.UTF-8", () => {
    assert.equal(currentLocale(), "zh-TW");
  });
  await withEnvLocale("fr", () => {
    assert.equal(currentLocale(), "en");
  });
  await withEnvLocale("en", () => {
    setDefaultLocaleSource(() => "zh-TW");
    assert.equal(currentLocale(), "zh-TW");
    // The request's own locale still wins over the default source.
    assert.equal(withLocale("en", currentLocale), "en");
    setDefaultLocaleSource(() => undefined);
    assert.equal(currentLocale(), "en");
  });
  await withEnvLocale("zh-TW", () => {
    setDefaultLocaleSource(() => undefined);
    assert.equal(currentLocale(), "zh-TW");
    setDefaultLocaleSource(() => "en");
    assert.equal(currentLocale(), "en");
    setDefaultLocaleSource(() => {
      throw new Error("settings unreadable");
    });
    assert.equal(currentLocale(), "zh-TW");
    setDefaultLocaleSource();
    assert.equal(currentLocale(), "zh-TW");
  });
});

test("withLocale keeps each async flow on its own locale", async () => {
  const locales: Locale[] = ["en", "zh-TW", "en", "zh-TW"];
  const seen = await Promise.all(
    locales.map((locale, index) =>
      withLocale(locale, async () => {
        const before = currentLocale();
        // Interleave the flows so each resumes while the others are active.
        await delay(12 - index * 3);
        const nested = await withLocale(
          locale === "en" ? "zh-TW" : "en",
          async () => {
            await delay(1);
            return currentLocale();
          },
        );
        await new Promise((resolve) => setImmediate(resolve));
        return { before, nested, after: currentLocale() };
      }),
    ),
  );
  assert.deepEqual(
    seen,
    locales.map((locale) => ({
      before: locale,
      nested: locale === "en" ? "zh-TW" : "en",
      after: locale,
    })),
  );
  await withEnvLocale(undefined, () => {
    assert.equal(currentLocale(), "en");
  });
});

test("sm() and the shared helpers return the current locale's messages", () => {
  assert.equal(withLocale("en", sm), en);
  assert.equal(withLocale("zh-TW", sm), zhTW);
  assert.equal(withLocale("en", cancelled), en.common.cancelled);
  assert.equal(withLocale("en", shuttingDown), en.common.shuttingDown);
  assert.equal(withLocale("zh-TW", cancelled), "工作已取消。");
  assert.equal(withLocale("zh-TW", shuttingDown), "服務正在關閉，請稍後重試。");
  assert.equal(withLocale("zh-TW", () => sm().common.notFound), "找不到 API。");
  for (const message of Object.values(en.common)) {
    if (typeof message === "string") assert.doesNotMatch(message, han);
  }
});

test("every server namespace is registered for both locales", () => {
  const namespaces = [
    "analysis",
    "cli",
    "common",
    "license",
    "run",
    "security",
    "setup",
    "storage",
  ];
  assert.deepEqual(Object.keys(en).sort(), namespaces);
  assert.deepEqual(Object.keys(zhTW).sort(), namespaces);
});

test("AppError renders a message builder in the locale in effect", () => {
  const build = () => new AppError((m) => m.common.cancelled, 409);
  const english = withLocale("en", build);
  assert.equal(english.message, en.common.cancelled);
  assert.equal(english.statusCode, 409);
  assert.equal(withLocale("zh-TW", build).message, "工作已取消。");
  // The existing call form keeps compiling and keeps its defaults.
  const plain = new AppError("找不到工作。");
  assert.equal(plain.message, "找不到工作。");
  assert.equal(plain.statusCode, 400);
  assert.equal(plain.code, undefined);
  assert.ok(plain instanceof Error);
});

test("AppError keeps its cause for callers but never sends it", async () => {
  const cause = Object.assign(new Error("spawn git ENOENT"), {
    code: "ENOENT",
  });
  const error = new AppError("Git is not installed.", 503, {
    code: "git_missing",
    cause,
  });
  assert.equal(error.cause, cause);
  assert.equal((error.cause as NodeJS.ErrnoException).code, "ENOENT");
  assert.equal(Object.hasOwn(new AppError("No cause."), "cause"), false);
  const { call, close } = await startApp(failingRun(error));
  try {
    const response = await call("/api/runs/any");
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: "Git is not installed.",
      code: "git_missing",
    });
  } finally {
    await close();
  }
});

test("the error handler serializes an AppError's code, params, fixes and details", async () => {
  const fixes = [
    {
      label: "Install Git",
      command: "sudo apt install git",
      platform: "linux" as const,
    },
  ];
  const cases: [AppError, number, Record<string, unknown>][] = [
    [
      new AppError("Git is not installed.", 503, {
        code: "git_missing",
        params: { tool: "git", attempts: 2 },
        fixes,
        details: {
          stderr: "fatal: token ghp_0123456789abcdefghij rejected",
          exitCode: 128,
        },
      }),
      503,
      {
        error: "Git is not installed.",
        code: "git_missing",
        params: { tool: "git", attempts: 2 },
        fixes,
        stderr: "fatal: token [REDACTED] rejected",
        exitCode: 128,
      },
    ],
    // Details never replace the message or the code.
    [
      new AppError("Real message.", 409, {
        details: {
          error: "spoofed",
          code: "pro_required",
          feature: "discovery",
        },
      }),
      409,
      { error: "Real message.", feature: "discovery" },
    ],
    // Without structure the body is the message alone, as before.
    [new AppError("找不到工作。", 404), 404, { error: "找不到工作。" }],
    [
      new AppError(
        "push to https://user:hunter2-secret@example.com failed",
        422,
      ),
      422,
      { error: "push to https://[REDACTED]@example.com failed" },
    ],
  ];
  for (const [error, status, body] of cases) {
    const { call, close } = await startApp(failingRun(error));
    try {
      const response = await call("/api/runs/any");
      assert.equal(response.status, status, error.message);
      assert.deepEqual(response.body, body);
    } finally {
      await close();
    }
  }
});
