import test from "node:test";
import assert from "node:assert/strict";
import {
  agentTimeoutMs,
  describeAgentTimeout,
  hasExtendedAgentTimeout,
  maxAgentTimeoutMs,
  parseAgentTimeoutScale,
  withAgentTimeoutHint,
} from "./agent-timeouts.js";
import { AppError } from "./types.js";
import { withCliSetupHint } from "./cli-errors.js";
import { withLocale } from "./i18n/index.js";
import { command } from "./process.js";

const codex = { provider: "codex" as const };
const claude = { provider: "claude" as const };

test("Codex without an effort factor keeps the baseline per kind", () => {
  assert.equal(agentTimeoutMs("analysis", codex), 240_000);
  assert.equal(agentTimeoutMs("discovery", codex), 240_000);
  assert.equal(agentTimeoutMs("explanations", codex), 600_000);
  assert.equal(agentTimeoutMs("draft", codex), 600_000);
  assert.equal(agentTimeoutMs("read", codex), 600_000);
  assert.equal(agentTimeoutMs("write", codex), 1_800_000);
  for (const reasoningEffort of ["low", "medium", "high"] as const)
    assert.equal(agentTimeoutMs("analysis", { ...codex, reasoningEffort }), 240_000);
});

test("Claude multiplies by 2.5 and xhigh/max apply to both providers", () => {
  assert.equal(agentTimeoutMs("analysis", claude), 600_000);
  assert.equal(agentTimeoutMs("read", claude), 1_500_000);
  assert.equal(agentTimeoutMs("write", claude), 4_500_000);
  assert.equal(
    agentTimeoutMs("analysis", { ...claude, reasoningEffort: "xhigh" }),
    900_000,
  );
  assert.equal(
    agentTimeoutMs("analysis", { ...claude, reasoningEffort: "max" }),
    1_200_000,
  );
  assert.equal(
    agentTimeoutMs("analysis", { ...codex, reasoningEffort: "xhigh" }),
    360_000,
  );
  assert.equal(
    agentTimeoutMs("draft", { ...codex, reasoningEffort: "max" }),
    1_200_000,
  );
});

test("the scale multiplies, results round to whole seconds and never exceed two hours", () => {
  assert.equal(agentTimeoutMs("analysis", codex, 2), 480_000);
  assert.equal(agentTimeoutMs("analysis", codex, 0.5), 120_000);
  // 240 × 1.0001 = 240.024 s rounds to 240 s; 240 × 1.0021 = 240.504 s rounds up.
  assert.equal(agentTimeoutMs("analysis", codex, 1.0001), 240_000);
  assert.equal(agentTimeoutMs("analysis", codex, 1.0021), 241_000);
  assert.equal(agentTimeoutMs("write", claude, 10), maxAgentTimeoutMs);
  assert.equal(
    agentTimeoutMs("write", { ...claude, reasoningEffort: "max" }),
    maxAgentTimeoutMs,
  );
  assert.equal(maxAgentTimeoutMs, 7_200_000);
});

test("only Claude or xhigh/max turns announce the longer wait", () => {
  assert.equal(hasExtendedAgentTimeout(codex), false);
  assert.equal(hasExtendedAgentTimeout({ ...codex, reasoningEffort: "high" }), false);
  assert.equal(hasExtendedAgentTimeout({ ...codex, reasoningEffort: "xhigh" }), true);
  assert.equal(hasExtendedAgentTimeout({ ...codex, reasoningEffort: "max" }), true);
  assert.equal(hasExtendedAgentTimeout(claude), true);
  assert.equal(describeAgentTimeout(900_000), "最多等待 15 分鐘");
  assert.equal(describeAgentTimeout(2_250_000), "最多等待 37.5 分鐘");
});

test("command()'s 504 gets the timeout advice and an explained exit failure its explanation", () => {
  const replaced = withAgentTimeoutHint(
    new AppError("claude 執行逾時。", 504),
    "claude",
    900_000,
  );
  assert.ok(replaced instanceof AppError);
  assert.equal(replaced.statusCode, 504);
  assert.equal(
    replaced.message,
    "claude 執行逾時（已等待 15 分鐘）。較高的思考強度或大型專案需要更久；可降低思考強度、改用較快的模型，或提高 BELLPR_AGENT_TIMEOUT_SCALE。",
  );
  const failure = new AppError("codex 執行失敗：exit 1", 422);
  assert.equal(withAgentTimeoutHint(failure, "codex", 240_000), failure);
  // An exit failure the CLI explained in its event stream shows that explanation.
  const raw = new AppError('claude 執行失敗：..."result":"API Error: 500","session_id":"s"}', 422);
  const explained = withAgentTimeoutHint(raw, "claude", 900_000, "API Error: 500");
  assert.ok(explained instanceof AppError);
  assert.equal(explained.statusCode, 422);
  assert.equal(explained.message, "claude 執行失敗：API Error: 500");
  assert.equal(withAgentTimeoutHint(raw, "claude", 900_000), raw);
  // The stderr tail command() kept stays with the explained failure.
  const tail = new AppError("claude 執行失敗：{}", 422, { details: { stderr: "boom", exitCode: 1 } });
  const kept = withAgentTimeoutHint(tail, "claude", 900_000, "API Error: 500");
  assert.ok(kept instanceof AppError);
  assert.deepEqual(kept.details, { stderr: "boom", exitCode: 1 });
  // A failure recognised as a setup problem keeps its code and its sign-in fix.
  const signedOut = withCliSetupHint(
    new AppError("claude 執行失敗：{}", 422, {
      details: { stderr: "Invalid API key · Please run /login" },
    }),
    "claude",
  );
  assert.ok(signedOut instanceof AppError);
  assert.equal(signedOut.code, "claude_unauthenticated");
  assert.ok(signedOut.fixes?.length);
  assert.equal(
    withAgentTimeoutHint(signedOut, "claude", 900_000, "Invalid API key · Please run /login"),
    signedOut,
  );
  const plain = new Error("boom");
  assert.equal(withAgentTimeoutHint(plain, "codex", 240_000), plain);
});

test("time limits and command failures are worded in the locale in effect", async () => {
  await withLocale("en", async () => {
    assert.equal(describeAgentTimeout(900_000), "waits up to 15 minutes");
    assert.equal(describeAgentTimeout(2_250_000), "waits up to 37.5 minutes");
    const replaced = withAgentTimeoutHint(
      new AppError("claude timed out.", 504),
      "claude",
      900_000,
    );
    assert.ok(replaced instanceof AppError);
    assert.equal(
      replaced.message,
      "claude timed out after 15 minutes. A higher reasoning effort or a large project needs more time: lower the effort, choose a faster model, or raise BELLPR_AGENT_TIMEOUT_SCALE.",
    );
    const explained = withAgentTimeoutHint(
      new AppError('claude failed: {"type":"result","is_error":true}', 422),
      "claude",
      900_000,
      "API Error: 500",
    );
    assert.ok(explained instanceof AppError);
    assert.equal(explained.message, "claude failed: API Error: 500");
    // command() words its own failures in the caller's locale too.
    await assert.rejects(
      command(process.execPath, ["-e", "process.exit(3)"]),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 422 &&
        error.message === `${process.execPath} failed: exit 3`,
    );
    await assert.rejects(
      command(process.execPath, ["-e", 'process.stdout.write("x".repeat(4096))'], {
        maxBytes: 64,
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.message ===
          `${process.execPath} produced more output than the safety limit allows; make the task smaller.`,
    );
    await assert.rejects(
      command(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        timeoutMs: 50,
      }),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 504 &&
        error.message === `${process.execPath} timed out.`,
    );
    // A command aborted from another locale is cancelled in the caller's.
    const controller = new AbortController();
    const aborted = command(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      signal: controller.signal,
    });
    setTimeout(() => withLocale("zh-TW", () => controller.abort()), 50);
    await assert.rejects(aborted, {
      statusCode: 409,
      message: "The operation was cancelled.",
    });
    // A missing executable is one whole sentence, with the reason kept as the cause.
    await assert.rejects(
      command("bell-pr-missing-executable", []),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 503 &&
        error.message.startsWith("bell-pr-missing-executable could not start: ") &&
        (error.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT",
    );
  });
});

test("BELLPR_AGENT_TIMEOUT_SCALE defaults to 1 and accepts 0.5-10", () => {
  assert.equal(parseAgentTimeoutScale(undefined), 1);
  assert.equal(parseAgentTimeoutScale("0.5"), 0.5);
  assert.equal(parseAgentTimeoutScale("2.5"), 2.5);
  assert.equal(parseAgentTimeoutScale("10"), 10);
  for (const invalid of ["0", "0.4", "11", "-1", "two", "", " ", "NaN", "Infinity"])
    assert.throws(() => parseAgentTimeoutScale(invalid), /0\.5 and 10/);
});
