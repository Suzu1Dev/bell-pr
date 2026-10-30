import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const installer = fileURLToPath(new URL("./install-wsl.sh", import.meta.url));
const linux = process.platform === "linux";
const nodeScript = (info) => `#!/bin/bash
if [[ "$2" == process.execPath ]]; then readlink -f "$0"
else printf '%s\\n' '${info}'; fi
`;
const npmScript = `#!/bin/bash
printf 'npm' >> "$FIXTURE_LOG"
printf ' <%s>' "$@" >> "$FIXTURE_LOG"
printf '\\n' >> "$FIXTURE_LOG"
if [[ "$1" == --version ]]; then printf '11.0.0\\n'; exit 0; fi
if [[ "$FIXTURE_NPM_EXIT" == 0 && "$FIXTURE_NPM_NO_BIN" != 1 ]]; then
  mkdir -p "$HOME/.local/bin"
  for executable in bell-pr codex claude; do
    printf '#!/bin/bash\\nexit 0\\n' > "$HOME/.local/bin/$executable"
    chmod +x "$HOME/.local/bin/$executable"
  done
fi
exit "$FIXTURE_NPM_EXIT"
`;

async function fixture(run, { nodeInfo = "linux:24", archiveNodeInfo = "linux:24", checksum = true } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-wsl-install-"));
  const home = path.join(directory, "home with space's");
  const bin = path.join(directory, "bin with space's");
  const log = path.join(directory, "commands");
  const release = "node-v24.1.2-linux-x64";
  const archive = path.join(directory, `${release}.tar.xz`);
  const script = async (file, contents) => {
    await writeFile(file, contents);
    await chmod(file, 0o755);
  };
  try {
    await mkdir(home);
    await mkdir(bin);
    await writeFile(log, "");
    await script(path.join(bin, "id"), '#!/bin/bash\nprintf "%s\\n" "${FIXTURE_UID:-1000}"\n');
    await script(path.join(bin, "uname"), '#!/bin/bash\nif [[ "$1" == -s ]]; then echo Linux; else echo x86_64; fi\n');
    await script(path.join(bin, "sudo"), `#!/bin/bash
printf 'sudo' >> "$FIXTURE_LOG"
printf ' <%s>' "$@" >> "$FIXTURE_LOG"
printf '\\n' >> "$FIXTURE_LOG"
exit "$FIXTURE_SUDO_EXIT"
`);
    await script(path.join(bin, "node"), nodeScript(nodeInfo));
    await script(path.join(bin, "npm"), npmScript);
    await script(path.join(bin, "curl"), `#!/bin/bash
printf 'curl\\n' >> "$FIXTURE_LOG"
while (($#)); do
  case "$1" in
    --output) output=$2; shift 2 ;;
    *) url=$1; shift ;;
  esac
done
case "$url" in
  https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt) cp "$FIXTURE_DIRECTORY/SHASUMS256.txt" "$output" ;;
  https://nodejs.org/dist/v24.1.2/node-v24.1.2-linux-x64.tar.xz) cp "$FIXTURE_DIRECTORY/node-v24.1.2-linux-x64.tar.xz" "$output" ;;
  *) exit 91 ;;
esac
`);
    await mkdir(path.join(directory, release, "bin"), { recursive: true });
    await script(path.join(directory, release, "bin", "node"), nodeScript(archiveNodeInfo));
    await script(path.join(directory, release, "bin", "npm"), npmScript);
    const packed = spawnSync("tar", ["-cJf", archive, "-C", directory, release]);
    assert.equal(packed.status, 0, packed.stderr?.toString());
    const digest = checksum ? createHash("sha256").update(await readFile(archive)).digest("hex") : "0".repeat(64);
    await writeFile(path.join(directory, "SHASUMS256.txt"), `${digest}  ${release}.tar.xz\n`);
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin`,
      FIXTURE_DIRECTORY: directory,
      FIXTURE_LOG: log,
      FIXTURE_NPM_EXIT: "0",
      FIXTURE_SUDO_EXIT: "0",
    };
    const install = (args = [], extra = {}) => spawnSync("/bin/bash", [installer, ...args], {
      env: { ...env, ...extra }, encoding: "utf8", timeout: 15_000,
    });
    await run({ home, bin, directory, install, log: () => readFile(log, "utf8"), env });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("WSL helper uses user npm prefix, selected provider, and idempotent login PATH", { skip: !linux }, async () => {
  await fixture(async (f) => {
    await writeFile(path.join(f.home, ".bash_profile"), "# Existing user profile\n");
    const args = ["--provider", "claude", "--version", "1.2.3-rc.1", "--lang", "zh-TW"];
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = f.install(args);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /安裝完成/);
      assert.match(result.stdout, /gh auth login/);
      assert.match(result.stdout, /claude auth login/);
    }
    const log = await f.log();
    assert.match(log, /sudo <apt-get> <install> <-y> <git> <gh> <curl> <ca-certificates> <xz-utils> <bubblewrap> <socat>/);
    assert.ok(log.includes(`npm <install> <--global> <--prefix> <${f.home}/.local> <bell-pr@1.2.3-rc.1> <@anthropic-ai/claude-code>`));
    assert.doesNotMatch(log, /^curl$|sudo <npm>|<auth>|<login>|<start>/m);
    for (const file of [".bash_profile", ".bashrc"]) {
      const profile = await readFile(path.join(f.home, file), "utf8");
      assert.equal(profile.split("\n").filter((line) => line.includes("env.sh")).length, 1);
    }
    const sourced = spawnSync("/bin/bash", ["-c", '. "$HOME/.bash_profile"; command -v node; printf "%s\\n" "$PATH"'], {
      env: { ...f.env, PATH: "/usr/bin:/bin" }, encoding: "utf8",
    });
    assert.equal(sourced.status, 0, sourced.stderr);
    assert.equal(sourced.stdout.split("\n")[0], path.join(f.bin, "node"));
    assert.ok(sourced.stdout.includes(`${f.home}/.local/bin`));
  });
});

test("WSL helper defaults to Codex, and none installs only BELL with sample launch instructions", { skip: !linux }, async () => {
  for (const provider of [undefined, "none"]) {
    await fixture(async (f) => {
      const result = f.install(provider ? ["--provider", provider] : []);
      assert.equal(result.status, 0, result.stderr);
      const log = await f.log();
      assert.equal(log.includes("<@openai/codex>"), !provider);
      assert.equal(result.stdout.includes("codex login"), !provider);
      assert.equal(result.stdout.includes("bell-pr start --force"), Boolean(provider));
    });
  }
});

test("WSL helper rejects root and shell syntax in arguments before invoking installers", { skip: !linux }, async () => {
  await fixture(async (f) => {
    const root = f.install([], { FIXTURE_UID: "0" });
    assert.equal(root.status, 1);
    assert.match(root.stderr, /not root/);
    for (const args of [["--version", "1.0.0;touch ignored"], ["--provider", "$(id)"], ["--lang", "invalid"], ["--version"]]) {
      assert.equal(f.install(args).status, 2);
    }
    assert.equal(await f.log(), "");
  });
});

test("WSL helper preserves sudo/npm failure exits and does not announce completion", { skip: !linux }, async () => {
  for (const failure of [{ FIXTURE_SUDO_EXIT: "73" }, { FIXTURE_NPM_EXIT: "49" }]) {
    await fixture(async (f) => {
      const result = f.install([], failure);
      assert.equal(result.status, Number(Object.values(failure)[0]));
      assert.doesNotMatch(result.stdout, /is installed|gh auth login/);
      await assert.rejects(readFile(path.join(f.home, ".profile")), { code: "ENOENT" });
    });
  }
});

test("WSL helper replaces Windows Node with verified user-owned Linux Node and reuses it", { skip: !linux }, async () => {
  await fixture(async (f) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = f.install();
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal((await f.log()).split("\n").filter((line) => line === "curl").length, 2);
    const env = await readFile(path.join(f.home, ".local/share/bell-pr/env.sh"), "utf8");
    assert.ok(env.includes("/share/bell-pr/node/bin"));
  }, { nodeInfo: "win32:24" });
});

test("WSL helper stops on checksum mismatch before extracting or installing packages", { skip: !linux }, async () => {
  await fixture(async (f) => {
    const result = f.install();
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(await f.log(), /npm <install>/);
    await assert.rejects(readFile(path.join(f.home, ".local/share/bell-pr/node/bin/node")), { code: "ENOENT" });
  }, { nodeInfo: "linux:20", checksum: false });
});

test("WSL helper rejects an unusable downloaded Node before npm install", { skip: !linux }, async () => {
  await fixture(async (f) => {
    const result = f.install();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Linux Node.js 22 or newer/);
    assert.doesNotMatch(await f.log(), /npm <install>/);
    assert.doesNotMatch(result.stdout, /is installed|gh auth login/);
  }, { nodeInfo: "linux:20", archiveNodeInfo: "win32:24" });
});

test("WSL helper rejects npm success without executable CLI and does not update profiles", { skip: !linux }, async () => {
  await fixture(async (f) => {
    const result = f.install([], { FIXTURE_NPM_NO_BIN: "1" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /executable CLI is missing/);
    assert.doesNotMatch(result.stdout, /is installed|gh auth login/);
    await assert.rejects(readFile(path.join(f.home, ".profile")), { code: "ENOENT" });
  });
});
