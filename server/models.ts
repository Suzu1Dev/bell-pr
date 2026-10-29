import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  agentAccessModes,
  agentProviders,
  reasoningEfforts,
  type AgentProvider,
  type ModelCatalog,
  type ModelExecution,
  type ModelOption,
  type ModelSettings,
  type ReasoningEffort,
} from "../shared/models.js";
import { product } from "../shared/product.js";
import { version } from "./build-info.js";
import { sm } from "./i18n/index.js";
import { agentChildEnvironment, observeChild } from "./process.js";
import { AppError } from "./types.js";

export const modelId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/);
const effort = z.enum(reasoningEfforts);
const provider = z.enum(agentProviders);
export const modelSettingsSchema = {
  provider: provider.optional(),
  model: modelId.or(z.literal("")).default(""),
  reasoningEffort: effort.or(z.literal("")).default(""),
  webAccess: z.boolean().optional(),
  agentAccess: z.enum(agentAccessModes).optional(),
};
export const modelExecutionSchema = z.object({
  provider: provider.optional(),
  model: modelId.optional(),
  reasoningEffort: effort.optional(),
  webAccess: z.boolean().optional(),
  agentAccess: z.enum(agentAccessModes).optional(),
  source: z.enum(["selected", "catalog-default", "cli-default"]),
  // Persisted insights and discovery records are parsed with this schema; unknown keys are stripped.
  reported: z
    .object({
      model: modelId,
      modelsUsed: z.array(modelId).max(20).optional(),
      cliVersion: z.string().min(1).max(100).optional(),
    })
    .optional(),
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

/** The only error a Codex catalog read reports, in the locale in effect. */
function catalogError() {
  return sm().analysis.models.catalogUnavailable;
}

/** Read model metadata only: this connection never creates a thread or inference turn. */
export async function readModelCatalog(
  start: (cwd: string) => ChildProcessWithoutNullStreams = (cwd) =>
    spawn(
      "codex",
      ["app-server", "--listen", "stdio://", "-c", 'model_provider="openai"'],
      {
        cwd,
        env: agentChildEnvironment("codex"),
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ),
  timeoutMs = 10_000,
): Promise<ModelCatalog> {
  // Read once here: the process callbacks below run outside the caller's turn.
  const error = catalogError();
  let cwd: string | undefined;
  try {
    cwd = await mkdtemp(path.join(tmpdir(), "bell-models-"));
    return await new Promise<ModelCatalog>((resolve) => {
      const child = start(cwd!);
      // Recorded like every agent CLI, so a crash cannot leave it running.
      observeChild(child, "codex");
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
        finish({ source: "codex", models: [], error });
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
                ...(models.length ? {} : { error }),
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
        resolve(result ?? { source: "codex", models: [], error });
      });
      send({
        method: "initialize",
        id: 0,
        params: {
          clientInfo: { name: "bell_pr", title: product.name, version },
        },
      });
    });
  } catch {
    return { source: "codex", models: [], error };
  } finally {
    if (cwd) await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

const claudeEfforts: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
/**
 * Claude Code has no model-list command, so BELL offers its documented aliases.
 * Each alias follows the latest model of that family; availability depends on the plan.
 * The descriptions are in the locale in effect.
 */
export function claudeModelCatalog(): ModelCatalog {
  const m = sm().analysis.models;
  return {
    source: "claude",
    models: [
      {
        id: "opus",
        name: "Claude Opus",
        description: m.claudeOpus,
        isDefault: false,
        reasoningEfforts: claudeEfforts,
      },
      {
        id: "sonnet",
        name: "Claude Sonnet",
        description: m.claudeSonnet,
        isDefault: false,
        reasoningEfforts: claudeEfforts,
      },
      {
        id: "fable",
        name: "Claude Fable",
        description: m.claudeFable,
        isDefault: false,
        reasoningEfforts: claudeEfforts,
      },
      {
        id: "haiku",
        name: "Claude Haiku",
        description: m.claudeHaiku,
        isDefault: false,
        reasoningEfforts: [],
      },
    ],
  };
}

/** A cached catalog with its error in the locale of this read, not of the read that filled the cache. */
function localized(catalog: ModelCatalog): ModelCatalog {
  return catalog.error ? { ...catalog, error: catalogError() } : catalog;
}

let cached: { value: ModelCatalog; expires: number } | undefined;
let pending: Promise<ModelCatalog> | undefined;
export function getModelCatalog(
  provider: AgentProvider = "codex",
): Promise<ModelCatalog> {
  if (provider === "claude") return Promise.resolve(claudeModelCatalog());
  if (cached && cached.expires > Date.now())
    return Promise.resolve(localized(cached.value));
  if (pending) return pending.then(localized);
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
    throw new AppError((m) => m.analysis.models.invalidSettings, 400);
  const selected = parsed.data;
  if ((selected.provider ?? "codex") !== catalog.source)
    throw new AppError((m) => m.analysis.models.providerMismatch, 400);
  const recordedProvider = {
    ...(catalog.source === "codex" ? {} : { provider: catalog.source }),
    // Off is the default, so only an enabled flag is recorded on the run.
    ...(selected.webAccess ? { webAccess: true } : {}),
    ...(selected.agentAccess === "full" ? { agentAccess: selected.agentAccess } : {}),
  };
  const model = selected.model
    ? catalog.models.find((item) => item.id === selected.model)
    : catalog.models.find((item) => item.isDefault);
  if (!model) {
    if (selected.model || selected.reasoningEffort) {
      throw new AppError((m) => m.analysis.models.unknownModel, 400);
    }
    return { ...recordedProvider, source: "cli-default" };
  }
  const reasoningEffort =
    selected.reasoningEffort || model.defaultReasoningEffort;
  if (reasoningEffort && !model.reasoningEfforts.includes(reasoningEffort)) {
    throw new AppError((m) => m.analysis.models.unsupportedEffort, 400);
  }
  return {
    ...recordedProvider,
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
