import type { ChangeExplanation } from "./explanations.js";
import type { Repository, RunCore } from "./types.js";

/**
 * Markdown learning record for one run: what was asked, how the team planned
 * it, what each file's explanation taught, the follow-up Q&A, the PR and the
 * provider-reported usage. Pure: it only reads the run and repository, so
 * the server export and the client-side demo export share it.
 */
export function buildLearningExport(run: RunCore, repo?: Repository): string {
  const sections = [
    header(run, repo),
    section("任務描述", run.prompt),
    section("團隊計畫", run.team?.planSummary),
    section("檔案解說", explanationSection(run)),
    section("問答紀錄", conversationSection(run)),
    section(
      "Pull Request",
      run.prUrl ? `[${run.prUrl}](${run.prUrl})` : "尚未送出 PR。",
    ),
    section("Agent 用量", efficiencySection(run)),
  ];
  return `${sections.filter(Boolean).join("\n\n")}\n`;
}

function header(run: RunCore, repo?: Repository) {
  const meta = [
    repo ? `- Repository：${repo.fullName}` : undefined,
    `- 分支：${run.branch} → ${run.baseBranch}`,
    `- 建立時間：${run.createdAt}`,
    `- 狀態：${run.status}`,
  ].filter(Boolean);
  return `# 學習紀錄：${run.title}\n\n> 本紀錄的解說、問答與審查內容由 agent 產生，可能有誤；程式碼與結論仍需自行驗證。\n\n${meta.join("\n")}`;
}

function section(title: string, body?: string) {
  return body?.trim() ? `## ${title}\n\n${body.trim()}` : "";
}

/** Labels for the explanation card; alternatives, lookup and selfCheck exist only on newer records. */
const explanationFields: [keyof ChangeExplanation, string][] = [
  ["summary", "改了什麼"],
  ["reason", "為什麼改"],
  ["concept", "開發觀念"],
  ["tip", "審閱提醒"],
  ["alternatives", "其他做法"],
  ["lookup", "可以查"],
];

function explanationSection(run: RunCore) {
  const entries = Object.entries(run.explanations ?? {});
  if (!entries.length) return "尚未產生解說。";
  return entries
    .map(([filePath, stored]) => {
      const lines = [`### \`${filePath}\``];
      const content = stored.content;
      if (stored.status !== "ready" || !content) {
        lines.push(`解說狀態：${stored.status}${stored.error ? `（${stored.error}）` : ""}`);
        return lines.join("\n\n");
      }
      if (content.example) {
        const { scenario, before, after } = content.example;
        lines.push(
          `**白話文舉例**\n\n- 情境：${scenario}\n- 修改前：${before}\n- 修改後：${after}`,
        );
      }
      for (const [key, label] of explanationFields) {
        const value = content[key];
        const text = Array.isArray(value)
          ? value.map((item) => `- ${String(item)}`).join("\n")
          : typeof value === "string"
            ? value
            : "";
        if (text.trim()) lines.push(`**${label}**\n\n${text}`);
      }
      if (content.selfCheck)
        lines.push(
          `**考考自己**\n\n問題：${content.selfCheck.question}\n\n答案：${content.selfCheck.answer}`,
        );
      return lines.join("\n\n");
    })
    .join("\n\n");
}

function conversationSection(run: RunCore) {
  const entries = Object.entries(run.conversations ?? {}).filter(
    ([, conversation]) => conversation.messages.length,
  );
  if (!entries.length) return "沒有問答紀錄。";
  return entries
    .map(([filePath, conversation]) => {
      const turns = conversation.messages.map((message) => {
        const stale =
          message.fingerprint !== undefined &&
          message.fingerprint !== conversation.fingerprint;
        const author = message.role === "user" ? "你" : "學習助手";
        return `**${author}${stale ? "（針對較舊版本）" : ""}：**\n\n${message.content}`;
      });
      return [`### \`${filePath}\``, ...turns].join("\n\n");
    })
    .join("\n\n");
}

function efficiencySection(run: RunCore) {
  const usage = run.efficiency;
  if (!usage) return "沒有用量紀錄。";
  const lines = [
    `- 呼叫次數：${usage.calls}（完成 ${usage.completedCalls}、失敗 ${usage.failedCalls}）`,
    `- 用量回報：${usage.measuredCalls} / ${usage.calls} 次`,
    `- 輸入 tokens：${usage.inputTokens}（含快取讀取 ${usage.cachedInputTokens}）`,
    `- 輸出 tokens：${usage.outputTokens}`,
    `- Agent 執行時間：${Math.round(usage.durationMs / 1000)} 秒`,
    `- Ponytail 模式：${usage.mode}（${usage.policyVersion}）`,
  ];
  if (usage.measuredCalls < usage.calls)
    lines.push(
      "- 注意：有呼叫未回報用量，上述 tokens 只加總已回報部分；未回報的用量為未知，不是 0。",
    );
  return lines.join("\n");
}
