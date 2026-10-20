// A spec-local server whose setup looks ready, as a person who finished it
// sees the app: stand-in codex, claude and gh answer the environment
// check's probes like signed-in CLIs (every other call fails, so no agent
// can run and nothing reaches GitHub), and Git has a name and an e-mail
// address. e2e/screenshots.spec.ts keeps its own copy of the stand-ins.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { launchServer, type LaunchedServer, type LaunchServerOptions } from "../start-server.mjs";

/** Stand-ins that answer the doctor's probes; every other call fails. */
export const readyStandIns = {
  codex: `case "$1" in
  --version) echo "codex-cli 0.159.0" ;;
  login) echo "Logged in using ChatGPT" ;;
  *) exit 1 ;;
esac`,
  claude: `case "$1" in
  --version) echo "2.1.292 (Claude Code)" ;;
  auth) echo '{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "max"}' ;;
  *) exit 1 ;;
esac`,
  gh: `case "$1" in
  --version) echo "gh version 2.46.0 (2024-03-13)" ;;
  auth) echo "gho_sample" ;;
  api) printf 'HTTP/2.0 200 OK\\r\\nX-Oauth-Scopes: repo, workflow, read:org\\r\\n\\r\\nsample-contributor\\n1\\n' ;;
  *) exit 1 ;;
esac`,
};

/**
 * A server whose setup looks ready. `options` go to launchServer(); a PATH
 * there comes after the stand-ins. Its stop() also removes the stand-ins.
 */
export async function startReadyServer(
  options: LaunchServerOptions = {},
): Promise<LaunchedServer> {
  const tools = await mkdtemp(path.join(os.tmpdir(), "bellpr-ready-"));
  const removeTools = () => rm(tools, { recursive: true, force: true });
  let server: LaunchedServer | undefined;
  try {
    for (const [name, body] of Object.entries(readyStandIns))
      await writeFile(path.join(tools, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    const gitconfig = path.join(tools, "gitconfig");
    await writeFile(gitconfig, "[user]\n\tname = Sample Contributor\n\temail = contributor@example.com\n");
    const { PATH, ...env } = options.env ?? {};
    server = await launchServer({
      ...options,
      env: {
        GIT_CONFIG_GLOBAL: gitconfig,
        ...env,
        PATH: [tools, PATH ?? process.env.PATH].filter(Boolean).join(path.delimiter),
      },
    });
  } catch (error) {
    await server?.stop();
    await removeTools();
    throw error;
  }
  const { stop } = server;
  return {
    ...server,
    stop: async () => {
      await stop();
      await removeTools();
    },
  };
}
