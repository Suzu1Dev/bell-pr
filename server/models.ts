import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  reasoningEfforts,
  type ModelCatalog,
  type ModelExecution,
  type ModelOption,
  type ModelSettings,
} from "../shared/models.js";
import { agentEnvironment } from "./process.js";
import { AppError } from "./types.js";

const modelId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/);
const effort = z.enum(reasoningEfforts);
export const modelSettingsSchema = {
  model: modelId.or(z.literal("")).default(""),
  reasoningEffort: effort.or(z.literal("")).default(""),
};
export const modelExecutionSchema = z.object({
  model: modelId.optional(),
  reasoningEffort: effort.optional(),
  source: z.enum(["selected", "catalog-default", "cli-default"]),
});

const pageSchema = z.object({
  data: z
    .array(
      z.object({
        model: modelId,
        displayName: z.string().max(300),
        description: z.string().max(4000).optional(),
        hidden: z.boolean().optional(),
        isDefault: z.boolean(),
        defaultReasoningEffort: z.string().nullable().optional(),
        supportedReasoningEfforts: z
          .array(z.object({ reasoningEffort: z.string() }))
          .max(30),
      }),
    )
    .max(200),
  nextCursor: z.string().max(2000).nullable().optional(),
});

export function parseModelPage(value: unknown) {
  const page = pageSchema.parse(value);
  const models: ModelOption[] = page.data
    .filter((item) => !item.hidden)
    .map((item) => {
      const supported = [
        ...new Set(
          item.supportedReasoningEfforts.flatMap((option) => {
            const parsed = effort.safeParse(option.reasoningEffort);
            return parsed.success ? [parsed.data] : [];
          }),
        ),
      ];
      const defaultEffort = effort.safeParse(item.defaultReasoningEffort);
      return {
        id: item.model,
        name: item.displayName || item.model,
        description: item.description || "",
        isDefault: item.isDefault,
        reasoningEfforts: supported,
        ...(defaultEffort.success && supported.includes(defaultEffort.data)
          ? { defaultReasoningEffort: defaultEffort.data }
          : {}),
      };
    });
  return { models, nextCursor: page.nextCursor || undefined };
}

const catalogError =
  "暫時無法讀取 Codex 模型目錄。請確認 CLI 已安裝並登入，稍後再試。";

/** Read model metadata only: this connection never creates a thread or inference turn. */
export async function readModelCatalog(
  start: (cwd: string) => ChildProcessWithoutNullStreams = (cwd) =>
    spawn(
      "codex",
      ["app-server", "--listen", "stdio://", "-c", 'model_provider="openai"'],
      {
        cwd,
        env: agentEnvironment(),
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ),
  timeoutMs = 10_000,
): Promise<ModelCatalog> {
  let cwd: string | undefined;
  try {
    cwd = await mkdtemp(path.join(tmpdir(), "bell-models-"));
    return await new Promise<ModelCatalog>((resolve) => {
      const child = start(cwd!);
      let buffer = "";
      let bytes = 0;
      let requestId = 0;
      let pages = 0;
      const models: ModelOption[] = [];
      const cursors = new Set<string>();
      let result: ModelCatalog | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (child.pid && process.platform !== "win32")
            process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          child.kill(signal);
        }
      };
      const finish = (value: ModelCatalog) => {
        if (result) return;
        result = value;
        clearTimeout(timer);
        child.stdin.end();
        kill("SIGTERM");
        killTimer = setTimeout(() => kill("SIGKILL"), 1000);
        killTimer.unref();
      };
      const fail = () =>
        finish({ source: "codex", models: [], error: catalogError });
      const timer = setTimeout(fail, timeoutMs);
      const send = (message: unknown) =>
        child.stdin.write(`${JSON.stringify(message)}\n`);
      const list = (cursor?: string) => {
        requestId += 1;
        send({
          method: "model/list",
          id: requestId,
          params: {
            limit: 100,
            includeHidden: false,
            ...(cursor ? { cursor } : {}),
          },
        });
      };
      child.stdin.on("error", fail);
      child.on("error", fail);
      child.stderr.on("data", (data: Buffer) => {
        bytes += data.byteLength;
        if (bytes > 1_000_000) fail();
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data: string) => {
        if (result) return;
        bytes += Buffer.byteLength(data);
        if (bytes > 1_000_000) {
          fail();
          return;
        }
        buffer += data;
        let end: number;
        while (!result && (end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line);
            if (!message || message.id !== requestId) continue;
            if (message.error || !message.result) {
              fail();
              return;
            }
            if (requestId === 0) {
              send({ method: "initialized", params: {} });
              list();
              continue;
            }
            const page = parseModelPage(message.result);
            pages += 1;
            models.push(...page.models);
            if (
              models.length > 200 ||
              new Set(models.map((item) => item.id)).size !== models.length ||
              models.filter((item) => item.isDefault).length > 1
            ) {
              fail();
              return;
            }
            if (page.nextCursor) {
              if (pages >= 10 || cursors.has(page.nextCursor)) {
                fail();
                return;
              }
              cursors.add(page.nextCursor);
              list(page.nextCursor);
            } else {
              finish({
                source: "codex",
                models,
                ...(models.length ? {} : { error: catalogError }),
              });
            }
          } catch {
            fail();
          }
        }
      });
      child.on("close", () => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        resolve(result ?? { source: "codex", models: [], error: catalogError });
      });
      send({
        method: "initialize",
        id: 0,
        params: {
          clientInfo: { name: "bell_pr", title: "BELL PR", version: "0.1.0" },
        },
      });
    });
  } catch {
    return { source: "codex", models: [], error: catalogError };
  } finally {
    if (cwd) await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

let cached: { value: ModelCatalog; expires: number } | undefined;
let pending: Promise<ModelCatalog> | undefined;
export function getModelCatalog(): Promise<ModelCatalog> {
  if (cached && cached.expires > Date.now())
    return Promise.resolve(cached.value);
  if (pending) return pending;
  pending = readModelCatalog()
    .then((value) => {
      cached = { value, expires: Date.now() + (value.error ? 10_000 : 60_000) };
      return value;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

export function resolveModelExecution(
  settings: ModelSettings,
  catalog: ModelCatalog,
): ModelExecution {
  const parsed = z.object(modelSettingsSchema).safeParse(settings);
  if (!parsed.success)
    throw new AppError("模型設定格式不正確，請重新選擇。", 400);
  const selected = parsed.data;
  const model = selected.model
    ? catalog.models.find((item) => item.id === selected.model)
    : catalog.models.find((item) => item.isDefault);
  if (!model) {
    if (selected.model || selected.reasoningEffort) {
      throw new AppError(
        "無法確認這組模型設定，請重新載入模型目錄並選擇。",
        400,
      );
    }
    return { source: "cli-default" };
  }
  const reasoningEffort =
    selected.reasoningEffort || model.defaultReasoningEffort;
  if (reasoningEffort && !model.reasoningEfforts.includes(reasoningEffort)) {
    throw new AppError("所選模型不支援這個思考強度，請重新選擇。", 400);
  }
  return {
    model: model.id,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    source:
      selected.model || selected.reasoningEffort
        ? "selected"
        : "catalog-default",
  };
}

export function modelArguments(execution: ModelExecution): string[] {
  const value = modelExecutionSchema.parse(execution);
  return [
    ...(value.model ? ["--model", value.model] : []),
    ...(value.reasoningEffort
      ? [
          "-c",
          `model_reasoning_effort=${JSON.stringify(value.reasoningEffort)}`,
        ]
      : []),
  ];
}
