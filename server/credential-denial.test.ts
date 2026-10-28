// The shared credential deny list: ~/.git-credentials, a fixture Git
// config's `credential.helper store --file` paths, and the same paths in
// both agents' sandbox settings.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sharedCredentialDenials } from "../shared/credential-denials.js";
import { agentCommand } from "./agent-cli.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "credential-store.gitconfig",
);

test("a fixture git config's store --file paths are denied, and a missing config is not fatal", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bell-credential-deny-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const xdg = path.join(root, "xdg");
  await mkdir(path.join(xdg, "git"), { recursive: true });
  await mkdir(home, { recursive: true });
  const system = path.join(root, "system.gitconfig");
  await writeFile(
    path.join(xdg, "git", "config"),
    "[credential]\n\thelper = store --file ~/bell-pr-xdg-credentials\n",
  );
  await writeFile(
    system,
    "[credential]\n\thelper = store --file /tmp/bell-pr-system-credentials\n\thelper = osxkeychain\n",
  );
  const fixture = await readFile(fixturePath, "utf8");
  assert.match(fixture, /store --file ~\/\.bell-pr-custom-credentials/);
  assert.match(fixture, /store --file=\/tmp\/bell-pr-store-credentials/);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: xdg,
    GIT_CONFIG_GLOBAL: fixturePath,
    GIT_CONFIG_SYSTEM: system,
  };
  delete env.GIT_CONFIG_NOSYSTEM;
  delete env.GH_CONFIG_DIR;
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CODEX_HOME;
  const denials = sharedCredentialDenials({ env, home });
  for (const entry of [
    "~/.config/gh/**",
    "~/.git-credentials",
    "~/.netrc",
    "~/.ssh/**",
    "~/.aws/**",
    "~/.npmrc",
  ])
    assert.ok(denials.includes(entry), entry);
  assert.ok(denials.includes(path.join(home, ".bell-pr-custom-credentials")));
  assert.ok(denials.includes(path.join(home, "bell-pr-xdg-credentials")));
  assert.ok(denials.includes("/tmp/bell-pr-store-credentials"));
  assert.ok(denials.includes("/tmp/bell-pr-system-credentials"));
  // Plain `store`, cache, osxkeychain and a shell helper add no extra file.
  assert.equal(
    denials.filter((entry) => entry.includes("cache") || entry.includes("osxkeychain")).length,
    0,
  );

  const gh = path.join(root, "gh-config");
  await mkdir(gh);
  const moved = sharedCredentialDenials({
    env: { ...env, GH_CONFIG_DIR: gh, XDG_CONFIG_HOME: xdg },
    home,
  });
  assert.ok(moved.includes(`${gh}/**`), "GH_CONFIG_DIR");
  assert.ok(moved.includes(`${path.join(xdg, "gh")}/**`), "XDG_CONFIG_HOME/gh");

  const missing = sharedCredentialDenials({
    env: {
      ...env,
      GIT_CONFIG_GLOBAL: path.join(root, "missing.gitconfig"),
      GIT_CONFIG_SYSTEM: path.join(root, "also-missing.gitconfig"),
      XDG_CONFIG_HOME: path.join(root, "empty-xdg"),
    },
    home,
  });
  assert.ok(missing.includes("~/.git-credentials"));
  assert.ok(!missing.some((entry) => entry.includes("bell-pr-custom")));

  // A directory is not a config file. Git fails; the static list remains.
  const unreadable = sharedCredentialDenials({
    env: {
      ...env,
      GIT_CONFIG_GLOBAL: root,
      GIT_CONFIG_NOSYSTEM: "1",
      XDG_CONFIG_HOME: path.join(root, "empty-xdg"),
    },
    home,
  });
  assert.ok(unreadable.includes("~/.git-credentials"));
  assert.ok(unreadable.includes("~/.netrc"));
});

test("Claude and Codex are given the same shared credential denials", async (t) => {
  const previous = {
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    GH_CONFIG_DIR: process.env.GH_CONFIG_DIR,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  process.env.GIT_CONFIG_GLOBAL = fixturePath;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  delete process.env.GH_CONFIG_DIR;
  const xdg = await mkdtemp(path.join(os.tmpdir(), "bell-credential-xdg-"));
  process.env.XDG_CONFIG_HOME = xdg;
  t.after(() => {
    rm(xdg, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const denials = sharedCredentialDenials();
  assert.ok(denials.includes(path.join(os.homedir(), ".bell-pr-custom-credentials")));
  const cwd = os.tmpdir();
  const claude = await agentCommand(
    { provider: "claude", source: "cli-default" },
    { cwd, access: "none" },
  );
  const settings = JSON.parse(
    claude.args[claude.args.indexOf("--settings") + 1],
  ) as { permissions: { deny: string[] } };
  const codex = await agentCommand({ source: "cli-default" }, { cwd, access: "write" });
  const table = codex.args.find((arg) => arg.startsWith("permissions={bell-pr="));
  assert.ok(table);
  for (const entry of [
    "~/.config/gh/**",
    "~/.git-credentials",
    "~/.netrc",
    "~/.ssh/**",
    "~/.aws/**",
    "~/.npmrc",
  ]) {
    assert.ok(settings.permissions.deny.includes(`Read(${entry})`), entry);
    assert.ok(table!.includes(`"${entry}"="deny"`), entry);
  }
  const custom = path.join(os.homedir(), ".bell-pr-custom-credentials");
  assert.ok(settings.permissions.deny.some((rule) => rule.includes(custom)));
  assert.ok(table!.includes(`"${custom}"="deny"`));
  assert.ok(!codex.args.includes("--sandbox"));
  assert.equal(codex.args[codex.args.indexOf("default_permissions=\"bell-pr\"") - 1], "-c");
});
