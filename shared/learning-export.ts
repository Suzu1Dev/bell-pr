import type { Locale } from "./i18n/locale.js";
import en from "./i18n/learning-export.en.js";
import zhTW from "./i18n/learning-export.zh-TW.js";
import type { Repository, RunCore } from "./types.js";

type Messages = typeof en;
const dictionaries: Record<Locale, Messages> = { en, "zh-TW": zhTW };

/**
 * Markdown learning record for one run: what was asked, how the team planned
 * it, what each file's explanation taught, the follow-up Q&A, the PR and the
 * provider-reported usage. Pure: it only reads the run and repository, so
 * the server export and the client-side demo export share it. `locale`
 * chooses the record's own headings and labels; the run's text is copied as
 * it was written.
 */
export function buildLearningExport(
  run: RunCore,
  repo: Repository | undefined,
  locale: Locale,
): string {
  const m = dictionaries[locale];
  const sections = [
    header(m, run, repo),
    section(m.sections.task, run.prompt),
    section(m.sections.plan, run.team?.planSummary),
    section(m.sections.explanations, explanationSection(m, run)),
    section(m.sections.conversations, conversationSection(m, run)),
    section(
      m.sections.pullRequest,
      run.prUrl ? `[${run.prUrl}](${run.prUrl})` : m.noPullRequest,
    ),
    section(m.sections.usage, efficiencySection(m, run)),
  ];
  return `${sections.filter(Boolean).join("\n\n")}\n`;
}

function header(m: Messages, run: RunCore, repo?: Repository) {
  const meta = [
    repo ? m.repository({ fullName: repo.fullName }) : undefined,
    m.branch({ branch: run.branch, baseBranch: run.baseBranch }),
    m.createdAt({ createdAt: run.createdAt }),
    m.status({ status: run.status }),
  ].filter(Boolean);
  return `${m.title({ title: run.title })}\n\n${m.disclaimer}\n\n${meta.join("\n")}`;
}

function section(title: string, body?: string) {
  return body?.trim() ? `## ${title}\n\n${body.trim()}` : "";
}

/** The explanation card fields in export order; alternatives and lookup exist only on newer records. */
const explanationFields = [
  "summary",
  "reason",
  "concept",
  "tip",
  "alternatives",
  "lookup",
] as const;

function explanationSection(m: Messages, run: RunCore) {
  const entries = Object.entries(run.explanations ?? {});
  if (!entries.length) return m.noExplanations;
  return entries
    .map(([filePath, stored]) => {
      const lines = [`### \`${filePath}\``];
      const content = stored.content;
      if (stored.status !== "ready" || !content) {
        lines.push(
          stored.error
            ? m.explanationStatusWithError({
                status: stored.status,
                error: stored.error,
              })
            : m.explanationStatus({ status: stored.status }),
        );
        return lines.join("\n\n");
      }
      if (content.example) lines.push(m.example(content.example));
      for (const key of explanationFields) {
        const value = content[key];
        const text = Array.isArray(value)
          ? value.map((item) => `- ${String(item)}`).join("\n")
          : typeof value === "string"
            ? value
            : "";
        if (text.trim()) lines.push(`**${m.fields[key]}**\n\n${text}`);
      }
      if (content.selfCheck) lines.push(m.selfCheck(content.selfCheck));
      return lines.join("\n\n");
    })
    .join("\n\n");
}

function conversationSection(m: Messages, run: RunCore) {
  const entries = Object.entries(run.conversations ?? {}).filter(
    ([, conversation]) => conversation.messages.length,
  );
  if (!entries.length) return m.noConversations;
  return entries
    .map(([filePath, conversation]) => {
      const turns = conversation.messages.map((message) => {
        const stale =
          message.fingerprint !== undefined &&
          message.fingerprint !== conversation.fingerprint;
        const author = message.role === "user" ? m.you : m.assistant;
        const heading = stale ? m.staleTurn({ author }) : m.turn({ author });
        return `${heading}\n\n${message.content}`;
      });
      return [`### \`${filePath}\``, ...turns].join("\n\n");
    })
    .join("\n\n");
}

function efficiencySection(m: Messages, run: RunCore) {
  const usage = run.efficiency;
  if (!usage) return m.noUsage;
  const lines = [
    m.calls({
      calls: usage.calls,
      completed: usage.completedCalls,
      failed: usage.failedCalls,
    }),
    m.measured({ measured: usage.measuredCalls, calls: usage.calls }),
    m.inputTokens({
      input: usage.inputTokens,
      cached: usage.cachedInputTokens,
    }),
    m.outputTokens({ output: usage.outputTokens }),
    m.duration({ seconds: Math.round(usage.durationMs / 1000) }),
    m.mode({ mode: usage.mode, policyVersion: usage.policyVersion }),
  ];
  if (usage.measuredCalls < usage.calls) lines.push(m.unmeasured);
  return lines.join("\n");
}
