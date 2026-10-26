import test from "node:test";
import assert from "node:assert/strict";
import { exitStatusCanHideFailure } from "./exit-status.js";

test("a line whose exit status another command in it could set can hide a failure", () => {
  for (const command of [
    "npm test 2>&1 | tail -40",
    "cd /work/tree && npm test 2>&1 | tail -40",
    "npm test |& tee test.log",
    "npm test || true",
    "npm test || :",
    "npm test; true",
    "npm test; echo \"exit $?\"",
    "npm test -- a.test.ts\ncat /tmp/out.log",
    "npm test &",
    "if npm test; then echo ok; fi",
    "(npm test; echo done)",
    // Codex reports the shell wrapper with the script quoted inside it.
    "bash -lc 'npm test 2>&1 | tail -40'",
    "/bin/zsh -lc 'cd app && npm test || true'",
    `bash -lc 'echo '"'"'start'"'"' | cat'`,
    "set -o pipefail; npm test | tail; echo done",
  ])
    assert.equal(exitStatusCanHideFailure(command), true, command);
});

test("a line whose exit status is its test command's cannot hide a failure", () => {
  for (const command of [
    "npm test",
    "npm test\n",
    "npm test -- a.test.ts 2>&1",
    "npm test &> test.log",
    "npm test > test.log 2>&1 && cat test.log",
    "npm run build && npm test && echo ok",
    "cd /work/tree && npm test",
    "cd app; npm test",
    "export CI=1; npm test",
    "CI=1; npm test",
    "npm test -- --grep 'a|b' \"c || d\" e\\|f",
    "npm test # | tail",
    "set -o pipefail; npm test 2>&1 | tail -40",
    "set -euo pipefail && npm test | tail -40",
    "bash -lc 'set -o pipefail; npm test | tail -40'",
    "/bin/zsh -lc 'npm test'",
    "echo ok >| out.log",
    "cat > note.txt <<'EOF'\nfirst | second\nthird; fourth\nEOF",
    "git commit -F - <<-EOF\n\tSubject || body\n\tEOF\n",
  ])
    assert.equal(exitStatusCanHideFailure(command), false, command);
});
