/**
 * Whether a shell command line reported as successful is evidence that the
 * commands in it succeeded. A pipeline reports only its last command
 * (`npm test | tail`) unless pipefail is set, `||` replaces a failure with
 * the next command's status (`npm test || true`), a command after `;` or a
 * newline sets the status (`npm test; echo done`), and `&` does not wait.
 * `&&` keeps a failure, so `npm test && echo ok` stays evidence.
 */

/** What commandUnverified means, for the prompts that read observed checks. */
export const unverifiedOutcomeNote =
  "an outcome that goes on to say it is not verified (worded in the person's language) means another command run with it, such as a pipe into tail, ||, ; or &, set the exit status: it is no evidence that the command passed, so never present it as a pass the application saw";

type Token = { op: "|" | "||" | "&&" | ";" | "&" } | { word: string };

const shell = /^(?:\S*\/)?(?:ba|da|k|z)?sh$/;
/** Commands before `;` whose own status says nothing about a test result. */
const setup = /^(?:cd|export|set|setopt)$/;
const assignment = /^[A-Za-z_]\w*=/;

/**
 * Shell words and the list and pipeline operators between them. Quoted
 * text, comments and here-document bodies are never operators; a
 * redirection such as `2>&1` stays part of the words.
 */
function tokens(line: string): Token[] {
  const out: Token[] = [];
  const heredocs: { end: string; tabs: boolean }[] = [];
  let word: string | undefined;
  const finish = () => {
    if (word !== undefined) out.push({ word });
    word = undefined;
  };
  const op = (value: "|" | "||" | "&&" | ";" | "&") => {
    finish();
    out.push({ op: value });
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const next = line[i + 1];
    if (c === "\\") {
      if (next !== "\n") word = (word ?? "") + (next ?? "");
      i++;
    } else if (c === "'") {
      const close = line.indexOf("'", i + 1);
      const stop = close < 0 ? line.length : close;
      word = (word ?? "") + line.slice(i + 1, stop);
      i = stop;
    } else if (c === '"') {
      word ??= "";
      for (i++; i < line.length && line[i] !== '"'; i++) {
        if (line[i] === "\\" && '"\\$`'.includes(line[i + 1] ?? "")) i++;
        word += line[i];
      }
    } else if (c === "#" && word === undefined) {
      const end = line.indexOf("\n", i);
      i = (end < 0 ? line.length : end) - 1;
    } else if (c === " " || c === "\t" || c === "(" || c === ")") {
      finish();
    } else if (c === "\n") {
      op(";");
      let start = i + 1;
      for (const doc of heredocs.splice(0)) {
        while (start < line.length) {
          const end = line.indexOf("\n", start);
          const stop = end < 0 ? line.length : end;
          const text = line.slice(start, stop);
          start = stop + 1;
          if ((doc.tabs ? text.replace(/^\t+/, "") : text) === doc.end) break;
        }
      }
      i = start - 1;
    } else if (c === "<" && next === "<" && line[i + 2] !== "<") {
      let j = i + 2;
      const tabs = line[j] === "-";
      if (tabs) j++;
      while (line[j] === " " || line[j] === "\t") j++;
      let end = "";
      for (; j < line.length && !/[\s;&|<>()]/.test(line[j]); j++)
        if (!"'\"\\".includes(line[j])) end += line[j];
      heredocs.push({ end, tabs });
      finish();
      i = j - 1;
    } else if (c === "|" && line[i - 1] !== ">") {
      if (next === "|") op("||");
      else op("|");
      if (next === "|" || next === "&") i++;
    } else if (
      c === "&" &&
      next !== ">" &&
      line[i - 1] !== ">" &&
      line[i - 1] !== "<"
    ) {
      if (next === "&") {
        op("&&");
        i++;
      } else op("&");
    } else if (c === ";") {
      op(";");
    } else {
      word = (word ?? "") + c;
    }
  }
  finish();
  return out;
}

/**
 * True when the line can exit 0 although a command in it failed, so a
 * success says nothing about a test it ran. A shell's -c script
 * (`bash -lc '...'`, how Codex reports commands) is read the same way.
 * Shapes this reading does not know lean towards true: the cost is a
 * result shown as unverified, not a pass nobody saw.
 */
export function exitStatusCanHideFailure(line: string, depth = 0): boolean {
  // Items are what `;`, a newline or `&` separate; each holds commands joined by |, || or &&.
  const items: { commands: string[][]; ops: string[] }[] = [];
  let item = { commands: [[]] as string[][], ops: [] as string[] };
  let background = false;
  for (const token of tokens(line)) {
    if ("word" in token) item.commands[item.commands.length - 1].push(token.word);
    else if (token.op === ";" || token.op === "&") {
      if (token.op === "&") background = true;
      items.push(item);
      item = { commands: [[]], ops: [] };
    } else {
      item.ops.push(token.op);
      item.commands.push([]);
    }
  }
  items.push(item);
  const used = items.filter((entry) => entry.commands.some((words) => words.length));
  const commands = used.flatMap((entry) => entry.commands);
  const pipefail = commands.some(
    ([name, ...words]) =>
      (name === "set" &&
        words.includes("pipefail") &&
        words.some((word) => /^-[A-Za-z]*o$/.test(word))) ||
      (name === "setopt" && words.some((word) => /^pipe_?fail$/i.test(word))),
  );
  const ops = used.flatMap((entry) => entry.ops);
  const hiddenEarlier = used.slice(0, -1).some(
    ({ commands: [first, ...rest] }) =>
      rest.length > 0 ||
      !(setup.test(first[0] ?? "") || first.every((word) => assignment.test(word))),
  );
  const script = (words: string[]) => {
    const flag = words.findIndex((word, index) => index > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(word));
    return shell.test(words[0] ?? "") && flag > 0 ? words[flag + 1] : undefined;
  };
  return (
    background ||
    ops.includes("||") ||
    (ops.includes("|") && !pipefail) ||
    hiddenEarlier ||
    (depth < 3 &&
      commands.some((words) => {
        const inner = script(words);
        return inner !== undefined && exitStatusCanHideFailure(inner, depth + 1);
      }))
  );
}
