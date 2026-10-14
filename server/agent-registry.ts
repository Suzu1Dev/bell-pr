/**
 * Agent CLI processes that outlive BELL PR.
 *
 * Every agent CLI (codex, claude) runs in its own process group. While
 * BELL PR runs, AgentRegistry records the live groups in
 * `<dataDir>/children.json` (0600). If BELL PR crashes or is killed, those
 * agents keep running and editing worktrees; at the next start,
 * reapOrphanedAgents stops the recorded groups that are still alive, before
 * the store marks their runs failed.
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
import { setSpawnObserver, type SpawnObserver } from "./process.js";

/**
 * One recorded process group. Like every persisted file, every field but
 * the group id is optional, and the file is read leniently, so a newer
 * build's file still loads. This build always writes all of them.
 */
export const childSchema = z.object({
  /** The process group, which is the pid of the detached agent CLI. */
  pgid: z.number().int().positive(),
  /** codex or claude. */
  executable: z.string().min(1).max(200).optional(),
  /** When BELL PR started it (ISO). */
  startedAt: z.string().min(1).max(40).optional(),
});
const childrenSchema = z.object({
  version: z.number().int().positive().optional(),
  // Entries are checked one by one, so one bad entry does not hide the rest.
  children: z.array(z.unknown()).max(1000).optional(),
});
const childReadSchema = lenientRead(childSchema);
const childrenReadSchema = lenientRead(childrenSchema);

export type AgentChild = Required<z.infer<typeof childSchema>>;
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
 * children.json, and removes each group when its process exits. Writes are
 * synchronous, so the file is current at the moment of a crash.
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

  onSpawn(pid: number, executable: string): void {
    if (!isAgentExecutable(executable)) return;
    this.children.set(pid, {
      pgid: pid,
      executable: path.basename(executable),
      startedAt: new Date().toISOString(),
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
}

/** Every process by process group, from /proc on Linux and `ps` elsewhere. */
function processGroups(): Map<number, GroupProcess[]> {
  const groups = new Map<number, GroupProcess[]>();
  const add = (pgid: number, member: GroupProcess) =>
    groups.set(pgid, [...(groups.get(pgid) ?? []), member]);
  if (process.platform === "linux") {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
        // "pid (comm) state ppid pgrp ..."; comm may contain spaces and parentheses.
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        const argv = readFileSync(`/proc/${entry}/cmdline`, "utf8")
          .split("\0")
          .filter(Boolean);
        add(Number(fields[2]), { pid: Number(entry), argv });
      } catch {
        // The process exited while we looked.
      }
    }
    return groups;
  }
  const ps = spawnSync("ps", ["-A", "-o", "pid=,pgid=,command="], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  });
  for (const line of ps.stdout?.split("\n") ?? []) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match)
      add(Number(match[2]), {
        pid: Number(match[1]),
        argv: match[3].trim().split(/\s+/),
      });
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

export interface ReapResult {
  /** Groups sent SIGTERM. */
  terminated: RecordedChild[];
  /** Groups that were still alive after the grace period and got SIGKILL. */
  killed: RecordedChild[];
  /**
   * Recorded groups left alone: from an earlier boot (or no start time), or
   * no longer running an agent CLI.
   */
  skipped: RecordedChild[];
}

/**
 * Stops the agent process groups that a previous BELL PR recorded in
 * children.json and that are still alive: SIGTERM, then SIGKILL after
 * `graceMs` (1.5 s) for the groups that did not exit. A group is only
 * signalled when one of its processes runs codex or claude, none of them is
 * this process, and it was recorded during the current boot, so a reused
 * pid is never hit. Clears the file afterwards.
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
    if (
      child.pgid <= 1 ||
      !Number.isFinite(startedAt) ||
      // Recorded before this boot: that group is long gone, the pid reused.
      startedAt < bootTime - 120_000 ||
      members.some((member) => member.pid === process.pid) ||
      !members.some((member) => isAgentCommand(member.argv))
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
