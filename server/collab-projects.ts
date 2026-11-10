/**
 * The group's repositories. Adding one makes group work its own bare copy
 * of the repository's default branch, `<data>/collab/<project id>.git`, and
 * defines the coordinator's project on that copy: the coordinator never
 * works in a person's checkout or in BELL's clone.
 *
 * The side file keeps each project's name, so a repository deleted from
 * BELL PR later stays one of the group's under the name it had.
 */
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { CollabProject, CollabProjectsResponse } from "../shared/collab.js";
import { collabId, collabNotReady, type CollabHost } from "./collab-host.js";
import { reasonOf, refuse } from "./collab-refusal.js";
import { dataPaths } from "./config.js";
import { coordinationLimits } from "./coordination.js";
import { log } from "./log.js";
import { git } from "./process.js";
import type { Store } from "./store.js";
import { AppError } from "./types.js";

export class CollabProjects {
  /** The repositories being copied now, by id: asked for again meanwhile, one is refused. */
  private readonly adding = new Set<string>();
  /** Ends the copies under way. */
  private stopping = new AbortController();

  constructor(
    private readonly host: CollabHost,
    private readonly store: Store,
  ) {}

  /** The group's repositories, in the order they were added. */
  list(): CollabProject[] {
    return Object.entries(this.host.side().projects ?? {}).map(([id, project]) => ({
      id,
      name: project.name ?? id,
    }));
  }

  private added(repoId: string) {
    return (
      this.adding.has(repoId) ||
      Object.values(this.host.side().projects ?? {}).some((project) => project.repoId === repoId)
    );
  }

  /** The repositories of this BELL PR that can still be added: a git repository with its default branch. */
  async addable(): Promise<NonNullable<CollabProjectsResponse["addable"]>> {
    const found: { repoId: string; name: string }[] = [];
    for (const repo of this.store.data.repos) {
      if (this.added(repo.id)) continue;
      const ref = `refs/heads/${repo.defaultBranch}`;
      const copyable = await git(
        repo.path,
        ["rev-parse", "--verify", "--quiet", "--end-of-options", ref],
        { timeoutMs: 10_000 },
      ).then(
        () => true,
        () => false,
      );
      if (copyable) found.push({ repoId: repo.id, name: repo.fullName });
    }
    return found;
  }

  /** How full the coordinator's file is, in bytes; undefined when it cannot be read. */
  async storage(): Promise<CollabProjectsResponse["storage"]> {
    const used = await stat(dataPaths(this.store.directory).coordination).then(
      (file) => file.size,
      () => undefined,
    );
    return used === undefined ? undefined : { used, max: coordinationLimits.bytes };
  }

  /**
   * Adds a repository of this BELL PR to the group: 400 `unknownRepository`,
   * 409 `alreadyAdded`, and `cloneFailed` (504 when the copy took too long,
   * else 500) when the copy or the project cannot be made. A failure leaves
   * no folder and no entry behind.
   */
  async add(repoId: string): Promise<CollabProject> {
    const repo = this.store.data.repos.find((candidate) => candidate.id === repoId);
    if (!repo) throw refuse(400, "unknownRepository", (m) => m.collab.unknownRepository);
    if (this.added(repoId)) throw refuse(409, "alreadyAdded", (m) => m.collab.alreadyAdded);
    const id = collabId("p");
    const target = path.join(dataPaths(this.store.directory).collabRepos, `${id}.git`);
    this.adding.add(repoId);
    try {
      return await this.host.run(async () => {
        try {
          await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
          await git(
            path.dirname(target),
            [
              "clone",
              "--bare",
              "--no-hardlinks",
              "--single-branch",
              "--no-tags",
              "--branch",
              repo.defaultBranch,
              "--",
              repo.path,
              target,
            ],
            // The time limit of BELL's own copy of a local repository (repositories.ts).
            { timeoutMs: 180_000, maxBytes: 1_000_000, signal: this.stopping.signal },
          );
          await this.host.coordinator().defineProject(id, target, repo.defaultBranch);
          await this.host.saveSide((draft) => {
            (draft.projects ??= {})[id] = {
              name: repo.fullName,
              repoId,
              addedAt: new Date().toISOString(),
            };
          });
        } catch (error) {
          await rm(target, { recursive: true, force: true });
          throw this.refusal(error, id, repoId);
        }
        return { id, name: repo.fullName };
      }, id);
    } finally {
      this.adding.delete(repoId);
    }
  }

  /**
   * What the person hears of a failed add. Git's words can name a folder of
   * this computer, so they go to the log on the host and no further.
   */
  private refusal(error: unknown, project: string, repoId: string) {
    const { state } = this.host.status();
    if (state !== "ready") return collabNotReady(state);
    if (reasonOf(error) === "full") return error;
    log.warn("Group work could not copy a repository", { project, repoId, error });
    // command() stops a command that runs too long with a 504.
    const tookTooLong = error instanceof AppError && error.statusCode === 504;
    return refuse(tookTooLong ? 504 : 500, "cloneFailed", (m) => m.collab.cloneFailed);
  }

  /** Group work is stopping: a copy under way ends now, so nothing waits for it. */
  stop() {
    this.stopping.abort();
    this.stopping = new AbortController();
  }
}
