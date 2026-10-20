/**
 * Agent CLI processes, and test runs, that outlive BELL PR.
 *
 * Every agent CLI (codex, claude) runs in its own process group, and so
 * does the person's test command (`/bin/sh -c`, server/by-hand-tests.ts).
 * While BELL PR runs, AgentRegistry records the live groups in
 * `<dataDir>/children.json` (0600). If BELL PR crashes or is killed, those
 * agents keep running and editing worktrees, and a test run keeps running
 * in its run's folder; at the next start, reapOrphanedAgents stops the
 * recorded groups that are still alive, before the store marks their runs
 * failed.
 *
 * POSIX only: Windows has no process groups, and BELL PR does not record
 * there.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { log } from "./log.js";
import { lenientRead } from "./persisted-schema.js";
import {
  setSpawnObserver,
  type SpawnDetails,
  type SpawnObserver,
} from "./process.js";

/**
 * One recorded process group. Like every persisted file, every field but
 * the group id is optional, and the file is read leniently, so a newer
 * build's file still loads. This build always writes all of them but
 * `startTicks`, which only a group command() asked to record has, on
 * Linux.
 */
export const childSchema = z.object({
  /** The process group, which is the pid of the detached agent CLI. */
  pgid: z.number().int().positive(),
  /**
   * codex or claude; or the program of a group command() asked to record
   * (`sh` for the person's test command).
   */
  executable: z.string().min(1).max(200).optional(),
  /** When BELL PR started it (ISO). */
  startedAt: z.string().min(1).max(40).optional(),
  /**
   * Linux, a group command() asked to record (a test run): when its first
   * process started, in clock ticks after boot (/proc/<pid>/stat), which
   * with the pid names that one process.
   */
  startTicks: z.number().int().nonnegative().optional(),
});
const childrenSchema = z.object({
  version: z.number().int().positive().optional(),
  // Entries are checked one by one, so one bad entry does not hide the rest.
  children: z.array(z.unknown()).max(1000).optional(),
});
const childReadSchema = lenientRead(childSchema);
const childrenReadSchema = lenientRead(childrenSchema);

export type AgentChild = Required<Omit<z.infer<typeof childSchema>, "startTicks">> &
  Pick<z.infer<typeof childSchema>, "startTicks">;
type RecordedChild = z.infer<typeof childSchema>;

const agentExecutable = /^(codex|claude)(\.exe|\.cmd)?$/i;
/** codex or claude as the program, or in its path (npm installs run under node). */
const agentPath = /(^|[\\/])(codex|claude)(-code)?([\\/.]|$)/i;

/** The agent CLIs whose process groups are recorded. */
export function isAgentExecutable(executable: string): boolean {
  return agentExecutable.test(path.basename(executable));
}

/** Whether a command line (argv) runs codex or claude. */
export function isAgentCommand(argv: readonly string[]): boolean {
  return argv.slice(0, 2).some((part) => agentPath.test(part));
}

/** The groups recorded in children.json; nothing when it is missing or unreadable. */
export function readChildren(file: string): RecordedChild[] {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const parsed = childrenReadSchema.safeParse(value);
  if (!parsed.success) return [];
  return (parsed.data.children ?? []).flatMap((entry) => {
    const child = childReadSchema.safeParse(entry);
    return child.success ? [child.data] : [];
  });
}

export function writeChildren(file: string, children: AgentChild[]): void {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ version: 1, children })}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, file);
}

/**
 * Records the agent CLI process groups started from now on in
 * children.json, and the groups command() asks to record (`endGroup`: the
 * person's test command), and removes each group when its process exits
 * (for a group command() asked for, once the whole group is gone). Writes
 * are synchronous, so the file is current at the moment of a crash.
 */
export class AgentRegistry implements SpawnObserver {
  private readonly children = new Map<number, AgentChild>();

  constructor(private readonly file: string) {}

  /** Becomes the spawn observer and writes an empty list. */
  start(): void {
    if (process.platform === "win32") return;
    this.persist();
    setSpawnObserver(this);
  }

  /** Stops observing; the agents still running are left in the file. */
  stop(): void {
    if (process.platform === "win32") return;
    setSpawnObserver();
  }

  /** The groups recorded now. */
  list(): AgentChild[] {
    return [...this.children.values()];
  }

  onSpawn(pid: number, executable: string, details?: SpawnDetails): void {
    if (!isAgentExecutable(executable) && !details?.recordGroup) return;
    // The child is not reaped before this returns, so /proc still has it.
    const ticks = details?.recordGroup ? startTicks(pid) : undefined;
    this.children.set(pid, {
      pgid: pid,
      executable: path.basename(executable),
      startedAt: new Date().toISOString(),
      ...(ticks === undefined ? {} : { startTicks: ticks }),
    });
    this.persist();
  }

  onExit(pid: number): void {
    if (this.children.delete(pid)) this.persist();
  }

  private persist(): void {
    try {
      writeChildren(this.file, this.list());
    } catch (error) {
      log.warn("Could not record the running agent processes", {
        file: this.file,
        error,
      });
    }
  }
}

interface GroupProcess {
  pid: number;
  argv: string[];
  /** When the process started (ms since the epoch), where known. */
  startedAt?: number;
  /** Linux: when the process started, in clock ticks after boot. */
  startTicks?: number;
}

/** Field 22 of /proc/<pid>/stat: when the process started, in clock ticks after boot. */
function statStartTicks(stat: string): number | undefined {
  // "pid (comm) state ppid pgrp ..."; comm may contain spaces and parentheses.
  const ticks = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
  return Number.isSafeInteger(ticks) && ticks >= 0 ? ticks : undefined;
}

/** Linux: when process `pid` started, in clock ticks after boot; undefined elsewhere or when unreadable. */
function startTicks(pid: number): number | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    return statStartTicks(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Clock ticks per second in /proc/<pid>/stat: USER_HZ, which is 100 on
 * every architecture Node.js supports.
 */
const clockTicksPerSecond = 100;

/** The boot time in ms from /proc/stat, which start times count from. */
function linuxBootTime(): number | undefined {
  try {
    const match = /^btime (\d+)$/m.exec(readFileSync("/proc/stat", "utf8"));
    return match ? Number(match[1]) * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** One line of `ps -A -o pid=,pgid=,lstart=,command=` run with LC_ALL=C. */
export function parsePsLine(
  line: string,
): { pgid: number; member: GroupProcess } | undefined {
  const match =
    /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s+\d{4})\s*(.*)$/.exec(
      line,
    );
  if (!match) return undefined;
  // lstart is local time, as Date.parse reads a date without a zone.
  const startedAt = Date.parse(match[3].replace(/\s+/g, " "));
  return {
    pgid: Number(match[2]),
    member: {
      pid: Number(match[1]),
      argv: match[4].trim().split(/\s+/).filter(Boolean),
      ...(Number.isFinite(startedAt) ? { startedAt } : {}),
    },
  };
}

/** Every process by process group, from /proc on Linux and `ps` elsewhere. */
function processGroups(): Map<number, GroupProcess[]> {
  const groups = new Map<number, GroupProcess[]>();
  const add = (pgid: number, member: GroupProcess) =>
    groups.set(pgid, [...(groups.get(pgid) ?? []), member]);
  if (process.platform === "linux") {
    const bootTime = linuxBootTime();
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
        // "pid (comm) state ppid pgrp ..."; comm may contain spaces and parentheses.
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        const argv = readFileSync(`/proc/${entry}/cmdline`, "utf8")
          .split("\0")
          .filter(Boolean);
        // Field 22, starttime, in clock ticks after boot.
        const ticks = Number(fields[19]);
        const exact = statStartTicks(stat);
        add(Number(fields[2]), {
          pid: Number(entry),
          argv,
          ...(bootTime !== undefined && Number.isFinite(ticks)
            ? { startedAt: bootTime + (ticks * 1000) / clockTicksPerSecond }
            : {}),
          ...(exact === undefined ? {} : { startTicks: exact }),
        });
      } catch {
        // The process exited while we looked.
      }
    }
    return groups;
  }
  const ps = spawnSync("ps", ["-A", "-o", "pid=,pgid=,lstart=,command="], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  });
  for (const line of ps.stdout?.split("\n") ?? []) {
    const parsed = parsePsLine(line);
    if (parsed) add(parsed.pgid, parsed.member);
  }
  return groups;
}

/** Whether any process of the group is still alive (or a zombie). */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * How much later than its record a group's first process may have started
 * and still be the agent: the record is written right after the start, so
 * this only absorbs clock rounding.
 */
const reusedAfterMs = 30_000;
/**
 * The same for a test run's group without `startTicks` (not Linux): its
 * record is written in the same tick as the spawn, and ps gives whole
 * seconds, rounded down.
 */
const requestedReusedAfterMs = 2_000;

/**
 * Whether a test run's group still has the first process BELL PR started:
 * on Linux the very process (the pid and its start in clock ticks; a test
 * run may run any program, so no command line tells), elsewhere one that
 * started no later than the record allows.
 */
function sameTestRun(child: RecordedChild, startedAt: number, leader?: GroupProcess) {
  if (child.startTicks !== undefined && leader?.startTicks !== undefined)
    return leader.startTicks === child.startTicks;
  return leader?.startedAt !== undefined && leader.startedAt <= startedAt + requestedReusedAfterMs;
}

export interface ReapResult {
  /** Groups sent SIGTERM. */
  terminated: RecordedChild[];
  /** Groups that were still alive after the grace period and got SIGKILL. */
  killed: RecordedChild[];
  /**
   * Recorded groups left alone: from an earlier boot (or no start time),
   * started again under a reused pid, or no longer running an agent CLI.
   */
  skipped: RecordedChild[];
}

/**
 * Stops the agent process groups that a previous BELL PR recorded in
 * children.json and that are still alive: SIGTERM, then SIGKILL after
 * `graceMs` (1.5 s) for the groups that did not exit. A group is only
 * signalled when one of its processes runs codex or claude, none of them is
 * this process, it was recorded during the current boot, and its first
 * process did not start after it was recorded, so a reused pid is not hit.
 * A group recorded at command()'s request (a test run, which may run any
 * program) needs its first process instead: still there and, on Linux,
 * the very process recorded (its start in clock ticks), elsewhere one
 * that started at most 2 s after the record. A test run whose first
 * process has exited is left alone. Clears the file afterwards.
 */
export async function reapOrphanedAgents(
  file: string,
  opts: { graceMs?: number } = {},
): Promise<ReapResult> {
  const result: ReapResult = { terminated: [], killed: [], skipped: [] };
  if (process.platform === "win32") return result;
  const recorded = readChildren(file);
  if (!recorded.length) return result;
  const bootTime = Date.now() - os.uptime() * 1000;
  const groups = processGroups();
  for (const child of recorded) {
    // Zombies and exited processes have no command line left.
    const members = (groups.get(child.pgid) ?? []).filter(
      (member) => member.argv.length > 0,
    );
    if (!members.length) continue;
    const startedAt = Date.parse(child.startedAt ?? "");
    const leader = members.find((member) => member.pid === child.pgid);
    // Recorded at command()'s request: a test run, with no agent to look for.
    const requested =
      child.executable !== undefined && !isAgentExecutable(child.executable);
    if (
      child.pgid <= 1 ||
      !Number.isFinite(startedAt) ||
      // Recorded before this boot: that group is long gone, the pid reused.
      startedAt < bootTime - 120_000 ||
      // The group's first process started after BELL PR recorded the
      // group, so its pid was reused for a new group.
      (leader?.startedAt !== undefined && leader.startedAt > startedAt + reusedAfterMs) ||
      members.some((member) => member.pid === process.pid) ||
      (requested
        ? !sameTestRun(child, startedAt, leader)
        : !members.some((member) => isAgentCommand(member.argv)))
    ) {
      result.skipped.push(child);
      log.warn("Left a recorded process group alone: it is not a leftover agent", {
        pgid: child.pgid,
        executable: child.executable,
      });
      continue;
    }
    if (signalGroup(child.pgid, "SIGTERM")) {
      result.terminated.push(child);
      log.info("Stopping an agent process left by an earlier BELL PR", {
        pgid: child.pgid,
        executable: child.executable,
        startedAt: child.startedAt,
      });
    }
  }
  if (result.terminated.length) {
    await sleep(opts.graceMs ?? 1500);
    for (const child of result.terminated) {
      if (groupAlive(child.pgid) && signalGroup(child.pgid, "SIGKILL")) {
        result.killed.push(child);
        log.warn("Killed an agent process that ignored SIGTERM", {
          pgid: child.pgid,
          executable: child.executable,
        });
      }
    }
  }
  try {
    writeChildren(file, []);
  } catch (error) {
    log.warn("Could not clear the list of agent processes", { file, error });
  }
  return result;
}
