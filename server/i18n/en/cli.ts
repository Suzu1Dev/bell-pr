/** Command-line (bell-pr) messages. */
import { product } from "../../../shared/product.js";

const name = product.name;
const bin = product.binNames[0];

export default {
  /** `bell-pr help`. */
  help: ({ version }: { version: string }) =>
    [
      `${name} ${version}: a local workbench for open-source contributions.`,
      "",
      `Usage: ${bin} [command] [options]`,
      "",
      "Commands:",
      `  start      Start ${name} (the default command)`,
      "  open       Print a new one-time sign-in link and open it in the browser",
      "  doctor     Check git, gh and the agent CLIs (--json for machine output)",
      "  version    Show the version, Node.js, platform and data directory",
      "  help       Show this help",
      "",
      "Options for start:",
      "  --port <port>       Port to listen on (BELLPR_PORT, default 4311)",
      "  --host <host>       Address to listen on (BELLPR_HOST, default 127.0.0.1)",
      "  --data-dir <dir>    Data directory (BELLPR_DATA_DIR, default ~/.bellpr)",
      "  --no-open           Do not open the browser (BELLPR_NO_OPEN=1)",
      "  --env-file <file>   Load settings such as BELLPR_PORT from a file first",
      "",
      "Options for open:",
      "  --print             Only print the link",
      "  --no-open           Do not open the browser",
      `  --data-dir <dir>    Data directory of the running ${name}`,
      "",
      `${name} signs browsers in with a link. Run \`${bin} open\` on this computer for a new one; in Docker, run \`docker exec <container> ${bin} open --print\`.`,
    ].join("\n"),
  /** A command that does not exist. */
  unknownCommand: ({ command }: { command: string }) =>
    `Unknown command "${command}". Run \`${bin} help\` for the list of commands.`,
  /** Options the command does not accept; `reason` is one of `arguments`. */
  invalidArguments: ({ reason }: { reason: string }) =>
    `${reason}\nRun \`${bin} help\` for usage.`,
  /** What is wrong with the command line. */
  arguments: {
    unknownOption: ({ option }: { option: string }) =>
      `Unknown option ${option}.`,
    missingValue: ({ option }: { option: string }) =>
      `The option ${option} needs a value.`,
    noValue: ({ option }: { option: string }) =>
      `The option ${option} does not take a value.`,
    unexpected: ({ value }: { value: string }) =>
      `Unexpected argument "${value}".`,
  },
  /** --env-file could not be loaded. */
  envFileFailed: ({ path, reason }: { path: string; reason: string }) =>
    `Could not load the settings file ${path}: ${reason}`,
  /** `bell-pr version`, one line each. */
  version: {
    app: ({ version, buildDate }: { version: string; buildDate: string }) =>
      `${name} ${version} (built ${buildDate})`,
    runtime: ({
      node,
      platform,
      arch,
    }: {
      node: string;
      platform: string;
      arch: string;
    }) => `Node.js ${node} on ${platform} ${arch}`,
    dataDir: ({ path }: { path: string }) => `Data directory: ${path}`,
  },
  /** Settings that make `bell-pr start` refuse to run. */
  config: {
    portRange: ({ name, value }: { name: string; value: string }) =>
      `${name} must be a whole number from 1024 to 65535, not "${value}".`,
    hostInvalid: ({ value }: { value: string }) =>
      `--host and BELLPR_HOST take a host name or an IP address, not "${value}".`,
    publicUrlInvalid: ({ value }: { value: string }) =>
      `BELLPR_PUBLIC_URL must be the address browsers use for ${name}, such as https://bell.example.com: http or https, with no path, query or user name, and https for any address other than this computer. "${value}" is not.`,
    devNeedsLoopback: ({ host }: { host: string }) =>
      `Development mode turns sign-in off, so it only listens on this computer. Use --host 127.0.0.1 instead of ${host}.`,
    /** A host other than this computer or all addresses, without BELLPR_PUBLIC_URL. */
    publicUrlRequired: ({ host }: { host: string }) =>
      `To listen on ${host}, set BELLPR_PUBLIC_URL to the HTTPS address browsers use to reach ${name}, such as https://bell.example.com behind a reverse proxy; without it every request would be refused. To use ${name} on this computer only, leave --host at 127.0.0.1.`,
  },
  /** `bell-pr start`. */
  start: {
    /** The startup line with the sign-in link (or the address in development mode). */
    startup: ({ version, url }: { version: string; url: string }) =>
      `${name} ${version} → ${url}`,
    /** Data left by an older version in the current folder; nothing moves. */
    legacyDataDir: ({ dataDir }: { dataDir: string }) =>
      `Found ${name} data in ./.bellpr. ${name} now uses ${dataDir} and moved nothing. To keep using the old folder, start it with: ${bin} start --data-dir ./.bellpr`,
    alreadyRunning: ({ url }: { url: string }) =>
      `${name} is already running at ${url}. Run \`${bin} open\` to get a sign-in link; add --data-dir <dir> if that ${name} was started with another data directory.`,
    portInUse: ({ port }: { port: number }) =>
      `Port ${port} is already in use by another program. Start ${name} on a free port with \`${bin} start --port <port>\`.`,
    dataDirInUse: ({ dataDir, pid }: { dataDir: string; pid: number }) =>
      `${name} is already running with the data directory ${dataDir} (process ${pid}). Run \`${bin} open\` to get a sign-in link, or stop that process first.`,
    listenFailed: ({ address, reason }: { address: string; reason: string }) =>
      `${name} could not listen on ${address}: ${reason}`,
    failed: ({ reason }: { reason: string }) =>
      `${name} did not start: ${reason}`,
    uiMissing: ({ path }: { path: string }) =>
      `The web interface is not built: ${path} has no index.html. Run \`npm run build\` in the ${name} source folder and start ${name} again; until then only the API answers.`,
    /** Title and text of the page served while the web interface is missing. */
    uiMissingTitle: `${name}: web interface not built`,
    uiMissingPage:
      `The ${name} web interface is not built. Run npm run build in the ${name} source folder, then start ${name} again.`,
  },
  /** `bell-pr open`. */
  open: {
    notRunning: ({ dataDir }: { dataDir: string }) =>
      `No ${name} is running with the data directory ${dataDir}. Start it with \`${bin}\`, or, for a ${name} started with another data directory, run \`${bin} open --data-dir <dir>\`.`,
    noAnswer:
      `${name} did not answer within 5 seconds. Check that it is still running, or restart it and use the sign-in link it prints.`,
    unavailable:
      `Sign-in links are unavailable in this version of ${name}. Restart ${name} and use the sign-in link it prints.`,
    signalFailed: ({ reason }: { reason: string }) =>
      `Could not reach the running ${name} process: ${reason}`,
    windows: `\`${bin} open\` does not work on Windows. Run ${name} in WSL2 and use \`${bin} open\` there.`,
    /** After the link: how long it lasts. */
    linkHint: "This link signs in one browser. It works once, within 2 minutes.",
  },
};
