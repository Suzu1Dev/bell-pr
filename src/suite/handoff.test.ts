import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrOutgoingHandoff,
  clearPrHandoff,
  diffHandoffText,
  panelHandoffContext,
  parsePrHandoff,
  prBackRoute,
  readPrHandoff,
  stripPrHandoffHash,
  writePrHandoff,
} from "./handoff";
import { getDemo } from "../demo";

const links = {
  explain: "http://127.0.0.1:21111",
  personal: "http://127.0.0.1:21113",
  reader: "http://127.0.0.1:21104",
  campaign: "http://127.0.0.1:21105",
};

test("buildPrOutgoingHandoff creates contract-compliant sibling URLs with normalized back route", () => {
  const explainUrl = buildPrOutgoingHandoff({
    target: "explain",
    origin: links.explain,
    title: "Retry exponential backoff",
    text: "Explain why jitter avoids synchronized thundering herds.",
    back: "#/runs/demo-run/changes?file=src/retry.ts",
  });
  const parsed = new URL(explainUrl);
  assert.equal(parsed.origin, "http://127.0.0.1:21111");
  assert.ok(parsed.hash.startsWith("#/explain?"));
  const query = new URLSearchParams(parsed.hash.slice("#/explain?".length));
  assert.equal(query.get("from"), "pr");
  assert.equal(query.get("title"), "Retry exponential backoff");
  assert.equal(query.get("back"), "#/runs/demo-run");
  assert.match(query.get("text") ?? "", /thundering herds/);

  // Personal takes `draft` without `title`, folding title into draft text.
  const personalUrl = buildPrOutgoingHandoff({
    target: "personal",
    origin: links.personal,
    title: "Follow up on PR #42",
    text: "Check maintainer CI feedback tomorrow morning.",
    back: "#/home",
  });
  const pQuery = new URLSearchParams(new URL(personalUrl).hash.slice("#/tasks?".length));
  assert.equal(pQuery.get("title"), null);
  assert.match(pQuery.get("draft") ?? "", /^Follow up on PR #42 — Check maintainer CI/);
  assert.equal(pQuery.get("back"), "#/home");
});

test("parsePrHandoff accepts valid drafts, validates back route, and rejects unlinked or duplicate params", () => {
  const valid = parsePrHandoff(
    "#/discover?draft=Add+dark+mode+tokens&title=Dark+mode&from=explain&back=%23%2Fexplain",
    links,
  );
  assert.deepEqual(valid, {
    from: "explain",
    title: "Dark mode",
    text: "Add dark mode tokens",
    truncated: false,
    backUrl: "http://127.0.0.1:21111/#/explain",
  });

  // Invalid back route (open redirect attempt) drops backUrl while keeping the draft.
  const badBack = parsePrHandoff(
    "#/discover?draft=Audit+CSP&from=reader&back=https%3A%2F%2Fevil.example",
    links,
  );
  assert.ok(badBack && !("rejected" in badBack));
  assert.equal(badBack.backUrl, undefined);

  // Duplicate handoff keys (D9) are rejected.
  assert.deepEqual(
    parsePrHandoff("#/discover?draft=one&draft=two&from=explain", links),
    { rejected: "duplicate" },
  );

  // Unlinked sibling is rejected.
  assert.deepEqual(
    parsePrHandoff("#/discover?draft=one&from=campaign", { explain: links.explain }),
    { rejected: "from" },
  );
});

test("stripPrHandoffHash removes reserved handoff keys while keeping presentation flags", () => {
  assert.equal(
    stripPrHandoffHash("#/discover?draft=Fix+bug&title=Fix&from=personal&back=%23%2Ftasks&suite=1&theme=dark"),
    "#/discover?suite=1&theme=dark",
  );
  assert.equal(stripPrHandoffHash("#/home?text=Hello&from=reader"), "#/home");
  assert.equal(prBackRoute("#/runs/run_123/draft"), "#/runs/run_123");
});

test("writePrHandoff, readPrHandoff and clearPrHandoff round-trip cleanly", () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
  writePrHandoff(storage, {
    from: "campaign",
    title: "Launch checklist",
    text: "Add CLI --suite flag and contrast tests",
    truncated: false,
    backUrl: "http://127.0.0.1:21105/#/tasks",
  });
  const loaded = readPrHandoff(storage);
  assert.equal(loaded?.from, "campaign");
  assert.equal(loaded?.title, "Launch checklist");
  assert.equal(loaded?.backUrl, "http://127.0.0.1:21105/#/tasks");
  clearPrHandoff(storage);
  assert.equal(readPrHandoff(storage), undefined);
});

test("diffHandoffText formats whole diff or selected lines and suppresses blocked files", () => {
  const file = getDemo("en").files[0];
  const full = diffHandoffText(file);
  assert.equal(full.title, file.path);
  assert.match(full.text, new RegExp(`^${file.path.replace(/\./g, "\\.")} \\(\\+\\d+ −\\d+\\)`));
  assert.ok(full.text.includes(file.patch.trim()));

  const selected = diffHandoffText(file, [
    { id: 1, kind: "context", text: "const wait = delay;", oldLine: 10, newLine: 10 },
    { id: 2, kind: "added", text: "const jitter = wait * 0.2;", oldLine: null, newLine: 11 },
  ]);
  assert.equal(selected.title, `${file.path}:L10-L11`);
  assert.equal(selected.text, `${file.path}\n\n const wait = delay;\n+const jitter = wait * 0.2;`);

  assert.deepEqual(diffHandoffText({ ...file, blocked: "Binary file" }), { title: "", text: "" });
});

test("panelHandoffContext picks tab-specific content, falls back to diff when unasked/missing, and hides blocked files", () => {
  const { files, run } = getDemo("en");
  const file = files[0];
  const client = files.find((entry) => entry.walkthrough?.functions.length)!;

  const explain = panelHandoffContext(file, "explain");
  assert.ok(explain.title.length > 0 && explain.title.length <= 100);
  assert.ok(explain.text.includes(file.explanation!.summary));
  assert.ok(explain.text.includes(file.explanation!.reason));

  const walkthrough = panelHandoffContext(client, "walkthrough");
  assert.equal(walkthrough.title, client.path);
  assert.ok(walkthrough.text.includes(client.walkthrough!.functions[0].name));

  const reports = panelHandoffContext(file, "reports", { reports: run.reports });
  assert.equal(reports.title, file.path);
  assert.ok(reports.text.includes(run.reports!.implementer!.trim()));

  const chat = panelHandoffContext(file, "chat", {
    messages: [
      { role: "user", content: "Why?" },
      { role: "assistant", content: "Because exponential backoff avoids retry storms." },
      { role: "assistant", content: "Failed", failed: true },
    ],
  });
  assert.equal(chat.title, file.path);
  assert.equal(chat.text, `${file.path}\n\nBecause exponential backoff avoids retry storms.`);

  // ReaderView / pending / failed / team fallback uses diff context.
  const fallback = panelHandoffContext({ ...file, explanation: undefined, walkthrough: undefined }, "explain");
  assert.deepEqual(fallback, diffHandoffText({ ...file, explanation: undefined, walkthrough: undefined }));

  const teamFallback = panelHandoffContext(file, "team");
  assert.deepEqual(teamFallback, diffHandoffText(file));

  assert.deepEqual(panelHandoffContext({ ...file, blocked: "Too large" }, "explain"), { title: "", text: "" });
});
