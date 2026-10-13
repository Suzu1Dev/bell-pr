import assert from "node:assert/strict";
import test from "node:test";
import { mergeSetupNeeds } from "../shared/setup.js";
import { commandEnvironment, installBoundaries, parseSetupNeeds } from "./setup.js";

test("agents are told plainly where their commands run and what they may install", () => {
  assert.match(commandEnvironment("claude"), /not sandboxed/);
  assert.match(commandEnvironment("codex"), /workspace-write sandbox/);
  assert.equal(commandEnvironment(), commandEnvironment("codex"));
  assert.match(installBoundaries, /no sudo/);
  assert.match(installBoundaries, /rustup component add/);
  assert.match(installBoundaries, /npm ci/);
});

test("only one-line commands that download nothing into a shell reach the person's checklist", () => {
  const needs = parseSetupNeeds([
    { need: "GLib 開發標頭", command: "  sudo apt install libglib2.0-dev  ", reason: "cargo test 需要。" },
    { need: "rustup", command: "curl -sSf https://sh.rustup.rs | sh", reason: "x" },
    { need: "piped", command: "cat install.txt | sudo bash", reason: "x" },
    { need: "two lines", command: "sudo apt update\nsudo apt install x", reason: "x" },
    { need: "too long", command: `sudo apt install ${"a".repeat(300)}`, reason: "x" },
    { need: "", command: "npm ci", reason: "missing need" },
    "not an object",
    null,
  ]);
  assert.deepEqual(needs, [
    { need: "GLib 開發標頭", command: "sudo apt install libglib2.0-dev", reason: "cargo test 需要。" },
  ]);
  assert.deepEqual(parseSetupNeeds(undefined), []);
  assert.equal(
    parseSetupNeeds(Array.from({ length: 12 }, (_, index) => ({ need: "n", command: `apt install p${index}`, reason: "" }))).length,
    10,
  );
});

test("the checklist lists a command once, with every agent that reported it", () => {
  const glib = { need: "GLib", command: "sudo apt install libglib2.0-dev", reason: "a" };
  assert.deepEqual(
    mergeSetupNeeds([
      { from: "Teammate 1", needs: [glib] },
      { from: "Teammate 2", needs: [{ ...glib, command: "sudo apt  install libglib2.0-dev", reason: "b" }] },
      { from: "Teammate 2", needs: [glib] },
      { from: "修正第 1 輪" },
    ]),
    [{ ...glib, from: ["Teammate 1", "Teammate 2"] }],
  );
});
