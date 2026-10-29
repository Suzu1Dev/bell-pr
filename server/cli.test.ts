import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { doctorCheckIds, type DoctorReport } from "../shared/doctor.js";
import { version } from "./build-info.js";
import { canOpenBrowser, main, type CliDeps } from "./cli.js";
import { resolveConfig } from "./config.js";
import { withLocale } from "./i18n/index.js";
import { startServer, type RunningServer } from "./index.js";

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function output() {
  let text = "";
  return {
    stream: { write: (chunk: string) => (text += chunk), isTTY: false },
    text: () => text,
  };
}

/** Runs the CLI in English with captured output and a clean environment. */
async function cli(argv: string[], deps: CliDeps = {}) {
  const stdout = output();
  const stderr = output();
  const opened: string[] = [];
  const code = await withLocale("en", () =>
    main(argv, {
      env: { BELLPR_NO_OPEN: "1" },
      stdout: stdout.stream,
      stderr: stderr.stream,
      openUrl: (url) => opened.push(url),
      ...deps,
    }),
  );
  return { code, stdout: stdout.text(), stderr: stderr.text(), opened };
}

async function withDataDir<T>(fn: (dataDir: string, directory: string) => Promise<T>) {
  const directory = await mkdtemp(path.join(tmpdir(), "bell-pr-cli-"));
  const ui = path.join(directory, "ui");
  mkdirSync(ui);
  writeFileSync(path.join(ui, "index.html"), "<!doctype html>");
  try {
    return await fn(path.join(directory, "data"), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** A BELL PR running in this process, for `open` to find. */
async function inProcessServer(
  dataDir: string,
  host?: string,
  env: NodeJS.ProcessEnv = {},
): Promise<RunningServer> {
  return startServer({
    config: resolveConfig(
      { port: await freePort(), dataDir, host },
      { BELLPR_STATIC_DIR: path.join(path.dirname(dataDir), "ui"), ...env },
    ),
    handleExit: false,
    print: () => {},
  });
}

test("bell-pr open without a running instance exits 1 and says how to start", async () => {
  await withDataDir(async (dataDir) => {
    const result = await cli(["open", "--data-dir", dataDir]);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      `No BELL PR is running with the data directory ${dataDir}. Start it with \`bell-pr\`, or, for a BELL PR started with another data directory, run \`bell-pr open --data-dir <dir>\`.\n`,
    );

    // A lock left by a process that is gone, or one whose pid now runs
    // something that is not BELL PR, is not a running instance.
    mkdirSync(dataDir, { recursive: true });
    const gone = spawn(process.execPath, ["-e", ""]);
    await once(gone, "exit");
    for (const pid of [gone.pid!, process.pid]) {
      writeFileSync(
        path.join(dataDir, "bellpr.lock"),
        JSON.stringify({ pid, port: await freePort(), version: "1.0.0" }),
      );
      const stale = await cli(["open", "--data-dir", dataDir]);
      assert.equal(stale.code, 1);
      assert.match(stale.stderr, /No BELL PR is running with the data directory/);
    }
  });
});

test("bell-pr open never reports another instance's address through a stale lock whose pid was reused", { skip: process.platform === "win32" }, async () => {
  await withDataDir(async (dataDir, directory) => {
    // Another BELL PR, with its own data directory, now uses the port the
    // stale lock names, and the lock's pid belongs to another program.
    const other = await inProcessServer(path.join(directory, "other-data"));
    const stranger = spawn("sleep", ["30"], { stdio: "ignore" });
    try {
      await once(stranger, "spawn");
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(
        path.join(dataDir, "bellpr.lock"),
        JSON.stringify({ pid: stranger.pid, port: Number(new URL(other.url).port), version: "1.0.0" }),
      );
      const result = await cli(["open", "--data-dir", dataDir]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /No BELL PR is running with the data directory/);
      assert.equal(result.stdout, "");
    } finally {
      stranger.kill("SIGKILL");
      await other.shutdown();
    }
  });
});

test("bell-pr open prints the address of the running server and opens it where a browser is allowed", async () => {
  await withDataDir(async (dataDir) => {
    const server = await inProcessServer(dataDir);
    try {
      const printed = await cli(["open", "--data-dir", dataDir, "--print"]);
      assert.equal(printed.code, 0, printed.stderr);
      assert.equal(printed.stdout, `${server.url}\n`);
      assert.equal(printed.stderr, "");
      assert.deepEqual(printed.opened, []);

      // A terminal that allows it gets the browser.
      const second = await cli(["open", "--data-dir", dataDir], {
        env: {},
        stdout: { write: () => true, isTTY: true },
      });
      assert.equal(second.code, 0);
      if (!existsSync("/.dockerenv")) assert.deepEqual(second.opened, [server.url]);
    } finally {
      await server.shutdown();
    }
  });
});

test("bell-pr open prints the address browsers use: the public URL when BELL PR has one, else the local address", async () => {
  for (const [env, expected] of [
    // Behind a proxy, or listening on another address of this computer.
    [{ BELLPR_PUBLIC_URL: "https://bell.example.com" }, "https://bell.example.com"],
    // Docker: published on another port than the one BELL PR listens on.
    [{ BELLPR_PUBLIC_URL: "http://localhost:8080" }, "http://localhost:8080"],
    [{}, undefined],
  ] as const) {
    await withDataDir(async (dataDir) => {
      const server = await inProcessServer(dataDir, undefined, env);
      try {
        const result = await cli(["open", "--data-dir", dataDir, "--print"]);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(result.stdout, `${expected ?? server.url}\n`);
        assert.equal(JSON.parse(readFileSync(path.join(dataDir, "bellpr.lock"), "utf8")).url, server.url);
      } finally {
        await server.shutdown();
      }
    });
  }
});

test("bell-pr open falls back to the local address for a lock without a usable web address", async () => {
  await withDataDir(async (dataDir) => {
    const server = await inProcessServer(dataDir, undefined, {
      BELLPR_PUBLIC_URL: "https://bell.example.com",
    });
    try {
      const lockFile = path.join(dataDir, "bellpr.lock");
      const lock = JSON.parse(readFileSync(lockFile, "utf8"));
      // A lock from an older build has no url; the others are not addresses a browser should be sent to.
      for (const url of [undefined, "file:///etc/hosts", "not a url", 42]) {
        writeFileSync(lockFile, JSON.stringify({ ...lock, url }));
        const result = await cli(["open", "--data-dir", dataDir, "--print"]);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(result.stdout, `http://127.0.0.1:${lock.port}\n`, String(url));
      }
    } finally {
      await server.shutdown();
    }
  });
});

test(
  "bell-pr start opens the address it prints",
  {
    skip:
      process.platform === "win32" ||
      existsSync("/.dockerenv") ||
      existsSync("/run/.containerenv"),
  },
  async () => {
    await withDataDir(async (dataDir, directory) => {
      // Stand-ins for open (macOS) and xdg-open that record their arguments.
      // The file appears whole, through a rename, so the wait below never
      // reads it half written.
      const bin = path.join(directory, "bin");
      const argvFile = path.join(directory, "opener-argv");
      mkdirSync(bin);
      for (const name of ["open", "xdg-open"])
        writeFileSync(
          path.join(bin, name),
          `#!/bin/sh\nprintf '%s\\n' "$@" > '${argvFile}.tmp' && mv '${argvFile}.tmp' '${argvFile}'\n`,
          { mode: 0o755 },
        );
      const previousPath = process.env.PATH;
      process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
      const port = await freePort();
      let running: RunningServer | undefined;
      let printed = "";
      try {
        const code = await withLocale("en", () =>
          main(["start", "--force", "--port", String(port), "--data-dir", dataDir], {
            env: { BELLPR_STATIC_DIR: path.join(directory, "ui") },
            stdout: { write: (text: string) => (printed += text), isTTY: true },
            startOptions: { handleExit: false },
            onStarted: (server) => (running = server),
          }),
        );
        assert.equal(code, undefined);
        assert.ok(running);
        const deadline = Date.now() + 5000;
        while (!existsSync(argvFile) && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 25));
        const argv = readFileSync(argvFile, "utf8").trimEnd().split("\n");
        assert.deepEqual(argv, [running.url]);
        assert.ok(printed.includes(`→ ${running.url}\n`), printed);
      } finally {
        process.env.PATH = previousPath;
        await running?.shutdown();
      }
    });
  },
);

test("bell-pr open reaches a server that listens on ::1 only", async (t) => {
  const probe = createServer();
  try {
    probe.listen(0, "::1");
    await once(probe, "listening");
  } catch {
    t.skip("this machine has no IPv6 loopback");
    return;
  } finally {
    probe.close();
  }
  await withDataDir(async (dataDir) => {
    const server = await inProcessServer(dataDir, "::1");
    try {
      // The printed address is the one the server listens on.
      assert.match(server.url, /^http:\/\/\[::1\]:\d+$/);
      const result = await cli(["open", "--data-dir", dataDir, "--print"]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, `${server.url}\n`);
    } finally {
      await server.shutdown();
    }
  });
});

test("bell-pr version prints the version, Node.js, the platform and the data directory", async () => {
  await withDataDir(async (dataDir) => {
    for (const argv of [["version"], ["--version"], ["-v"]]) {
      const result = await cli([...argv, "--data-dir", dataDir]);
      assert.equal(result.code, 0);
      const lines = result.stdout.trimEnd().split("\n");
      assert.ok(lines[0].startsWith(`BELL PR ${version} (built `), lines[0]);
      assert.match(lines[0], /\(built \d{4}-\d{2}-\d{2}\)$/);
      assert.equal(lines[1], `Node.js ${process.version} on ${process.platform} ${process.arch}`);
      assert.equal(lines[2], `Data directory: ${dataDir}`);
    }
    // Printing the version never creates the data directory.
    assert.equal(existsSync(dataDir), false);
  });
  const fromEnv = await cli(["version"], { env: { BELLPR_DATA_DIR: "/srv/bell-data" } });
  assert.match(fromEnv.stdout, /Data directory: \/srv\/bell-data/);
});

test("bell-pr help lists every command, and mistakes exit 2", async () => {
  for (const argv of [["help"], ["--help"], ["-h"]]) {
    const result = await cli(argv);
    assert.equal(result.code, 0);
    for (const command of ["start", "open", "doctor", "version", "help"])
      assert.match(result.stdout, new RegExp(`^  ${command} `, "m"));
    for (const option of ["--port", "--host", "--data-dir", "--no-open", "--force", "--env-file", "--print"])
      assert.ok(result.stdout.includes(option), option);
  }
  let zhText = "";
  const zh = await withLocale("zh-TW", () =>
    main(["help"], { stdout: { write: (text: string) => (zhText += text) } }),
  );
  assert.equal(zh, 0);
  assert.match(zhText, /用法：bell-pr/);
  assert.match(zhText, /^ {2}open /m);

  const unknown = await cli(["frobnicate"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Unknown command "frobnicate"/);
  const badOption = await cli(["open", "--frob"]);
  assert.equal(badOption.code, 2);
  assert.match(badOption.stderr, /--frob/);
  assert.match(badOption.stderr, /bell-pr help/);
  const badPort = await cli(["start", "--port", "80"]);
  assert.equal(badPort.code, 1);
  assert.match(badPort.stderr, /--port must be a whole number from 1024 to 65535/);
});

test("every command shows the help for --help, and argument mistakes read in the CLI's language", async () => {
  for (const argv of [
    ["start", "--help"],
    ["open", "-h"],
    ["version", "--help"],
    ["--port", "4400", "--help"],
  ]) {
    const result = await cli(argv);
    assert.equal(result.code, 0, argv.join(" "));
    assert.match(result.stdout, /^Usage: bell-pr /m);
    assert.equal(result.stderr, "");
  }
  for (const [argv, reason] of [
    [["open", "--frob"], "Unknown option --frob."],
    [["start", "--port"], "The option --port needs a value."],
    [["doctor", "--json", "--data-dir"], "The option --data-dir needs a value."],
    [["doctor", "--json", "--env-file"], "The option --env-file needs a value."],
    [["open", "--print=yes"], "The option --print does not take a value."],
    [["open", "extra"], 'Unexpected argument "extra".'],
  ] as const) {
    const result = await cli([...argv]);
    assert.equal(result.code, 2, argv.join(" "));
    assert.equal(result.stderr, `${reason}\nRun \`bell-pr help\` for usage.\n`);
  }
  let zhError = "";
  const zh = await withLocale("zh-TW", () =>
    main(["start", "--bogus"], {
      env: { BELLPR_NO_OPEN: "1" },
      stderr: { write: (text: string) => (zhError += text) },
    }),
  );
  assert.equal(zh, 2);
  assert.equal(zhError, "沒有 --bogus 這個選項。\n執行 `bell-pr help` 查看用法。\n");
});

/**
 * Runs `fn` with only stand-in CLIs on PATH, so the doctor never reaches a
 * real git, gh, codex or claude. Each script answers its --version.
 */
async function withStandInClis<T>(
  scripts: Record<string, string>,
  fn: (directory: string) => Promise<T>,
) {
  return withDataDir(async (_dataDir, directory) => {
    const bin = path.join(directory, "bin");
    mkdirSync(bin);
    for (const [name, body] of Object.entries(scripts))
      writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o700 });
    const previous = process.env.PATH;
    process.env.PATH = bin;
    try {
      return await fn(directory);
    } finally {
      process.env.PATH = previous;
    }
  });
}

const standInGit = `for arg in "$@"; do
  case "$arg" in
    --version) echo "git version 2.45.1"; exit 0 ;;
    var) echo "Test User <test@example.com> 1760000000 +0000"; exit 0 ;;
    config) echo "test@example.com"; exit 0 ;;
  esac
done
exit 1`;

test("bell-pr doctor exits 1 when no provider is ready and prints the fix commands", async () => {
  await withStandInClis({ git: standInGit }, async (directory) => {
    const dataDir = path.join(directory, "data");
    const result = await cli(["doctor", "--data-dir", dataDir]);
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stdout, /^BELL PR environment check\n/);
    assert.match(result.stdout, /✓ Git +2\.45\.1/);
    assert.match(result.stdout, /✗ AI provider +Install and sign in to the Codex CLI or Claude Code/);
    for (const command of [
      "npm install -g @openai/codex",
      "codex login",
      "npm install -g @anthropic-ai/claude-code",
      "claude auth login",
    ])
      assert.ok(result.stdout.includes(`\n        ${command}\n`), command);
    assert.match(result.stdout, new RegExp(`Data directory: ${dataDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(result.stdout, /Not ready/);
    // Checking never creates the data directory.
    assert.equal(existsSync(dataDir), false);
  });
});

test("bell-pr doctor --json prints a DoctorReport, and a ready setup exits 0", async () => {
  const codex = `case "$1" in
  --version) echo "codex-cli 0.159.0" ;;
  login) echo "Logged in using ChatGPT" ;;
  *) exit 1 ;;
esac`;
  await withStandInClis({ git: standInGit, codex }, async (directory) => {
    const result = await cli(["doctor", "--json", "--data-dir", path.join(directory, "data")]);
    assert.equal(result.code, 0, result.stdout);
    const report = JSON.parse(result.stdout) as DoctorReport;
    assert.equal(report.ready, true);
    assert.equal(typeof report.checkedAt, "string");
    assert.equal(report.platform, process.platform);
    assert.deepEqual(
      report.checks.map((check) => check.id),
      [...doctorCheckIds],
    );
    const provider = report.checks.find((check) => check.id === "provider-ready");
    assert.deepEqual(
      { status: provider?.status, required: provider?.required, detail: provider?.detail },
      { status: "ok", required: true, detail: "Ready: Codex." },
    );
    assert.equal(
      report.checks.find((check) => check.id === "app")?.version,
      version,
    );
    const help = await cli(["doctor", "--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^Usage: bell-pr doctor \[--json\]/);
    const wrong = await cli(["doctor", "status"]);
    assert.equal(wrong.code, 2);
    assert.match(wrong.stdout, /Unknown argument "status"/);
  });
});

test("bell-pr doctor reports the port of the BELL PR running on the data directory, else the configured one", async () => {
  await withStandInClis({ git: standInGit }, async (directory) => {
    const dataDir = path.join(directory, "data");
    const appCheck = async (env: NodeJS.ProcessEnv = {}, json = true) => {
      const result = await cli(["doctor", ...(json ? ["--json"] : []), "--data-dir", dataDir], {
        env: { BELLPR_NO_OPEN: "1", ...env },
      });
      return json
        ? (JSON.parse(result.stdout) as DoctorReport).checks.find((check) => check.id === "app")
        : result.stdout;
    };
    const port = async (env?: NodeJS.ProcessEnv) =>
      ((await appCheck(env)) as DoctorReport["checks"][number]).params?.port;
    // Nothing runs: the port a start would take.
    assert.equal(await port(), 4311);
    assert.equal(await port({ BELLPR_PORT: "4400" }), 4400);
    assert.equal(await port({ BELLPR_PORT: "80" }), undefined);
    // Started with --port, which neither BELLPR_PORT nor the default names.
    const server = await inProcessServer(dataDir);
    try {
      const running = Number(new URL(server.url).port);
      assert.notEqual(running, 4311);
      assert.equal(await port(), running);
      assert.equal(await port({ BELLPR_PORT: "4400" }), running);
      assert.match((await appCheck({}, false)) as string, new RegExp(`Port ${running}, `));
    } finally {
      await server.shutdown();
    }
    assert.equal(await port(), 4311);
  });
});

test("bell-pr start runs the server with the flags and --env-file settings", async () => {
  await withDataDir(async (dataDir, directory) => {
    const port = await freePort();
    const envFile = path.join(directory, "bell.env");
    writeFileSync(envFile, `BELLPR_TEST_ENV_FILE_LOADED=yes\nBELLPR_STATIC_DIR=${path.join(directory, "ui")}\n`);
    let running: RunningServer | undefined;
    const stdout = output();
    try {
      const code = await withLocale("en", () =>
        main(["--force", "--port", String(port), "--data-dir", dataDir, "--env-file", envFile, "--no-open"], {
          stdout: stdout.stream,
          stderr: output().stream,
          startOptions: { handleExit: false },
          onStarted: (server) => (running = server),
        }),
      );
      assert.equal(code, undefined);
      assert.equal(process.env.BELLPR_TEST_ENV_FILE_LOADED, "yes");
      assert.ok(running);
      assert.equal(running.url, `http://127.0.0.1:${port}`);
      assert.match(stdout.text(), new RegExp(`→ http://127\\.0\\.0\\.1:${port}\\n`));
      assert.equal(
        JSON.parse(readFileSync(path.join(dataDir, "bellpr.lock"), "utf8")).port,
        port,
      );
    } finally {
      await running?.shutdown();
      delete process.env.BELLPR_TEST_ENV_FILE_LOADED;
      delete process.env.BELLPR_STATIC_DIR;
    }
    const missing = await cli(["start", "--env-file", path.join(directory, "missing.env")]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /Could not load the settings file/);
  });
});

test("bell-pr start explains a data directory it cannot create, then frees the port", { skip: process.getuid?.() === 0 }, async () => {
  await withDataDir(async (_dataDir, directory) => {
    const readOnly = path.join(directory, "read-only");
    mkdirSync(readOnly, { mode: 0o555 });
    const port = await freePort();
    const result = await cli([
      "start",
      "--force",
      "--port",
      String(port),
      "--data-dir",
      path.join(readOnly, "data"),
    ], { startOptions: { handleExit: false } });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Warning: --force skips the readiness check/);
    assert.match(result.stderr, /BELL PR did not start: EACCES: permission denied, mkdir/);
    // A system error needs no stack trace.
    assert.doesNotMatch(result.stderr, /\n\s+at /);
    // The port is released again.
    const probe = createServer().listen(port, "127.0.0.1");
    await once(probe, "listening");
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  });
});

const readyCodex = `case "$1" in
  --version) echo "codex-cli 0.159.0" ;;
  login) echo "Logged in using ChatGPT" ;;
  *) exit 1 ;;
esac`;

test("bell-pr start exits 1 before it listens when doctor is not ready", async () => {
  await withStandInClis({ git: standInGit }, async (directory) => {
    const dataDir = path.join(directory, "data");
    const port = await freePort();
    const result = await cli(
      ["start", "--port", String(port), "--data-dir", dataDir, "--no-open"],
      { startOptions: { handleExit: false } },
    );
    assert.equal(result.code, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /✗ AI provider/);
    const sample = "No AI provider yet? See the sample tour: bell-pr start --force";
    const headlineAt = result.stderr.indexOf("Not ready:");
    const sampleAt = result.stderr.indexOf(sample);
    const fixAt = result.stderr.indexOf("\n        npm install -g @openai/codex\n");
    assert.ok(headlineAt >= 0 && sampleAt === headlineAt + result.stderr.slice(headlineAt).indexOf("\n") + 1);
    assert.ok(sampleAt < fixAt, result.stderr);
    for (const command of [
      "npm install -g @openai/codex",
      "codex login",
      "npm install -g @anthropic-ai/claude-code",
      "claude auth login",
    ])
      assert.ok(result.stderr.includes(`\n        ${command}\n`), command);
    // Nothing listened, and the data directory was not created.
    assert.equal(existsSync(dataDir), false);
    const probe = createServer().listen(port, "127.0.0.1");
    await once(probe, "listening");
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    let zh = "";
    const zhPort = await freePort();
    const zhCode = await withLocale("zh-TW", () =>
      main(
        ["start", "--port", String(zhPort), "--data-dir", path.join(directory, "data-zh"), "--no-open"],
        {
          env: { BELLPR_NO_OPEN: "1" },
          stdout: { write: () => {} },
          stderr: { write: (text: string) => (zh += text) },
          startOptions: { handleExit: false },
        },
      ),
    );
    assert.equal(zhCode, 1);
    const zhSample = "還沒有 AI 服務？先看範例導覽：bell-pr start --force";
    const zhHeadlineAt = zh.indexOf("尚未就緒");
    const zhSampleAt = zh.indexOf(zhSample);
    const zhFixAt = zh.indexOf("\n        npm install -g @openai/codex\n");
    assert.ok(zhHeadlineAt >= 0 && zhSampleAt === zhHeadlineAt + zh.slice(zhHeadlineAt).indexOf("\n") + 1);
    assert.ok(zhSampleAt < zhFixAt, zh);
  });
});

test("bell-pr start --force starts when doctor is not ready, so the sample tour can open", async () => {
  await withStandInClis({ git: standInGit }, async (directory) => {
    const dataDir = path.join(directory, "data");
    const port = await freePort();
    let running: RunningServer | undefined;
    const result = await cli(
      ["start", "--force", "--port", String(port), "--data-dir", dataDir, "--no-open"],
      {
        env: {
          BELLPR_NO_OPEN: "1",
          BELLPR_STATIC_DIR: path.join(directory, "ui"),
        },
        startOptions: { handleExit: false },
        onStarted: (server) => (running = server),
      },
    );
    try {
      assert.equal(result.code, undefined, result.stderr);
      assert.match(result.stderr, /Warning: --force skips the readiness check/);
      assert.match(result.stderr, /sample tour/);
      assert.match(result.stdout, new RegExp(`→ http://127\\.0\\.0\\.1:${port}\\n`));
      assert.equal(running?.url, `http://127.0.0.1:${port}`);
      assert.equal(existsSync(path.join(dataDir, "bellpr.lock")), true);
    } finally {
      await running?.shutdown();
    }
  });
});

test("bell-pr start listens when every required doctor check passed", async () => {
  await withStandInClis({ git: standInGit, codex: readyCodex }, async (directory) => {
    const dataDir = path.join(directory, "data");
    const port = await freePort();
    let running: RunningServer | undefined;
    const result = await cli(
      ["start", "--port", String(port), "--data-dir", dataDir, "--no-open"],
      {
        env: {
          BELLPR_NO_OPEN: "1",
          BELLPR_STATIC_DIR: path.join(directory, "ui"),
        },
        startOptions: { handleExit: false },
        onStarted: (server) => (running = server),
      },
    );
    try {
      assert.equal(result.code, undefined, result.stderr);
      assert.equal(result.stderr, "");
      assert.doesNotMatch(result.stdout, /Not ready|--force/);
      assert.match(result.stdout, new RegExp(`→ http://127\\.0\\.0\\.1:${port}\\n`));
      assert.equal(running?.url, `http://127.0.0.1:${port}`);
    } finally {
      await running?.shutdown();
    }
  });
});

test("the browser opens only in an interactive terminal outside CI and containers", () => {
  const tty = { write: () => true, isTTY: true };
  const inContainer = existsSync("/.dockerenv") || existsSync("/run/.containerenv");
  assert.equal(canOpenBrowser({}, tty), !inContainer);
  assert.equal(canOpenBrowser({ BELLPR_NO_OPEN: "1" }, tty), false);
  assert.equal(canOpenBrowser({ CI: "true" }, tty), false);
  assert.equal(canOpenBrowser({ CI: "0" }, tty), !inContainer);
  assert.equal(canOpenBrowser({}, { write: () => true, isTTY: false }), false);
});
