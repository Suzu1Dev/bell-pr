/** Project coordination: claims on files, dependencies and integration. */
export default {
  /** The coordination file in the data directory. */
  store: {
    notSingleWriter:
      "Coordination needs this process to hold the data directory's lock, so nothing else writes its claims.",
    missing:
      "The coordination file is missing. Claims are not assumed free: restore it, or set coordination up again.",
    exists: "A coordination file already exists in this data directory.",
    damaged:
      "The coordination file cannot be read or is not consistent, so no claim is granted until it is repaired.",
    unavailable:
      "Coordination stopped after a write failed. Restart BELL PR so it reads the claims back from disk.",
    full: "Coordination has no room for this change. Claims already held can still be released, revoked and integrated.",
  },
  /** An interrupted integration that opening could not settle from the branch. */
  recovery: {
    undecided: ({ project }: { project: string }) =>
      `An integration into ${project} was interrupted, and its branch no longer shows whether it finished. ${project} takes no changes until an admin settles it; other projects are unaffected.`,
    nothingToSettle: "This project has no interrupted integration waiting to be settled.",
    stalePending:
      "The project is waiting on a different interrupted integration than the one named. Read the project again.",
    branchElsewhere: ({ current }: { current: string }) =>
      `The integration branch is at ${current}, neither the interrupted integration's base nor its change, so it cannot be settled. Repair the branch by hand first.`,
    branchUnreadable:
      "The integration branch cannot be read, so the interrupted integration cannot be settled.",
  },
  participant: {
    unauthenticated: "This request carries no valid participant token.",
    exists: ({ id }: { id: string }) => `A participant ${id} already exists.`,
    adminOnly: "Only a coordination admin can do this.",
  },
  invalidId: ({ id }: { id: string }) =>
    `"${id}" is not a usable id: use 1 to 64 letters, digits, ".", "_" or "-", starting with a letter or digit.`,
  project: {
    unknown: ({ project }: { project: string }) => `There is no project ${project}.`,
    exists: ({ project }: { project: string }) => `A project ${project} already exists.`,
    invalidBaseline:
      "The integration branch must be an existing branch of a bare Git repository.",
    branchTaken: "Another project already integrates into this branch.",
  },
  task: {
    unknown: ({ task }: { task: string }) => `There is no task ${task} in this project.`,
    exists: ({ task }: { task: string }) => `A task ${task} already exists in this project.`,
    closed: ({ task }: { task: string }) =>
      `Task ${task} is already integrated or failed, so it takes no new claims.`,
    claimed: ({ task }: { task: string }) => `Task ${task} already has an active claim.`,
    dependencyUnknown: ({ task }: { task: string }) =>
      `This task depends on ${task}, which does not exist.`,
    dependencyFailed: ({ task }: { task: string }) =>
      `This task depends on ${task}, which failed, so it cannot start.`,
    dependencyPending: ({ task }: { task: string }) =>
      `This task depends on ${task}, which is not integrated yet.`,
    notFailable: "Only the holder of the task's claim or an admin can mark it failed.",
    notFailed: ({ task }: { task: string }) =>
      `Task ${task} has not failed, so there is nothing to reopen: an open task is already open, and an integrated task never reopens.`,
    tooManyDependencies: "A task depends on at most 50 other tasks.",
  },
  claim: {
    invalidScope: ({ scope }: { scope: string }) =>
      `The scope "${scope}" cannot be compared reliably with other paths, so it cannot be claimed. Use a printable ASCII path inside the repository.`,
    tooManyScopes: "A claim holds at most 200 scopes.",
    conflict:
      "Another active claim holds a file in these scopes, so nothing was claimed or changed.",
    unknown: "There is no such claim in this project.",
    ended: "This claim was released, revoked or integrated, so it authorises nothing.",
    notHolder: "Only the participant holding this claim can do this.",
    staleFence:
      "This authorisation is out of date: the claim's fence has changed. Read the claim again.",
    outOfScope: ({ path }: { path: string }) => `${path} is outside this claim's scopes.`,
    unreliablePath: ({ path }: { path: string }) =>
      `${path} cannot be compared with claims, so it is not accepted.`,
  },
  integration: {
    invalidCommit: "Give the full commit id of the base and of the change.",
    empty: "The change has no commits on top of the base.",
    unknownCommit: "The integration repository does not have this commit.",
    notFastForward: "The change does not build on the expected base.",
    mergeCommit: "The change contains a merge commit; integrate a linear series of commits.",
    tooManyCommits: "The change has more than 200 commits; integrate it in smaller parts.",
    staleBase: ({ current }: { current: string }) =>
      `The integration branch moved on to ${current}. Sync your change onto it and try again.`,
    baselineMoved:
      "The integration branch was changed outside coordination, so nothing is integrated until someone checks it.",
    branchBusy:
      "The integration branch could not be updated just now, so nothing was integrated. Try again.",
    needsManualHandling: ({ path }: { path: string }) =>
      `${path} needs manual handling: coordination does not integrate secrets, symbolic links, submodules or other special files.`,
    unreadableChange:
      "The files this change touches could not be read reliably, so nothing was integrated.",
  },
};
