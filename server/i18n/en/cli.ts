/** Command-line (bell-pr) messages. */
import { product } from "../../../shared/product.js";

const name = product.name;
const bin = product.binNames[0];

export default {
  browserOpenHint: `Could not open the browser. Run \`${bin} open --print --print-token\` to get the address.`,
  /** `bell-pr help`. */
  help: ({ version }: { version: string }) =>
    [
      `${name} ${version}: a local workbench for open-source contributions.`,
      "",
      `Usage: ${bin} [command] [options]`,
      "",
      "Commands:",
      `  start      Start or open ${name} (default)`,
      "  open       Print and open the running service's address",
      `  doctor     Check what ${name} needs (--json: JSON output)`,
      "  token      New API token; signs out paired devices (`token rotate`)",
      "  pair       One-time code to pair another device",
      "  devices    List or revoke paired devices (`devices list`, `devices revoke <id>`)",
      "  group      Group work: `group status`, `group setup`, `group invite <name>`",
      "  version    Show version, Node.js, platform and data directory",
      "  help       Show this help",
      "",
      "start options:",
      "  --port <port>       Listen port (BELLPR_PORT, default 4311)",
      "  --host <host>       Listen address (BELLPR_HOST, default 127.0.0.1)",
      "  --data-dir <dir>    Data directory (BELLPR_DATA_DIR, default ~/.bellpr)",
      "  --no-open           Don't open the browser (BELLPR_NO_OPEN=1)",
      "  --force             Start even if doctor says Not ready",
      "  --group             Turn on group work (BELLPR_GROUP=1)",
      "  --env-file <file>   Load BELLPR_* settings from a file first",
      "",
      "open options:",
      "  --print             Only print the address, without the API token",
      "  --print-token       Print the address with the API token",
      "  --no-open           Don't open the browser",
      `  --data-dir <dir>    The running ${name}'s data directory`,
      "",
      "pair options:",
      "  --name <name>       New device name",
      "  --no-qr             No QR code",
      "  --unlock            Clear the pairing lock and failure count",
      "",
      "group invite options:",
      "  --admin             Invite as a group admin",
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
      `BELLPR_PUBLIC_URL must be the address browsers use for ${name}, such as https://bell.example.com: https (http only on this computer), with no path, query or user name. "${value}" is not.`,
    devNeedsLoopback: ({ host }: { host: string }) =>
      `Development mode only listens on this computer. Use --host 127.0.0.1 instead of ${host}.`,
    /** A host other than this computer or all addresses, without BELLPR_PUBLIC_URL. */
    publicUrlRequired: ({ host }: { host: string }) =>
      `To listen on ${host}, set BELLPR_PUBLIC_URL to ${name}'s public HTTPS address, such as https://bell.example.com behind a reverse proxy. Without it, every request is refused. For this computer only, keep --host at 127.0.0.1.`,
    /** A run, process or timeout limit outside its range. */
    limitRange: ({ name, min, max }: { name: string; min: number; max: number }) =>
      `${name} must be between ${min} and ${max}.`,
  },
  /** `bell-pr start`. */
  start: {
    /** The startup line with the address. */
    startup: ({ version, url }: { version: string; url: string }) =>
      `${name} ${version} → ${url}`,
    reusing: ({ url }: { url: string }) => `${name} is running → ${url}`,
    /** Data left by an older version in the current folder; nothing moves. */
    legacyDataDir: ({ dataDir }: { dataDir: string }) =>
      `${name} now uses ${dataDir}. Older data in ./.bellpr was not moved; to keep using it, run: ${bin} start --data-dir ./.bellpr`,
    alreadyRunning: ({ url }: { url: string }) =>
      `${name} is already running at ${url}. Run \`${bin} open\` to open it, with --data-dir <dir> if it uses another data directory.`,
    portInUse: ({ port }: { port: number }) =>
      `Port ${port} is already in use by another program. Start ${name} on a free port with \`${bin} start --port <port>\`.`,
    dataDirInUse: ({ dataDir, pid }: { dataDir: string; pid: number }) =>
      `${name} is already running with the data directory ${dataDir} (process ${pid}). Run \`${bin} open\` to open it, or stop that process first.`,
    /** Strict rule (coordination): a lock whose holder cannot be shown to have stopped. */
    dataDirHolderUnconfirmed: ({ dataDir, file }: { dataDir: string; file: string }) =>
      `${name} cannot tell whether the process holding the data directory ${dataDir} has stopped: its lock ${file} is from another container, machine or older version, or unreadable, so it stays. Once sure nothing uses this data directory, remove ${file} and start again.`,
    /** No holder to name: the lock was gone, or not a lock, each time the start looked. */
    dataDirLockUnsettled: ({ dataDir, file }: { dataDir: string; file: string }) =>
      `${name} could not take the lock ${file} of the data directory ${dataDir}: the file kept changing or was unreadable. Start again in a moment. If it keeps failing with no ${name} running here, remove ${file}.`,
    /** A lock, or what lies in its place, that cannot be read: no start replaces it. `reason` is the system's. */
    lockUnreadable: ({ file, reason }: { file: string; reason: string }) =>
      `${name} cannot read the lock file ${file}: ${reason}. A running ${name} may own it, so it stays. Once sure no ${name} runs here, remove ${file} and start again.`,
    /** Another start's claim on a stale lock, which this start could not clear. */
    takeoverClaimed: ({ file }: { file: string }) =>
      `Another ${name} start is replacing this data directory's stale lock, or stopped mid-way: its claim file ${file} remains. Start again in half a minute. If this repeats with no ${name} starting, remove ${file}.`,
    /** Strict rule (coordination): a claim whose start cannot be shown to have stopped. */
    takeoverClaimUnconfirmed: ({ file }: { file: string }) =>
      `${name} cannot tell whether the start replacing this data directory's stale lock has stopped, so its claim file ${file} stays. Once sure no ${name} is starting here, remove ${file} and start again.`,
    /** `start --group` or a `group` command: the running instance was started without group work. */
    withoutGroup: ({ url }: { url: string }) =>
      `${name} is already running at ${url} without group work. Stop it first, then start it with \`${bin} start --group\`.`,
    listenFailed: ({ address, reason }: { address: string; reason: string }) =>
      `${name} could not listen on ${address}: ${reason}`,
    failed: ({ reason }: { reason: string }) =>
      `${name} did not start: ${reason}`,
    /** `--force`: the readiness gate is skipped. */
    forced: `Warning: --force skipped the readiness check. \`${bin} doctor\` shows what is missing. Only the sample tour works without an AI provider.`,
    /** A required doctor check failed, so start did not listen. */
    notReady: `${name} did not start. The checklist above names each failed required check and the command that fixes it.`,
    /** Right under the Not ready headline, before the fix commands. */
    sampleTour: `No AI provider yet? See the sample tour: ${bin} start --force`,
    uiMissing: ({ path }: { path: string }) =>
      `The web interface is not built: ${path} has no index.html. Run \`npm run build\` in the source folder, then restart; only the API answers until then.`,
    /** Title and text of the page served while the web interface is missing. */
    uiMissingTitle: `${name}: web interface not built`,
    uiMissingPage:
      `The ${name} web interface is not built. Run npm run build in the ${name} source folder, then start ${name} again.`,
    /** --host or BELLPR_HOST is not 127.0.0.1 (and not another loopback address). */
    exposedHost: ({ host }: { host: string }) =>
      `${name} is listening on ${host}, not only on 127.0.0.1, as set by --host or BELLPR_HOST. The API token is still required.`,
    /** 0.0.0.0 / :: without BELLPR_PUBLIC_URL: remote clients are refused by the Host guard. */
    wildcardHostNeedsPublicUrl: ({ host }: { host: string }) =>
      `${name} is listening on ${host} without BELLPR_PUBLIC_URL. Remote connections get HTTP 403 until it is set to the HTTPS origin browsers use, such as https://bell.example.com.`,
  },
  /** `bell-pr open`. */
  open: {
    notRunning: ({ dataDir }: { dataDir: string }) =>
      `No ${name} is running with the data directory ${dataDir}. Start it with \`${bin}\`; for another data directory, run \`${bin} open --data-dir <dir>\`.`,
  },
  /** `bell-pr token rotate`. The new token is not included. */
  token: {
    rotated: ({ path }: { path: string }) =>
      `Replaced the API token in ${path}. A running ${name} uses it from the next request. Open the app with \`${bin} open\`.`,
    usage: `Run \`${bin} token rotate\` to replace the API token.`,
    /** Printed after `rotated`. */
    devicesCleared: "Paired devices are signed out and any pairing code is void. Pair them again with a new code.",
  },
  /** `bell-pr pair`. The code is shown; no token ever is. */
  pair: {
    created: ({ pairUrl, code, expiresAt }: { pairUrl: string; code: string; expiresAt: string }) =>
      [
        `On the other device, open ${pairUrl}`,
        `and enter the pairing code: ${code}`,
        `Single use; expires at ${expiresAt} (in 5 minutes). A new code replaces it.`,
      ].join("\n"),
    locked: ({ lockedUntil }: { lockedUntil: string }) =>
      `Pairing is locked until ${lockedUntil} after too many wrong codes.`,
    /** The failure record is missing or damaged, so pairing stays locked. */
    lockedDamaged: "Pairing is locked: its record of failed attempts is missing or damaged.",
    /** Also sent with every 423 response. */
    unlockHint: `If you made the failed attempts yourself, run \`${bin} pair --unlock\` on the computer running ${name}.`,
    unlocked: "Pairing is unlocked and its failure count is cleared.",
    /** A device paired without a name. */
    defaultDeviceName: "Paired device",
  },
  /** `bell-pr devices`. */
  devices: {
    usage: `Run \`${bin} devices list\` or \`${bin} devices revoke <id>\`.`,
    none: "No paired devices.",
    line: ({ id, name, createdAt, lastUsedAt }: { id: string; name: string; createdAt: string; lastUsedAt: string }) =>
      `${id}  ${name}  paired ${createdAt}  last used ${lastUsedAt}`,
    neverUsed: "never",
    revoked: ({ id }: { id: string }) => `Revoked ${id}. Its token no longer works.`,
    notFound: ({ id }: { id: string }) => `No paired device has the id ${id}. Run \`${bin} devices list\` to see them.`,
  },
  /** `bell-pr group`. The invite code is shown; no token ever is. */
  group: {
    usage: `Run \`${bin} group status\`, \`${bin} group setup\` or \`${bin} group invite <name> [--admin]\`.`,
    notSetUp: `Group work is not set up yet. Run \`${bin} group setup\`.`,
    ready: "Group work is set up and ready.",
    /** `reason` is the stable word the server gives, such as sideMissing. */
    stopped: ({ reason }: { reason: string }) =>
      `Group work has stopped (reason: ${reason}). Look the reason up under "Group work has stopped" in docs/troubleshooting.md, fix the cause, then restart ${name}.`,
    setUp: `Group work is set up. Invite the first admin with \`${bin} group invite <name> --admin\`.`,
    alreadySetUp: "Group work is already set up.",
    invited: ({
      person,
      admin,
      code,
      expiresAt,
      minutes,
    }: {
      person: string;
      admin: boolean;
      code: string;
      expiresAt: string;
      minutes: number;
    }) =>
      [
        `Invite code for ${person}${admin ? " (admin)" : ""}: ${code}`,
        `The code works once and expires at ${expiresAt} (in ${minutes} minutes). Restarting ${name} voids it.`,
      ].join("\n"),
  },
  /** A pair, devices or group request the running server refused. */
  requestFailed: ({ status, error }: { status: number; error: string }) =>
    `${name} answered ${status}: ${error}`,
};
