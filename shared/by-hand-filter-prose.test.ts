// The code filter (DESIGN v1.2 F7) on code written without spaces, in en
// and zh-TW prose: "delay*2", "x=y", "a&&b", "fn(x)=>x", "arr[i]" and the
// like go unless they quote the files exactly, while ordinary prose keeps
// "24/7", "e-mail", "C++", "x86-64", "and/or", path:line refs, versions,
// links, file names, times, ratios and emoticons.
import assert from "node:assert/strict";
import test from "node:test";
import { filterAgentText, filterGuideOutput, type FilterSources } from "./by-hand-filter.js";

const base = [
  "export async function retry(fn, attempts) {",
  "  for (let attempt = 1; attempt <= attempts; attempt++) {",
  "    try {",
  "      return await fn();",
  "    } catch (error) {",
  "      if (attempt === attempts) throw error;",
  "      const wait = delay*attempt;",
  "    }",
  "  }",
  "}",
];
const sources: FilterSources = {
  base: { "src/retry.ts": base },
  worktree: { "src/retry.ts": base },
  diff: "",
  protectedFiles: ["src/retry.ts"],
};

/** Prose the filter keeps whole: nothing removed. */
const prose = [
  "The service runs 24/7 and retries on a 503.",
  "Send the maintainers an e-mail if the build fails.",
  "The project is written in C++ and Python.",
  "Read the C++17 notes and compile with g++ or clang.",
  "It targets x86-64 and arm64 machines.",
  "Pass the flag and/or set the variable.",
  "See src/retry.ts:12 for the loop.",
  "Lines src/retry.ts:12-18 hold the catch block.",
  "Version 1.2.3 changed the default; v1.3 is next.",
  "The docs at https://nodejs.org/api/timers.html explain the timers.",
  "A search like https://github.com/search?q=retry&type=code finds more.",
  "Open README.md and CONTRIBUTING.md first.",
  "This runs on Node.js 22 or later.",
  "The meeting is at 10:30 tomorrow, 09:00-17:00 on Fridays.",
  "Keep the ratio at 3:1 between reads and writes.",
  "Nice work so far :) and that one is tricky ;)",
  "Ha :-) that test is flaky ^_^ <3 :D",
  "Hmm o_O, that passed?",
  "Use Ctrl+C to stop the watcher.",
  "Press Ctrl + C, then Cmd+Shift+P to open the palette.",
  "Half the tests pass (50%), which is 100% expected.",
  "It took 2-3 seconds, roughly 2–3 runs.",
  "The file is read-only; nothing changes.",
  "Use UTF-8 for the file.",
  "A/B tests and TCP/IP are out of scope here.",
  "The I/O layer lives in src/io/.",
  "Commit 3f9c2a1 changed it.",
  "See issue #123 and PR #456.",
  "Ask @maintainer on the forum.",
  "It retries 3x before failing.",
  "Wait ~5 seconds between attempts.",
  "The suite has 10+ tests and +1 from me.",
  "Use the --verbose flag to see more, or --max-count=5.",
  "Set the timeout in seconds, e.g. 30, i.e. half a minute.",
  "Step 1: read; step 2: test.",
  "The resolution is 1920x1080.",
  "Python 3.12 and Node 22 both work.",
  "The file(s) you changed are listed, and the test(s) too.",
  "Retries happen after a 503 (Service Unavailable).",
  "Read the docs first - then the code.",
  "It is a 3-step process.",
  "The rate is 5 req/s at most.",
  "The answer is yes/no.",
  "The function retry() is called once per request.",
  "Is it -1 or +1?",
  "**Note:** keep it small, *really* small.",
  "Q&A is on Fridays; R&D is elsewhere.",
  "The C# and F# ports are separate.",
  "The score was 3/5, so 60%.",
  "The ~/.config folder holds it.",
  "As 1+1=2 in the README, digits alone are arithmetic, not code.",
  "Steps:\n* Read the loop\n* Run the tests",
  "Two ideas\n+ ask a maintainer\n+ read the issue again",
  // zh-TW
  "請先看 src/retry.ts:12 的迴圈。",
  "服務全天候 24/7 運作。",
  "這個專案是用 C++ 寫的。",
  "在 10:30 開會，比例是 3:1。",
  "版本 1.2.3 改了預設值。",
  "請用 Node.js 22 以上的版本。",
  "先讀 README.md 再動手 :)",
  "測試大概要 2-3 秒。",
  "請按 Ctrl+C 停止監看。",
  "參考 https://nodejs.org/api/timers.html 的說明。",
  "第1步：讀程式；第2步：跑測試。",
  "重試3次後才算失敗。",
  "retry() 每個請求只呼叫一次。",
];

/** Code written into prose, and the piece of it that must not survive. */
const code: [string, string][] = [
  ["Write return delay*2; there.", "delay*2"],
  ["Use attempt+1 as the next value.", "attempt+1"],
  ["Then x=y in the loop.", "x=y"],
  ["Guard it with a&&b first.", "a&&b"],
  ["Pass fn(x)=>x to it.", "=>x"],
  ["Read arr[i] inside the loop.", "arr[i]"],
  ["Set obj.prop=1 before the call.", "prop=1"],
  ["Return delay*2**attempt there.", "2**attempt"],
  ["Write i++; after the call.", "i++"],
  ["Use count++ in the loop.", "count++"],
  ["Add attempt+=1 at the end.", "+=1"],
  ["Check x!==y first.", "x!==y"],
  ["Use a||b as the fallback.", "a||b"],
  ["Use a??b instead.", "a??b"],
  ["Call user?.name there.", "user?.name"],
  ["Shift with x<<2.", "x<<2"],
  ["Use n%2 to find odd ones.", "n%2"],
  ["Compare a<b and swap.", "a<b"],
  ["Use x>=0 as the guard.", "x>=0"],
  ["Use x<=limit there.", "x<=limit"],
  ["Use x==null.", "x==null"],
  ["Then retry(fn, 2) with the new count.", "retry(fn, 2)"],
  ["Call Math.max(a, b) there.", "Math.max(a, b)"],
  ["Use items.map(x=>x*2) for it.", "x*2"],
  ["Write if(attempt<3) above.", "attempt<3"],
  ["Write while(true) around it.", "while(true)"],
  ["Use {retries:3} as the options.", "retries:3"],
  ["Use Vec<u8> there.", "Vec<u8>"],
  ["Use std::time::sleep instead.", "std::time"],
  ["Make it delay*=2 each time.", "delay*=2"],
  ["Set retries=3 in the config.", "retries=3"],
  ["Write x?.y??z there.", "x?.y??z"],
  ["Return a.b.c=d.", "c=d"],
  ["Use list[0] for the first one.", "list[0]"],
  ["Use map['key'] there.", "map['key']"],
  ["Write return(x) in the else branch.", "return(x)"],
  ["Use lambda x:x+1 there.", "x+1"],
  ['Join "a"+"b" there.', '"a"+"b"'],
  ["Set x[0]=1 first.", "x[0]=1"],
  ["Return x?1:2 there.", "x?1:2"],
  ["Use x>>1 to halve it.", "x>>1"],
  ["Make it x^=y.", "x^=y"],
  ["Use mask|=1 there.", "mask|=1"],
  ["Use a!=b there.", "a!=b"],
  ["Add sleep(delay*2) in the catch.", "delay*2"],
  ["Use 2**attempt as the delay.", "2**attempt"],
  ["Use a ?? b instead.", "a ?? b"],
  ["Shift with x << 2 here.", "x << 2"],
  ["Use await sleep(attempt*delay).", "attempt*delay"],
  // zh-TW
  ["把它改成delay*2就好。", "delay*2"],
  ["改成 attempt+1 試試。", "attempt+1"],
  ["用 x=y 就行。", "x=y"],
  ["在迴圈裡加 i++;", "i++"],
  ["改成 retry(fn, 2) 再跑。", "retry(fn, 2)"],
  ["把條件寫成a&&b。", "a&&b"],
];

test(`${prose.length} prose samples keep every character`, () => {
  assert.ok(prose.length >= 40);
  for (const text of prose) assert.deepEqual(filterAgentText(text, sources), { value: text, removed: 0, dropped: 0 }, text);
});

test(`${code.length} samples of code written into prose lose it`, () => {
  assert.ok(code.length >= 40);
  for (const [text, piece] of code) {
    const filtered = filterAgentText(text, sources);
    assert.ok(filtered.removed >= 1, `${text} → ${filtered.value}`);
    assert.ok(!filtered.value.includes(piece), `${piece} survived in ${filtered.value}`);
  }
});

test("code that quotes the files exactly stays, with or without spaces", () => {
  for (const text of ["It waits delay*attempt between tries.", "The loop runs while attempt <= attempts.", "It calls retry(fn, attempts) once.", "The loop ends on attempt++ each time."])
    assert.equal(filterAgentText(text, sources).removed, 0, text);
});

test("a tooling answer's command can't carry code in an inline program or a quoted argument", () => {
  const tooling = (text: string) =>
    filterGuideOutput({ text, question: null, refs: [], quotes: [], options: null, topic: "tooling", askedForCode: false }, sources).value.text;
  for (const text of [
    'Run `node -e "console.log(delay*2**attempt)"` to check.',
    "Run `node --print 'retry(fn, 2)'` to check.",
    "Run `bash -c 'x=y'` first.",
    "Run `node scripts/check.js 'delay * 2 ** attempt'` to check.",
    "Run `npm test -- --grep 'attempt+1'` to check.",
    "Run `echo delay*2` to see it.",
  ])
    assert.match(tooling(text), /^Run … /, text);
  for (const text of ["Run `npm ci && npm test` first.", "Run `npx jest -t 'retries a 503'` only.", "Run `git log -p src/retry.ts` to read its history.", "Run `npm test -- retry > out.log` to keep the output."])
    assert.equal(tooling(text), text);
});

test("no-break spaces, carriage returns and invisible characters can't split code a reader sees whole", () => {
  for (const [text, piece] of [
    ["Make it delay\u00A0*\u00A02 there.", "*\u00A02"],
    ["Make it delay\u202F*\u202F2 there.", "*\u202F2"],
    ["Make it delay *\r2 there.", "*\r2"],
    ["Make it delay *\r\n2 there.", "*\r\n2"],
    ["Make it delay*\u200D2 there.", "*\u200D2"],
    ["Make it delay\u2062*2 there.", "*2"],
    ["Make it attempt+\u034F1 there.", "+\u034F1"],
  ]) {
    const filtered = filterAgentText(text, sources);
    assert.ok(filtered.removed >= 1 && !filtered.value.includes(piece), `${JSON.stringify(text)} → ${JSON.stringify(filtered.value)}`);
  }
  // Prose keeps its no-break spaces and its line breaks.
  for (const text of ["It took 2\u00A0seconds.", "Read the loop.\nThen run the tests.", "請先看 src/retry.ts:12\u3000的迴圈。"])
    assert.deepEqual(filterAgentText(text, sources), { value: text, removed: 0, dropped: 0 }, text);
});

test("an operator spaced on one side only is code too, while emphasis, +1 and <3 stay prose", () => {
  for (const [text, piece] of [
    ["Then x =y in the loop.", "x =y"],
    ["Then x= y in the loop.", "x= y"],
    ["Guard it with a&& b first.", "a&& b"],
    ["Use a ??b instead.", "a ??b"],
    ["Write return delay *2; there.", "delay *2"],
    ["Write return delay* 2; there.", "delay* 2"],
    ["Add attempt +=1 at the end.", "attempt +=1"],
    ["Check x !==y first.", "x !==y"],
    ["Use fn(x) =>x there.", "=>x"],
  ]) {
    const filtered = filterAgentText(text, sources);
    assert.ok(filtered.removed >= 1 && !filtered.value.includes(piece), `${text} → ${filtered.value}`);
  }
  for (const text of ["This is *really* small, **Step 2** first.", "I'd say +1 to that.", "Love it <3 and **Note:** read it.", "Keep it at 50 %; that's fine."])
    assert.deepEqual(filterAgentText(text, sources), { value: text, removed: 0, dropped: 0 }, text);
});
