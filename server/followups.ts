import { z } from "zod";
import { followUpFeedbackLimit } from "../shared/followups.js";
import { commitMessageControl, personTrailer } from "./drafts.js";
import { jsonText } from "./team.js";
import { AppError } from "./types.js";

const entry = (field: "change" | "reason") => ({
  type: "object",
  properties: { url: { type: "string" }, [field]: { type: "string" } },
  required: ["url", field],
  additionalProperties: false,
});

// One entry per selected feedback item, plus one for the person's note.
const entryLimit = followUpFeedbackLimit + 1;
const commitMessageLimit = 4_000;

/**
 * What the follow-up agent returns after editing the PR branch checkout.
 * Like the other agent schemas, it bounds no string lengths: the CLIs differ
 * in which length keywords they accept, so lengths are handled while parsing.
 */
export const followUpJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    addressed: { type: "array", items: entry("change"), maxItems: entryLimit },
    notAddressed: { type: "array", items: entry("reason"), maxItems: entryLimit },
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: { command: { type: "string" }, outcome: { type: "string" } },
        required: ["command", "outcome"],
        additionalProperties: false,
      },
      maxItems: 40,
    },
    commitMessage: { type: "string" },
  },
  required: ["summary", "addressed", "notAddressed", "checks", "commitMessage"],
  additionalProperties: false,
};

const clipped = (max: number) =>
  z
    .string()
    .trim()
    .transform((value) => value.slice(0, max));
const resultSchema = z.object({
  summary: clipped(8_000),
  addressed: z.array(z.object({ url: z.string(), change: clipped(1_200) })),
  notAddressed: z.array(z.object({ url: z.string(), reason: clipped(1_200) })),
  // The agent's own list is not kept: the round stores the commands BELL saw run.
  checks: z.unknown(),
  commitMessage: z.string(),
});

export type FollowUpResult = {
  summary: string;
  addressed: { url: string; change: string }[];
  notAddressed: { url: string; reason: string }[];
  commitMessage: string;
};

/**
 * Validates the agent's answer. The code is already edited by then, so slips
 * are corrected instead of failing the round: overlong text is cut, empty
 * entries and entries about feedback that was not selected are dropped (""
 * stands for the person's note), and person trailers such as Signed-off-by
 * are removed from the commit message. A message that is still too long, or
 * that holds a control character other than newline (git takes it verbatim),
 * is left empty rather than cut, so the person writes it.
 */
export function parseFollowUpResult(
  answer: string,
  selectedUrls: string[],
): FollowUpResult {
  let result: z.infer<typeof resultSchema>;
  try {
    result = resultSchema.parse(JSON.parse(jsonText(answer)));
  } catch {
    throw new AppError("Agent 回傳的修正結果格式不完整", 422);
  }
  const known = (url: string) => url === "" || selectedUrls.includes(url);
  const commitMessage = result.commitMessage
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !personTrailer.test(line))
    .join("\n")
    .trim();
  return {
    summary: result.summary,
    addressed: result.addressed
      .filter((item) => item.change && known(item.url))
      .slice(0, entryLimit),
    notAddressed: result.notAddressed
      .filter((item) => item.reason && known(item.url))
      .slice(0, entryLimit),
    // Empty when every line was a trailer, it is too long or it holds a
    // control character such as an escape sequence: the person then writes it.
    commitMessage:
      commitMessage.length > commitMessageLimit ||
      commitMessageControl.test(commitMessage)
        ? ""
        : commitMessage,
  };
}
