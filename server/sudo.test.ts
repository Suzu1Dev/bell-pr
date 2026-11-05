import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bellSudoersFile, sudoersExpiryPrefix } from "../shared/sudo.js";
import { PasswordlessSudo, type SudoRunner } from "./sudo.js";
import { deniedPerMinute, SudoAudit, type SudoAuditEntry } from "./sudo-audit.js";
import { AppError } from "./types.js";

const correct = "test-only-password";
const user = "bellsvc";
const minute = 60_000;
const ok = { stdout: "", stderr: "", code: 0 };
const denied = (stderr: string) => ({ stdout: "", stderr, code: 1 });
const passwordRequired = denied("sudo: a password is required\n");
const wrongPassword = denied("sudo: Authentication failed, try again.\n");
/** A fixed start time, so expiry times are exact. */
const start = Date.parse("2026-11-04T10:00:00.000Z");

interface Call {
  executable: string;
  args: string[];
  input?: string;
  env?: NodeJS.ProcessEnv;
}

interface Machine {
  /** What `sudo -n` allows right now. */
  passwordless: boolean;
  /** Another sudoers file already grants passwordless sudo. */
  otherRule: boolean;
  /** A later sudoers rule overrides BELL's rule, so sudo still asks for a password after install. */
  overridden: boolean;
  inSudoers: boolean;
  visudoRejects: boolean;
  /** visudo as root rejects the copy staged next to the rule file. */
  stagedRejects: boolean;
  /** `sudo -n rm` reports success but leaves the file. */
  rmKeepsFile: boolean;
  clock: number;
  calls: Call[];
  /** The rule text visudo was asked to check. */
  checked?: string;
  /** Scheduled removals: when they run, and the callback. */
  timers: { at: number; run: () => unknown; cancelled: boolean }[];
}

type Setup = Partial<
  Pick<
    Machine,
    "passwordless" | "otherRule" | "overridden" | "inSudoers" | "visudoRejects" | "stagedRejects" | "rmKeepsFile"
  >
>;

interface Rig {
  machine: Machine;
  sudo: PasswordlessSudo;
  file: string;
  auditFile: string;
  /** Moves the clock and runs the removals due by then. */
  advance: (ms: number) => Promise<void>;
  entries: () => Promise<SudoAuditEntry[]>;
}

/** Simulates sudo, visudo, install, mv and rm inside a temp directory; the real /etc is never touched. */
async function withMachine(setup: Setup, body: (rig: Rig) => Promise<void>, serviceUser = user) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bell-sudo-test-"));
  const file = path.join(dir, "bell-pr-agent");
  const auditFile = path.join(dir, "data", "audit", "sudo.jsonl");
  const machine: Machine = {
    passwordless: false,
    otherRule: false,
    overridden: false,
    inSudoers: true,
    visudoRejects: false,
    stagedRejects: false,
    rmKeepsFile: false,
    clock: start,
    calls: [],
    timers: [],
    ...setup,
  };
  const run: SudoRunner = async (executable, args, options = {}) => {
    machine.calls.push({ executable, args, input: options.input, env: options.env });
    if (executable === "visudo") {
      machine.checked = await readFile(args[args.length - 1], "utf8");
      return machine.visudoRejects ? denied("visudo: invalid sudoers file\n") : ok;
    }
    if (executable !== "sudo") throw new Error(`unexpected executable ${executable}`);
    if (args[0] === "-k" && args[1] === "-n" && args[2] === "true")
      return machine.passwordless ? ok : passwordRequired;
    if (args[0] === "-k" && args[1] === "-n" && args[2] === "rm") {
      if (!machine.passwordless) return passwordRequired;
      if (!machine.rmKeepsFile) await rm(file, { force: true });
      machine.passwordless = machine.otherRule;
      return ok;
    }
    if (!machine.inSudoers)
      return denied(`${serviceUser} is not in the sudoers file.  This incident will be reported.\n`);
    if (options.input !== `${correct}\n`) return wrongPassword;
    const command = args.slice(args.indexOf("--") + 1);
    const last = command[command.length - 1];
    if (command[0] === "install") {
      await copyFile(command[command.length - 2], last);
      return ok;
    }
    if (command[0] === "visudo") return machine.stagedRejects ? denied("parse error\n") : ok;
    if (command[0] === "mv") {
      await rename(command[command.length - 2], last);
      machine.passwordless = !machine.overridden;
      return ok;
    }
    if (command[0] === "rm") {
      await rm(last, { force: true });
      if (last === file) machine.passwordless = machine.otherRule;
      return ok;
    }
    throw new Error(`unexpected sudo command ${command.join(" ")}`);
  };
  const schedule = (callback: () => unknown, ms: number) => {
    const timer = { at: machine.clock + ms, run: callback, cancelled: false };
    machine.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  const now = () => machine.clock;
  const audit = new SudoAudit(auditFile, now, schedule);
  const sudo = new PasswordlessSudo({ run, now, user: serviceUser, group: "1000", file, audit, schedule });
  const advance = async (ms: number) => {
    machine.clock += ms;
    for (const timer of machine.timers)
      if (!timer.cancelled && timer.at <= machine.clock) {
        timer.cancelled = true;
        await timer.run();
      }
    await audit.settled();
  };
  const entries = async () => {
    await audit.settled();
    if (!existsSync(auditFile)) return [];
    return (await readFile(auditFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as SudoAuditEntry);
  };
  try {
    await body({ machine, sudo, file, auditFile, advance, entries });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("status reports passwordless sudo only while sudo needs no password", async () => {
  await withMachine({ passwordless: false }, async ({ machine, sudo }) => {
    assert.deepEqual(await sudo.status(), {
      user,
      available: true,
      installed: false,
      passwordless: false,
    });
    machine.passwordless = true;
    assert.equal((await sudo.status()).passwordless, true);
  });
});

test("status reports sudo as unavailable when the command cannot start", async () => {
  const sudo = new PasswordlessSudo({
    run: async () => {
      throw new AppError("sudo 無法啟動：spawn ENOENT", 503);
    },
    user,
    file: path.join(os.tmpdir(), "bell-sudo-test-missing-rule"),
  });
  assert.deepEqual(await sudo.status(), {
    user,
    available: false,
    installed: false,
    passwordless: false,
  });
});

test("enable installs a NOPASSWD rule for the service account only, the same file visudo checked", async () => {
  await withMachine({}, async ({ machine, sudo, file }) => {
    const status = await sudo.enable(correct);
    assert.match(machine.checked ?? "", /^bellsvc ALL=\(ALL\) NOPASSWD: ALL$/m);
    assert.equal(await readFile(file, "utf8"), machine.checked);
    assert.deepEqual(status, {
      user,
      available: true,
      installed: true,
      passwordless: true,
      expiresAt: "2026-11-04T11:00:00.000Z",
    });
    // Staged next to the rule file as root:<group> 0440, checked there, then renamed over it.
    const staged = path.join(path.dirname(file), ".bell-pr-agent.tmp");
    const privileged = machine.calls
      .filter((call) => call.args[0] === "-S")
      .map((call) => call.args.slice(call.args.indexOf("--") + 1));
    assert.deepEqual(privileged, [
      ["install", "-m", "0440", "-o", "root", "-g", "1000", privileged[0][7], staged],
      ["visudo", "-c", "-f", staged],
      ["mv", "-f", "--", staged, file],
    ]);
    assert.equal(existsSync(staged), false);
  });
});

test("the password reaches sudo only on stdin, never in arguments or environment", async () => {
  await withMachine({}, async ({ machine, sudo }) => {
    await sudo.enable(correct);
    const authenticated = machine.calls.filter(
      (call) => call.executable === "sudo" && call.args[0] === "-S",
    );
    assert.ok(authenticated.length > 0);
    assert.equal(authenticated[0].input, `${correct}\n`);
    for (const call of machine.calls) {
      assert.equal(call.args.join(" ").includes(correct), false);
      assert.equal(JSON.stringify(call.env ?? {}).includes(correct), false);
    }
  });
});

test("a rule visudo rejects is never installed", async () => {
  await withMachine({ visudoRejects: true }, async ({ machine, sudo, file }) => {
    await assert.rejects(sudo.enable(correct), { statusCode: 500 });
    assert.equal(machine.calls.some((call) => call.executable === "sudo"), false);
    assert.equal(existsSync(file), false);
  });
});

test("three wrong passwords lock setup for 15 minutes, and a locked attempt never reaches sudo", async () => {
  await withMachine({}, async ({ machine, sudo }) => {
    await assert.rejects(sudo.enable("wrong-1"), { statusCode: 401 });
    await assert.rejects(sudo.enable("wrong-2"), { statusCode: 401 });
    await assert.rejects(sudo.enable("wrong-3"), { statusCode: 429 });
    const callsBeforeLocked = machine.calls.length;
    await assert.rejects(sudo.enable(correct), { statusCode: 429 });
    assert.equal(machine.calls.length, callsBeforeLocked);
    machine.clock += 15 * minute;
    assert.equal((await sudo.enable(correct)).passwordless, true);
  });
});

test("a user outside the sudo group gets 403 and no rule is written", async () => {
  await withMachine({ inSudoers: false }, async ({ sudo, file }) => {
    await assert.rejects(sudo.enable(correct), { statusCode: 403 });
    assert.equal(existsSync(file), false);
  });
});

test("an install that another sudoers rule overrides is rolled back", async () => {
  await withMachine({ overridden: true }, async ({ sudo, file }) => {
    await assert.rejects(sudo.enable(correct), { statusCode: 409 });
    assert.equal(existsSync(file), false);
    assert.equal((await sudo.status()).installed, false);
  });
});

test("disable removes BELL's rule and reports honestly when another rule still allows sudo", async () => {
  await withMachine({ otherRule: true }, async ({ sudo }) => {
    await sudo.enable(correct);
    assert.deepEqual(await sudo.disable(), {
      user,
      available: true,
      installed: false,
      passwordless: true,
    });
  });
});

test("disable without another rule makes sudo ask for a password again", async () => {
  await withMachine({}, async ({ sudo }) => {
    await sudo.enable(correct);
    assert.deepEqual(await sudo.disable(), {
      user,
      available: true,
      installed: false,
      passwordless: false,
    });
  });
});

test("disable tells the person to remove the file in a terminal when sudo needs a password", async () => {
  await withMachine({ passwordless: false }, async ({ sudo, file }) => {
    await writeFile(file, "bellsvc ALL=(ALL) NOPASSWD: ALL\n");
    await assert.rejects(sudo.disable(), {
      statusCode: 409,
      message: /sudo rm /,
    });
  });
});

test("an account name that cannot be written safely is refused before any privileged call", async () => {
  await withMachine(
    {},
    async ({ machine, sudo }) => {
      await assert.rejects(sudo.enable(correct), { statusCode: 422 });
      assert.equal(machine.calls.length, 0);
    },
    "Bad User",
  );
});

test("the rule records its expiry in UTC; one hour by default, eight hours at most, never permanent", async () => {
  await withMachine({}, async ({ sudo, file }) => {
    await sudo.enable(correct);
    assert.match(await readFile(file, "utf8"), new RegExp(`^${sudoersExpiryPrefix}2026-11-04T11:00:00\\.000Z$`, "m"));
    await sudo.disable();
    assert.equal((await sudo.enable(correct, 28_800)).expiresAt, "2026-11-04T18:00:00.000Z");
    await sudo.disable();
    assert.equal((await sudo.enable(correct, 60)).expiresAt, "2026-11-04T10:01:00.000Z");
    await sudo.disable();
    for (const ttl of [0, -60, 59, 28_801, 90.5, Infinity, Number.NaN])
      await assert.rejects(sudo.enable(correct, ttl), { name: "ZodError" }, String(ttl));
    assert.equal(existsSync(file), false);
  });
});

test("a staged copy that visudo rejects as root is removed and nothing is installed", async () => {
  await withMachine({ stagedRejects: true }, async ({ sudo, file, entries }) => {
    await assert.rejects(sudo.enable(correct), { statusCode: 500 });
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(path.join(path.dirname(file), ".bell-pr-agent.tmp")), false);
    const [entry] = await entries();
    assert.equal(entry.event, "enable");
    assert.equal(entry.ok, false);
    assert.equal(entry.reason, "invalid_rule");
  });
});

test("the rule is removed when its time is up", async () => {
  await withMachine({}, async ({ machine, sudo, file, advance, entries }) => {
    await sudo.enable(correct, 120);
    await advance(119_000);
    assert.equal(existsSync(file), true);
    await advance(1_000);
    assert.equal(existsSync(file), false);
    assert.equal(machine.passwordless, false);
    const expired = (await entries()).find((entry) => entry.event === "expire");
    assert.deepEqual(expired && { ok: expired.ok, expiresAt: expired.expiresAt }, {
      ok: true,
      expiresAt: "2026-11-04T10:02:00.000Z",
    });
  });
});

test("enabling again while the rule is on is refused and keeps its expiry, and disabling cancels it", async () => {
  await withMachine({}, async ({ machine, sudo, file, advance, entries }) => {
    await sudo.enable(correct, 60);
    const calls = machine.calls.length;
    await assert.rejects(sudo.enable(correct, 28_800), { statusCode: 409 });
    // Only visudo on the new copy and the read-only `sudo -n true` check ran; nothing was sent a password.
    assert.deepEqual(
      machine.calls.slice(calls).map((call) => [call.executable, call.args[0], call.input]),
      [["visudo", "-cf", undefined], ["sudo", "-k", undefined]],
    );
    assert.match(await readFile(file, "utf8"), /2026-11-04T10:01:00\.000Z/);
    await advance(30_000);
    await sudo.disable();
    await advance(120_000);
    assert.equal(existsSync(file), false);
    assert.deepEqual(
      (await entries()).map((entry) => [entry.event, entry.ok, entry.reason]),
      [["enable", true, null], ["enable", false, "already_on"], ["disable", true, null]],
    );
  });
});

test("enable is refused before any password is sent while another rule already allows sudo", async () => {
  await withMachine({ passwordless: true, otherRule: true }, async ({ machine, sudo, file }) => {
    await assert.rejects(sudo.enable("any-other-text"), { statusCode: 409 });
    assert.equal(existsSync(file), false);
    assert.equal(machine.calls.some((call) => call.input !== undefined), false);
  });
});

test("at startup an expired rule, or one without a valid expiry, is removed and recorded", async () => {
  for (const [text, reason] of [
    [`${sudoersExpiryPrefix}2026-11-04T09:59:00.000Z\nbellsvc ALL=(ALL) NOPASSWD: ALL\n`, "expired"],
    ["bellsvc ALL=(ALL) NOPASSWD: ALL\n", "invalid"],
    [`${sudoersExpiryPrefix}tomorrow\nbellsvc ALL=(ALL) NOPASSWD: ALL\n`, "invalid"],
    [`${sudoersExpiryPrefix}2026-11-05T10:00:00.000Z\nbellsvc ALL=(ALL) NOPASSWD: ALL\n`, "invalid"],
  ]) {
    await withMachine({ passwordless: true }, async ({ sudo, file, entries }) => {
      await writeFile(file, text);
      await sudo.cleanUpAtStartup();
      assert.equal(existsSync(file), false, reason);
      const [entry] = await entries();
      assert.equal(entry.event, "startup_cleanup");
      assert.equal(entry.ok, true);
      assert.equal(entry.reason, reason);
    });
  }
});

test("at startup a rule still in time is kept and removed when it expires", async () => {
  await withMachine({ passwordless: true }, async ({ sudo, file, advance, entries }) => {
    await writeFile(file, `${sudoersExpiryPrefix}2026-11-04T10:01:30.000Z\nbellsvc ALL=(ALL) NOPASSWD: ALL\n`);
    await sudo.cleanUpAtStartup();
    assert.equal(existsSync(file), true);
    assert.deepEqual(await entries(), []);
    await advance(90_000);
    assert.equal(existsSync(file), false);
    assert.deepEqual((await entries()).map((entry) => [entry.event, entry.ok]), [["expire", true]]);
  });
});

test("a startup removal that fails is recorded, and nothing happens without a rule file", async () => {
  await withMachine({ passwordless: false }, async ({ sudo, file, entries }) => {
    await sudo.cleanUpAtStartup();
    assert.deepEqual(await entries(), []);
    await writeFile(file, `${sudoersExpiryPrefix}2026-11-04T09:00:00.000Z\nbellsvc ALL=(ALL) NOPASSWD: ALL\n`);
    await sudo.cleanUpAtStartup();
    assert.equal(existsSync(file), true);
    const [entry] = await entries();
    assert.equal(entry.event, "startup_cleanup");
    assert.equal(entry.ok, false);
    assert.equal(entry.reason, "remove_failed");
    assert.equal(entry.expiresAt, "2026-11-04T09:00:00.000Z");
  });
});

test("disable checks that the file is gone and reports a removal that left it", async () => {
  await withMachine({ rmKeepsFile: true }, async ({ sudo, file, entries }) => {
    await sudo.enable(correct);
    await assert.rejects(sudo.disable(), { statusCode: 409, message: /sudo rm / });
    assert.equal(existsSync(file), true);
    const disable = (await entries()).find((entry) => entry.event === "disable");
    assert.equal(disable?.ok, false);
    assert.equal(disable?.reason, "remove_failed");
  });
});

test("an environment variable cannot move the rule file", () => {
  const saved = { ...process.env };
  try {
    for (const name of ["BELLPR_SUDOERS_FILE", "BELLPR_SUDOERS_PATH", "BELL_SUDOERS_FILE", "SUDOERS_FILE"])
      process.env[name] = path.join(os.tmpdir(), "elsewhere");
    assert.equal(new PasswordlessSudo({ user }).path, bellSudoersFile);
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
  }
});

test("audit lines have the same keys for every event and never contain the password", async () => {
  await withMachine({}, async ({ machine, sudo, file, auditFile, advance, entries }) => {
    const context = { remoteAddr: "127.0.0.1", host: "localhost:4311", tokenType: "host" as const };
    await assert.rejects(sudo.enable("wrong-password-value", 60, context), { statusCode: 401 });
    await sudo.enable(correct, 60, context);
    await sudo.disable(context);
    await sudo.enable(correct, 60, context);
    await advance(60_000);
    await sudo.audit.denied({ remoteAddr: "192.0.2.10", host: ["bell", "example", "ts", "net"].join("."), tokenType: "device" }, "device_token");
    machine.passwordless = true;
    await writeFile(file, `${sudoersExpiryPrefix}2026-11-04T09:00:00.000Z\nbellsvc ALL=(ALL) NOPASSWD: ALL\n`);
    await sudo.cleanUpAtStartup();
    const list = await entries();
    assert.deepEqual(
      [...new Set(list.map((entry) => entry.event))].sort(),
      ["denied", "disable", "enable", "expire", "startup_cleanup"],
    );
    const keys = ["ts", "event", "ok", "reason", "remoteAddr", "host", "tokenType", "ttlSeconds", "expiresAt"];
    for (const entry of list) {
      assert.deepEqual(Object.keys(entry), keys, entry.event);
      assert.match(entry.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.equal(typeof entry.ok, "boolean");
    }
    assert.deepEqual(list[1], {
      ts: "2026-11-04T10:00:00.000Z",
      event: "enable",
      ok: true,
      reason: null,
      remoteAddr: "127.0.0.1",
      host: "localhost:4311",
      tokenType: "host",
      ttlSeconds: 60,
      expiresAt: "2026-11-04T10:01:00.000Z",
    });
    const text = await readFile(auditFile, "utf8");
    assert.equal(text.includes(correct), false);
    assert.equal(text.includes("wrong-password-value"), false);
  });
});

test("denied requests are written at most ten a minute, then counted in one line", async () => {
  await withMachine({}, async ({ sudo, advance, entries }) => {
    const context = { remoteAddr: "198.51.100.7", host: "localhost", tokenType: "none" as const };
    for (let request = 0; request < 50; request++) await sudo.audit.denied(context, "no_host_token");
    assert.equal((await entries()).length, deniedPerMinute);
    await advance(60_000);
    const list = await entries();
    assert.equal(list.length, deniedPerMinute + 1);
    assert.deepEqual(
      { ...list[deniedPerMinute], ts: undefined },
      {
        ts: undefined,
        event: "denied",
        ok: false,
        reason: "suppressed:40",
        remoteAddr: null,
        host: null,
        tokenType: null,
        ttlSeconds: null,
        expiresAt: null,
      },
    );
    // A new minute writes again.
    await sudo.audit.denied(context, "no_host_token");
    assert.equal((await entries()).length, deniedPerMinute + 2);
  });
});
