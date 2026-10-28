import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionMessage, WorkSession } from "../../shared/session";
import type { RunLogEntry } from "../types";
import {
  sessionActivity,
  sessionAwaitsAnswer,
  sessionMovedFiles,
  sessionTurnBlock,
  showSessionTab,
  type SessionRun,
} from "./state";

function run(overrides: Partial<SessionRun> = {}): SessionRun {
  return { status: "review", logs: [], ...overrides };
}

function session(overrides: Partial<WorkSession> = {}): WorkSession {
  return { messages: [], revision: 0, updatedAt: "t", ...overrides };
}

function message(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return { id: "m", role: "agent", content: "", at: "t", ...overrides };
}

function log(time: string, agent: string, text: string): RunLogEntry {
  return { time, agent, message: text };
}

test("the 協作 tab shows for real runs past their first agent turn", () => {
  assert.equal(showSessionTab(run({ status: "review" }), false), true);
  assert.equal(showSessionTab(run({ status: "published" }), false), true);
  assert.equal(showSessionTab(run({ status: "failed" }), false), true);
  assert.equal(showSessionTab(run({ status: "cancelled" }), false), true);
  assert.equal(
    showSessionTab(run({ status: "queued", session: session() }), false),
    true,
  );
  assert.equal(showSessionTab(run({ status: "running" }), false), false);
  assert.equal(showSessionTab(run({ status: "review" }), true), false);
});

test("a new agent turn is blocked with the reason the server would give", () => {
  assert.equal(sessionTurnBlock(run({ status: "review" })), undefined);
  assert.equal(sessionTurnBlock(run({ status: "approved" })), undefined);
  assert.match(
    sessionTurnBlock(run({ session: session({ running: true, startedAt: "t" }) })) ?? "",
    /agent is editing code/,
  );
  assert.match(sessionTurnBlock(run({ publishing: true })) ?? "", /PR is being submitted/);
  assert.match(sessionTurnBlock(run({ status: "published" })) ?? "", /review follow-up/);
  assert.match(sessionTurnBlock(run({ status: "failed" })) ?? "", /has ended/);
  assert.match(sessionTurnBlock(run({ status: "running" })) ?? "", /Agents or review are still running/);
  assert.match(
    sessionTurnBlock(
      run({
        followUps: [
          {
            id: "round",
            requestedAt: "t",
            feedbackUrls: [],
            status: "review",
            parentCommit: "abc",
          },
        ],
      }),
    ) ?? "",
    /follow-up round is in progress/,
  );
});

test("an unanswered agent question flags the tab until the person answers", () => {
  assert.equal(sessionAwaitsAnswer(undefined), false);
  assert.equal(sessionAwaitsAnswer(session()), false);
  assert.equal(sessionAwaitsAnswer(session({ messages: [message()] })), false);
  assert.equal(
    sessionAwaitsAnswer(
      session({ messages: [message({ questions: ["Which test?"] })] }),
    ),
    true,
  );
  assert.equal(
    sessionAwaitsAnswer(
      session({
        messages: [
          message({ questions: ["Which test?"] }),
          message({ id: "u", role: "user", content: "Use the unit test." }),
        ],
      }),
    ),
    false,
  );
});

test("the activity strip shows the running turn's own entries, newest last", () => {
  const logs = [
    log("2026-10-07T00:00:00.000Z", "session", "before the turn"),
    log("2026-10-07T00:00:02.000Z", "Builder", "another agent"),
    log("2026-10-07T00:00:03.000Z", "session", "npm run build"),
    log("2026-10-07T00:00:04.000Z", "session", "edited src/a.ts"),
  ];
  const turn = session({ running: true, startedAt: "2026-10-07T00:00:01.000Z" });
  assert.deepEqual(
    sessionActivity(run({ logs, session: turn })).map((entry) => entry.message),
    ["npm run build", "edited src/a.ts"],
  );
  assert.deepEqual(sessionActivity(run({ logs })), []);

  const many = Array.from({ length: 10 }, (_, index) =>
    log(`2026-10-07T00:00:${String(10 + index)}.000Z`, "session", `step ${index}`),
  );
  assert.deepEqual(
    sessionActivity(
      run({
        logs: many,
        session: session({ running: true, startedAt: "2026-10-07T00:00:00.000Z" }),
      }),
    ).map((entry) => entry.message),
    Array.from({ length: 8 }, (_, index) => `step ${index + 2}`),
  );
});

test("a finished turn or a new revision means the diff moved", () => {
  assert.equal(sessionMovedFiles(undefined, session({ revision: 1 })), false);
  assert.equal(sessionMovedFiles({ revision: 0 }, undefined), false);
  assert.equal(
    sessionMovedFiles({ running: true, revision: 0 }, session({ running: false })),
    true,
  );
  assert.equal(
    sessionMovedFiles({ running: false, revision: 1 }, session({ revision: 2 })),
    true,
  );
  assert.equal(
    sessionMovedFiles({ running: true, revision: 1 }, session({ running: true, revision: 1 })),
    false,
  );
  assert.equal(
    sessionMovedFiles({ running: false, revision: 2 }, session({ revision: 2 })),
    false,
  );
});

test("Learn by hand never offers writable sessions and an ongoing review blocks a turn", () => {
  assert.equal(showSessionTab(run({ learnByHand: true }), false), false);
  assert.equal(showSessionTab(run({ learnByHand: true, session: session() }), false), false);
  assert.match(sessionTurnBlock(run({ learnByHand: true })) ?? "", /Learn by hand/);
  assert.match(sessionTurnBlock(run({ agents: [{ status: "running" }] as SessionRun["agents"] })) ?? "", /still running/);
});
