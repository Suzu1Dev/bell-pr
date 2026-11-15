/**
 * Automatic holds (docs/group-work.md#automatic-holds). Once a turn of BELL
 * PR's agents has changed a run's checkout, or a teammate's change has joined
 * it, and the check against other people's holds has passed, the lines and
 * files the run changed are held in the run's name for its first owner still
 * in the group. The board and the live feed show them, and other people's
 * agents and publishes keep off them as off any hold. Nobody types a path.
 *
 * The hold only grows (`expand`: one step, and a conflict changes nothing).
 * It ends when the run publishes, is deleted or its working files are
 * freed. Best effort: a hold that cannot be taken leaves a notice in the
 * run's log, and the check at publish still counts.
 */
import { dropHoldEntries, taskKey } from "./collab-board.js";
import { collabId, sideEntry, type CollabHost } from "./collab-host.js";
import { sm } from "./i18n/index.js";
import { log } from "./log.js";
import { baseScopePath, claimableScope, foldPath, pathsMeet, splitScope } from "./scope-paths.js";
import type { Run } from "./types.js";

/** As many paths as one hold a person takes may have (maxPaths in routes/collab-board.ts); past it, whole files. */
const maxAutoScopes = 50;
/** The side file's limit for a task's title (collab-host.ts). */
const maxTitle = 120;

export interface AutoHolds {
  /** Holds `scopes` for the run; the notice for its log, if any. */
  keep(run: Run, scopes: readonly string[]): Promise<string | undefined>;
  /** Releases the run's automatic hold, if it still has one. */
  end(run: Run): Promise<void>;
}

/** Whether `held` already holds all of `wanted`: the same file or a folder above it, and the whole line range. */
function covers(held: string, wanted: string) {
  const h = splitScope(held);
  const w = splitScope(wanted);
  const [hp, wp] = [foldPath(h.path).replace(/\/+$/, ""), foldPath(w.path)];
  if (hp !== wp && !wp.startsWith(`${hp}/`)) return false;
  if (h.start === undefined) return true;
  return hp === wp && w.start !== undefined && h.start <= w.start && w.end! <= h.end!;
}

export function autoHolds(host: CollabHost): AutoHolds {
  return {
    async keep(run, scopes) {
      if (host.status().state !== "ready") return undefined;
      const side = host.side();
      const projectId = Object.entries(side.projects ?? {}).find(([, project]) => project.repoId === run.repoId)?.[0];
      const active = (run.owners ?? []).filter((id) => {
        const person = sideEntry(side.people, id);
        return person && !person.removedAt && !person.disabledAt;
      });
      const holder = active[0];
      if (!projectId || !holder) return undefined;
      try {
        return await host.run(async () => {
          const coordinator = host.coordinator();
          const held = coordinator.claimsForHost(projectId).filter((claim) => claim.status === "held");
          const mine = held.find((claim) => claim.id === run.autoHold?.claimId && claim.holder === holder);
          // The owners' own holds count against a new one too: what they already hold is left to them.
          const own = held.filter((claim) => claim !== mine && active.includes(claim.holder)).flatMap((claim) => claim.scopes);
          const fresh = (list: readonly string[]) =>
            [...new Set(list)].filter(
              (scope) => !mine?.scopes.some((have) => covers(have, scope)) && !own.some((have) => pathsMeet(have, scope)),
            );
          let add = fresh(scopes.flatMap((scope) => claimableScope(scope) ?? []));
          if ((mine?.scopes.length ?? 0) + add.length > maxAutoScopes) add = fresh(add.map(baseScopePath));
          if (!add.length) return undefined;
          const actor = coordinator.actorForHost(holder);
          if (mine) await coordinator.expand(actor, projectId, mine.id, { fence: mine.fence, scopes: add });
          else {
            const taskId = collabId("t");
            const key = taskKey(projectId, taskId);
            const name = run.title.replace(/[\p{Cc}‪-‮⁦-⁩]/gu, " ").trim() || run.id;
            await coordinator.defineTask(actor, projectId, { id: taskId });
            await host.saveSide((draft) => {
              (draft.tasks ??= {})[key] = { title: sm().run.local.keptTitle({ title: name }).slice(0, maxTitle) };
            });
            const claim = await coordinator.claim(actor, projectId, { taskId, scopes: add });
            run.autoHold = { projectId, claimId: claim.id };
            // Commits on the target branch since the run's base are reported to the holder (S4).
            if (run.baseSha) await host.saveSide((draft) => void ((draft.holds ??= {})[key] = run.baseSha!));
          }
          return sm().run.local.keptForGroup({ scopes: add });
        }, projectId);
      } catch (error) {
        return sm().run.local.keptForGroupFailed({ reason: error instanceof Error ? error.message : String(error) });
      }
    },
    async end(run) {
      const auto = run.autoHold;
      if (!auto || host.status().state !== "ready") return;
      try {
        await host.run(async () => {
          const coordinator = host.coordinator();
          const claim = coordinator.claimsForHost(auto.projectId).find((item) => item.id === auto.claimId);
          // Released by hand or revoked already: nothing to do.
          if (claim?.status !== "held") return;
          await coordinator.release(coordinator.actorForHost(claim.holder), auto.projectId, claim.id, { fence: claim.fence });
          const key = taskKey(auto.projectId, claim.taskId);
          if (sideEntry(host.side().holds, key) !== undefined) await host.saveSide((draft) => dropHoldEntries(draft, [key]));
        }, auto.projectId);
        delete run.autoHold;
      } catch (error) {
        // Kept on the run, so deleting it later tries again; the holder can release it on the Group page.
        log.warn("auto_hold.release_failed", { runId: run.id, error: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}
