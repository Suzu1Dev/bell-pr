/**
 * The PR draft tab's panels (English): syncing with the target branch and
 * the rounds of changes made after maintainer review. Messages whose
 * parameters are elements (a `<code>` branch name, a link) are rendered with
 * `rich()` from src/draft/rich.tsx.
 */
import type { FollowUpRound } from "../../../shared/followups";

const draft = {
  /** SyncPanel: where the contribution stands against its target branch. */
  sync: {
    title: "Target branch",
    intro: {
      published: ({ branch, commit }: { branch: string; commit: string }) =>
        `This contribution is based on ${branch} at ${commit}. Syncing merges the latest version into the PR: after your review a merge commit is pushed, nothing is force-pushed and the PR description stays the same.`,
      unpublished: ({ branch, commit }: { branch: string; commit: string }) =>
        `This contribution is based on ${branch} at ${commit}. Syncing moves these changes onto the latest version; files that the target branch changed need another review, and you can undo the sync.`,
    },
    lastSync: ({ from, to, date }: { from: string; to: string; date: string }) =>
      `Last sync: ${from} to ${to}, ${date}`,
    waitConflicts:
      "Resolve the conflicts from the last sync before you sync again.",
    waitStatus:
      "Only runs in review, approved or waiting for plan approval can sync to the latest target branch.",
    roundOpen:
      "A follow-up round is in progress on this PR; finish or discard it before you sync.",
    sync: "Sync to the latest target branch",
    undo: "Undo sync",
    conflicts: "Merge conflicts",
    resolved: "resolved",
    conflictHelp: {
      published: ({ latest, ours }: { latest: string; ours: string }) =>
        `In each file, the side marked ${latest} is the target branch's current content and the side marked ${ours} is this pull request. You cannot approve until every conflict marker is removed: edit the files in the working directory yourself and then refresh the diff on the Code changes tab, or ask the agent to resolve them. Changed files still need a file-by-file review.`,
      unpublished: ({ latest, ours }: { latest: string; ours: string }) =>
        `In each file, the side marked ${latest} is the target branch's current content and the side marked ${ours} is this contribution. You cannot approve until every conflict marker is removed: edit the files in the working directory yourself and then refresh the diff on the Code changes tab, or ask the agent to resolve them. Changed files still need a file-by-file review.`,
    },
    allResolved:
      "All conflict markers are removed; changed files still need a file-by-file review.",
    resolving: "The agent is resolving the conflicts…",
    resolve: "Ask the agent to resolve the conflicts",
  },
  /** FollowUpRounds: the rounds of changes after maintainer review. */
  followUps: {
    title: "Changes made after review",
    intro:
      "Each round you review and approve becomes a new commit on the PR branch. The PR title and description stay as they are, and you still reply to reviewers on GitHub yourself.",
    status: {
      running: "Making changes",
      review: "Waiting for review and push",
      published: "Pushed",
      failed: "Not completed",
      cancelled: "Stopped",
      discarded: "Discarded",
    } satisfies Record<FollowUpRound["status"], string>,
    round: ({ number }: { number: number }) => `Round ${number}`,
    /** Follows the round number for commits made on GitHub that the app took over. */
    adopted: "Picked up from GitHub",
    /** Follows the round number for a round that merged the target branch. */
    syncRound: "Target branch sync",
    /** Names an item that came from the person's own note rather than a review. */
    yourNote: "Your note",
    /** Names a review item that is no longer in the latest feedback. */
    feedback: "Feedback",
    note: ({ note }: { note: string }) => `Your note: ${note}`,
    conflicts: "Merge conflicts",
    addressed: "Addressed",
    notAddressed: "Not changed; needs your judgement",
    checks: "Commands that actually ran",
    pushed: ({ commit, date }: { commit: string; date: string }) =>
      `${commit} pushed ${date}`,
    notPushed: ({ commit }: { commit: string }) =>
      `${commit} created; the push is not confirmed yet`,
    discard: "Discard this round",
  },
};

export default draft;
