import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import test from "node:test";
import { z } from "zod";
import type { ModelCatalog } from "../shared/models.js";
import { AppError } from "./types.js";
import {
  modelArguments,
  modelSettingsSchema,
  parseModelPage,
  readModelCatalog,
  resolveModelExecution,
} from "./models.js";

const wireModel = {
  id: "picker-id",
  model: "codex-example",
  displayName: "Example",
  description: "Example model",
  isDefault: true,
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: [
    { reasoningEffort: "low" },
    { reasoningEffort: "medium" },
  ],
};
const catalog: ModelCatalog = {
  source: "codex",
  models: parseModelPage({ data: [wireModel] }).models,
};

test("model catalog uses invocation IDs, filters hidden/unknown efforts, and rejects malformed metadata", () => {
  const result = parseModelPage({
    data: [
      {
        ...wireModel,
        supportedReasoningEfforts: [
          ...wireModel.supportedReasoningEfforts,
          { reasoningEffort: "future" },
          { reasoningEffort: "low" },
        ],
      },
      { ...wireModel, model: "hidden-example", hidden: true },
    ],
    nextCursor: "next",
  });
  assert.deepEqual(result, {
    models: [
      {
        id: "codex-example",
        name: "Example",
        description: "Example model",
        isDefault: true,
        reasoningEfforts: ["low", "medium"],
        defaultReasoningEffort: "medium",
      },
    ],
    nextCursor: "next",
  });
  assert.throws(() =>
    parseModelPage({ data: [{ ...wireModel, model: "--unsafe-option" }] }),
  );
  assert.throws(() =>
    parseModelPage({ data: [{ ...wireModel, isDefault: "true" }] }),
  );
  assert.equal(
    parseModelPage({
      data: [{ ...wireModel, defaultReasoningEffort: "future" }],
    }).models[0].defaultReasoningEffort,
    undefined,
  );
});

test("settings resolve defaults once and never silently substitute an explicit model or effort", () => {
  assert.deepEqual(z.object(modelSettingsSchema).parse({}), {
    model: "",
    reasoningEffort: "",
  });
  assert.deepEqual(resolveModelExecution({}, catalog), {
    model: "codex-example",
    reasoningEffort: "medium",
    source: "catalog-default",
  });
  assert.deepEqual(
    resolveModelExecution(
      { model: "codex-example", reasoningEffort: "low" },
      catalog,
    ),
    { model: "codex-example", reasoningEffort: "low", source: "selected" },
  );
  assert.deepEqual(resolveModelExecution({ reasoningEffort: "low" }, catalog), {
    model: "codex-example",
    reasoningEffort: "low",
    source: "selected",
  });
  const unavailable: ModelCatalog = {
    source: "codex",
    models: [],
    error: "Unavailable",
  };
  assert.deepEqual(resolveModelExecution({}, unavailable), {
    source: "cli-default",
  });
  for (const settings of [
    { model: "missing" },
    { model: "codex-example", reasoningEffort: "high" as const },
  ]) {
    assert.throws(
      () => resolveModelExecution(settings, catalog),
      (error) => error instanceof AppError && error.statusCode === 400,
    );
  }
  assert.throws(
    () => resolveModelExecution({ model: "codex-example" }, unavailable),
    AppError,
  );
  assert.throws(
    () => resolveModelExecution({ reasoningEffort: "low" }, unavailable),
    AppError,
  );
});

test("model flags are direct argument values, omit defaults, and validate persisted values", () => {
  assert.deepEqual(
    modelArguments({
      model: "codex-example",
      reasoningEffort: "medium",
      source: "selected",
    }),
    ["--model", "codex-example", "-c", 'model_reasoning_effort="medium"'],
  );
  assert.deepEqual(modelArguments({ source: "cli-default" }), []);
  assert.throws(() =>
    modelArguments({ model: "model\n--config", source: "selected" }),
  );
});

const server = (handler: string) => (cwd: string) =>
  spawn(
    process.execPath,
    [
      "-e",
      `
  const readline = require('node:readline');
  const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
  let initialized = false;
  readline.createInterface({input: process.stdin}).on('line', (line) => {
    const request = JSON.parse(line);
    ${handler}
  });
`,
    ],
    { cwd, stdio: ["pipe", "pipe", "pipe"] },
  );

test("catalog handshake and pagination only request metadata and clean up their process and directory", async () => {
  let cwd = "";
  let child: ReturnType<ReturnType<typeof server>> | undefined;
  const start = server(`
    if (request.method === 'initialize') send({id: request.id, result: {userAgent: 'fixture'}});
    else if (request.method === 'initialized') initialized = true;
    else if (request.method === 'model/list' && initialized && request.params.includeHidden === false) {
      if (!request.params.cursor) send({id: request.id, result: {data: [${JSON.stringify(wireModel)}], nextCursor: 'page-2'}});
      else if (request.params.cursor === 'page-2') send({id: request.id, result: {data: [{...${JSON.stringify(wireModel)}, model: 'second-example', isDefault: false}], nextCursor: null}});
      else process.exit(2);
    } else process.exit(3);
  `);
  const value = await readModelCatalog((dir) => {
    cwd = dir;
    child = start(dir);
    return child;
  });
  assert.deepEqual(
    value.models.map((model) => model.id),
    ["codex-example", "second-example"],
  );
  assert.equal(value.error, undefined);
  assert.ok(child?.exitCode !== null || child?.signalCode !== null);
  await assert.rejects(access(cwd));
});

test("catalog timeout and provider errors return safe messages without raw details", async () => {
  for (const handler of [
    "if (request.method === 'initialize') send({id: request.id, error: {message: 'private token and path'}});",
    "if (request.method === 'initialize') process.stdout.write('not-json\\n');",
    "// Wait until the caller times out.",
  ]) {
    const value = await readModelCatalog(server(handler), 100);
    assert.equal(value.models.length, 0);
    assert.match(value.error || "", /暫時無法讀取/);
    assert.doesNotMatch(value.error || "", /private|token|path|not-json/);
  }
  const failed = await readModelCatalog(() => {
    throw new Error("private spawn failure");
  });
  assert.equal(failed.models.length, 0);
  assert.doesNotMatch(failed.error || "", /private/);
});

test("repeating pagination cursor fails without returning a partial catalog", async () => {
  const value = await readModelCatalog(
    server(`
    if (request.method === 'initialize') send({id: request.id, result: {}});
    else if (request.method === 'model/list') send({id: request.id, result: {data: [], nextCursor: 'same-page'}});
  `),
  );
  assert.equal(value.models.length, 0);
  assert.ok(value.error);
});
