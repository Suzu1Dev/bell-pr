import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PasswordlessSudo, type SudoRunner } from "./sudo.js";
import { AppError } from "./types.js";

const correct = "test-only-password";
const user = "bellsvc";
const minute = 60_000;
const ok = { stdout: "", stderr: "", code: 0 };
const denied = (stderr: string) => ({ stdout: "", stderr, code: 1 });
const passwordRequired = denied("sudo: a password is required\n");
const wrongPassword = denied("sudo: Authentication failed, try again.\n");

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
  clock: number;
  calls: Call[];
  /** The rule text visudo was asked to check. */
  checked?: string;
}

type Setup = Partial<
  Pick<Machine, "passwordless" | "otherRule" | "overridden" | "inSudoers" | "visudoRejects">
>;

/** Simulates sudo, visudo, install and rm inside a temp directory; the real /etc is never touched. */
async function withMachine(
  setup: Setup,
  body: (machine: Machine, sudo: PasswordlessSudo, file: string) => Promise<void>,
  serviceUser = user,
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bell-sudo-test-"));
  const file = path.join(dir, "bell-pr-agent");
  const machine: Machine = {
    passwordless: false,
    otherRule: false,
    overridden: false,
    inSudoers: true,
    visudoRejects: false,
    clock: 0,
    calls: [],
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
      await rm(file, { force: true });
      machine.passwordless = machine.otherRule;
      return ok;
    }
    if (!machine.inSudoers)
      return denied(`${serviceUser} is not in the sudoers file.  This incident will be reported.\n`);
    if (options.input !== `${correct}\n`) return wrongPassword;
    const command = args.slice(args.indexOf("--") + 1);
    if (command[0] === "install") {
      await copyFile(command[command.length - 2], command[command.length - 1]);
      machine.passwordless = !machine.overridden;
      return ok;
    }
    if (command[0] === "rm") {
      await rm(command[command.length - 1], { force: true });
      machine.passwordless = machine.otherRule;
      return ok;
    }
    throw new Error(`unexpected sudo command ${command.join(" ")}`);
  };
  const sudo = new PasswordlessSudo({
    run,
    now: () => machine.clock,
    user: serviceUser,
    file,
  });
  try {
    await body(machine, sudo, file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("status reports passwordless sudo only while sudo needs no password", async () => {
  await withMachine({ passwordless: false }, async (machine, sudo) => {
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
  await withMachine({}, async (machine, sudo, file) => {
    const status = await sudo.enable(correct);
    assert.match(machine.checked ?? "", /^bellsvc ALL=\(ALL\) NOPASSWD: ALL$/m);
    assert.equal(await readFile(file, "utf8"), machine.checked);
    assert.deepEqual(status, {
      user,
      available: true,
      installed: true,
      passwordless: true,
    });
  });
});

test("the password reaches sudo only on stdin, never in arguments or environment", async () => {
  await withMachine({}, async (machine, sudo) => {
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
  await withMachine({ visudoRejects: true }, async (machine, sudo, file) => {
    await assert.rejects(sudo.enable(correct), { statusCode: 500 });
    assert.equal(machine.calls.some((call) => call.executable === "sudo"), false);
    assert.equal(existsSync(file), false);
  });
});

test("three wrong passwords lock setup for 15 minutes, and a locked attempt never reaches sudo", async () => {
  await withMachine({}, async (machine, sudo) => {
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
  await withMachine({ inSudoers: false }, async (_machine, sudo, file) => {
    await assert.rejects(sudo.enable(correct), { statusCode: 403 });
    assert.equal(existsSync(file), false);
  });
});

test("an install that another sudoers rule overrides is rolled back", async () => {
  await withMachine({ overridden: true }, async (_machine, sudo, file) => {
    await assert.rejects(sudo.enable(correct), { statusCode: 409 });
    assert.equal(existsSync(file), false);
    assert.equal((await sudo.status()).installed, false);
  });
});

test("disable removes BELL's rule and reports honestly when another rule still allows sudo", async () => {
  await withMachine({ otherRule: true }, async (_machine, sudo) => {
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
  await withMachine({}, async (_machine, sudo) => {
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
  await withMachine({ passwordless: false }, async (_machine, sudo) => {
    await assert.rejects(sudo.disable(), {
      statusCode: 409,
      message: /sudo rm /,
    });
  });
});

test("an account name that cannot be written safely is refused before any privileged call", async () => {
  await withMachine(
    {},
    async (machine, sudo) => {
      await assert.rejects(sudo.enable(correct), { statusCode: 422 });
      assert.equal(machine.calls.length, 0);
    },
    "Bad User",
  );
});
