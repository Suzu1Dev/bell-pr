import { z } from "zod";
import { AppError } from "./types.js";
import { safeRelativePath, sensitivePath } from "./git.js";
import type { AgentTeam, TeamTask } from "../shared/team.js";
import type { ModelExecution } from "../shared/models.js";

export interface TeamAgentInput {
  role: string;
  taskId?: string;
  prompt: string;
  cwd: string;
  readonly: boolean;
  signal: AbortSignal;
  modelExecution: ModelExecution;
}
export type TeamAgentRunner = (input: TeamAgentInput) => Promise<string>;

const taskSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4000),
  files: z.array(z.string().min(1).max(300)).min(1).max(30),
  dependsOn: z.array(z.string()).max(8).default([]),
});
const planSchema = z.object({
  summary: z.string().trim().min(1).max(6000),
  tasks: z.array(taskSchema).min(1).max(8),
});

function jsonText(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```$/, "");
}

export function scopeContains(scope: string, file: string) {
  return scope.endsWith("/") ? file.startsWith(scope) : scope === file;
}

export function scopesOverlap(left: string[], right: string[]) {
  return left.some((a) =>
    right.some((b) => a === b || scopeContains(a, b) || scopeContains(b, a)),
  );
}

export function parseTeamPlan(answer: string, maxTeammates: number) {
  let parsed: z.infer<typeof planSchema>;
  try {
    parsed = planSchema.parse(JSON.parse(jsonText(answer)));
  } catch {
    throw new AppError(
      "Lead 未回傳有效的任務計畫 JSON，請調整需求後重試。",
      422,
    );
  }
  const ids = new Set(parsed.tasks.map((task) => task.id));
  const reserved = new Set([
    "lead",
    "all",
    "user",
    "reviewer",
    "tester",
    "system",
  ]);
  if (
    ids.size !== parsed.tasks.length ||
    parsed.tasks.some(
      (task) => reserved.has(task.id) || /^member-/.test(task.id),
    )
  )
    throw new AppError("Lead 計畫包含重複或保留的任務 ID。", 422);
  for (const task of parsed.tasks) {
    if (task.dependsOn.some((id) => !ids.has(id) || id === task.id))
      throw new AppError("Lead 計畫包含無效的任務依賴。", 422);
    for (const scope of task.files) {
      const cleaned = scope.replace(/\/$/, "");
      if (
        !safeRelativePath(cleaned) ||
        cleaned === "." ||
        cleaned.split("/").some((part) => !part || part === ".") ||
        /[*?{}]/.test(cleaned) ||
        sensitivePath(cleaned)
      )
        throw new AppError(`Lead 計畫的檔案範圍無效：${scope}`, 422);
    }
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id))
      throw new AppError("Lead 計畫的任務依賴形成循環。", 422);
    if (visited.has(id)) return;
    visiting.add(id);
    parsed.tasks.find((task) => task.id === id)!.dependsOn.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  parsed.tasks.forEach((task) => visit(task.id));
  return {
    summary: parsed.summary,
    tasks: parsed.tasks.map((task, index): TeamTask => ({
      ...task,
      files: [...new Set(task.files)],
      dependsOn: [...new Set(task.dependsOn)],
      owner: `member-${(index % maxTeammates) + 1}`,
      status: task.dependsOn.length ? "pending" : "ready",
    })),
  };
}

/** Claims happen synchronously before any async work, so a task has exactly one owner. */
export function claimReadyTasks(tasks: TeamTask[], limit: number) {
  for (const task of tasks) {
    if (!["pending", "ready"].includes(task.status)) continue;
    const dependencies = task.dependsOn.map((id) =>
      tasks.find((entry) => entry.id === id)!,
    );
    if (
      dependencies.some(
        (entry) => entry.status === "failed" || entry.status === "blocked",
      )
    )
      task.status = "blocked";
    else
      task.status = dependencies.every((entry) => entry.status === "complete")
        ? "ready"
        : "pending";
  }
  const running = tasks.filter((task) => task.status === "running");
  const claimed: TeamTask[] = [];
  for (const task of tasks) {
    if (running.length + claimed.length >= limit) break;
    if (task.status !== "ready") continue;
    if (
      [...running, ...claimed].some(
        (active) =>
          active.owner === task.owner ||
          scopesOverlap(active.files, task.files),
      )
    )
      continue;
    task.status = "running";
    task.startedAt = new Date().toISOString();
    claimed.push(task);
  }
  return claimed;
}

/** Delivery means the message was included in the next bounded process prompt. */
export function consumeTeamInbox(
  team: AgentTeam,
  recipient: string,
  taskId?: string,
) {
  const received = team.messages.filter((message) =>
    message.recipients.some(
      (target) =>
        (target === recipient || target === taskId) &&
        !message.deliveredTo.includes(target),
    ),
  );
  for (const message of received) {
    for (const target of message.recipients) {
      if (
        (target === recipient || target === taskId) &&
        !message.deliveredTo.includes(target)
      )
        message.deliveredTo.push(target);
    }
    if (
      message.recipients.every((target) => message.deliveredTo.includes(target))
    ) {
      message.status = "delivered";
      message.deliveredAt = new Date().toISOString();
    }
  }
  return received.map((message) => ({
    from: message.from,
    to: message.to,
    content: message.content,
  }));
}

export function hasTeamInbox(
  team: AgentTeam,
  recipient: string,
  taskId?: string,
) {
  return team.messages.some((message) =>
    message.recipients.some(
      (target) =>
        (target === recipient || target === taskId) &&
        !message.deliveredTo.includes(target),
    ),
  );
}

/** Plain-text reports remain valid; structured messages are optional. */
export function parseMemberResult(answer: string) {
  try {
    const value = z
      .object({
        report: z.string().min(1).max(24000),
        messages: z
          .array(
            z.object({
              to: z.string().min(1).max(80),
              content: z.string().min(1).max(2000),
            }),
          )
          .max(8)
          .default([]),
      })
      .parse(JSON.parse(jsonText(answer)));
    return value;
  } catch {
    return { report: answer, messages: [] };
  }
}
