/** Group work (#/group): who holds which paths of a repository (English). */
import { product } from "../../../shared/product";

interface Held {
  name: string;
  paths: string;
  title: string;
  /** Left out when the board in hand does not have the hold. */
  time?: string;
}

const collab = {
  eyebrow: "GROUP WORK",
  title: "Who holds what?",
  live: "Live",
  polling: "Updating every 10 s",
  reconnecting: "Reconnecting",
  asOf: ({ time }: { time: string }) => `as of ${time}`,
  answerAsOf: ({ time }: { time: string }) =>
    `as of ${time} · this answer updates by itself`,
  repository: "Repository",
  addARepository: "Add a repository",
  addRepository: "Add repository",
  adding: "Adding… a large repository can take a few minutes.",
  people: "People in this group",
  viewing: ({ name }: { name: string }) => `${name} · viewing now`,
  you: ({ name }: { name: string }) => `${name} (you)`,
  invite: "Invite",
  startWork: "Start work",
  holdTitle: "Title",
  shownOnBoard: "shown on the board",
  paths: "Paths",
  onePerLine: "one per line",
  takeHold: "Take hold",
  pathsHelp: "A folder holds everything inside it. Letter case is ignored.",
  free: "Nothing in the way, in what BELL checked",
  holds: ({ name, paths, title, time }: Held) =>
    `${name} holds ${paths} — ${title}${time ? `, since ${time}` : ""}`,
  youHold: ({ name, paths, title, time }: Held) =>
    `${name} hold ${paths} — ${title}${time ? `, since ${time}` : ""}`,
  /** Opens the answer after a refused hold; `then` is its first sentence. */
  notTaken: ({ then }: { then: string }) => `Not taken. ${then}`,
  cannotHold: ({ paths }: { paths: string }) => `Cannot be held: ${paths}`,
  heldNow: "Held now",
  me: "You",
  since: ({ time }: { time: string }) => `since ${time}`,
  gone: "No longer held",
  dependsOn: {
    label: "Must finish first",
    help: "Choose tasks in this project that must finish before yours starts.",
    empty: "No other tasks in this project yet. You can start right away.",
    selectedCount: ({ count }: { count: number }) => `${count} selected`,
    clear: "Clear",
    limitNote: "You can choose up to 50 tasks.",
    cardNote: ({ titles }: { titles: string }) => `Started after ${titles}`,
  },
  release: {
    finish: "Finish & release",
    finishAria: ({ title }: { title: string }) => `Mark ${title} finished and release its held paths`,
    unfinished: "Release only",
    unfinishedAria: ({ title }: { title: string }) => `Release held paths for ${title} without marking it finished`,
    finishHint: "Finish & release unblocks waiting tasks; Release only keeps them waiting.",
  },
  revoke: "Revoke",
  revokeHold: ({ title }: { title: string }) => `Revoke ${title}`,
  revokeQuestion: ({ name, title }: { name: string; title: string }) =>
    `Revoke ${name}'s hold “${title}”? Its paths can then be taken by anyone.`,
  keep: "Keep it",
  nothingHeld: ({ time }: { time: string }) => `Nothing is held, as of ${time}.`,
  honesty:
    "BELL blocks overlapping holds and stops BELL PR runs, syncs, and publishes from touching paths held by someone else. It cannot stop external editors, terminal tools, a direct git push, or renaming a parent folder outside a hold.",
  join: {
    title: "Join this group",
    body: "Ask an admin of this group for an invite code. A code works once, for 10 minutes.",
    code: "Invite code",
    submit: "Join",
  },
  host: {
    title: "Start group work here",
    body: `This is the computer that runs ${product.name}. You join as an admin and can invite the others.`,
    name: "Your name",
    submit: "Start group work",
  },
  setUpAtHost: `Group work is set up at the computer that runs ${product.name}.`,
  firstRepository:
    "Holds are taken on the paths of one repository. Choose the first one for this group.",
  nothingToAdd: "No repository to add yet. Import one on the Repositories page first.",
  noRepository: "No repository in this group yet. An admin adds one.",
  stopped: {
    title: "Group work has stopped.",
    body: `Restart ${product.name} on the host. Nothing is treated as free.`,
  },
  off: {
    title: `Group work is off for this ${product.name}.`,
    body: `To turn it on, start ${product.name} with this line on the computer that runs it.`,
  },
  inviteDialog: {
    title: "Invite someone",
    name: "Name",
    admin: "Admin",
    adminHelp: "Can invite people, add repositories and revoke holds.",
    create: "Create code",
    codeFor: ({ name }: { name: string }) => `Invite code for ${name}`,
    member: ({ name, time }: { name: string; time: string }) =>
      `${name} types it on the Group page of this ${product.name} and joins as a member. It works once and stops working at ${time}.`,
    asAdmin: ({ name, time }: { name: string; time: string }) =>
      `${name} types it on the Group page of this ${product.name} and joins as an admin. It works once and stops working at ${time}.`,
    done: "Done",
    copy: "Copy the invite code",
  },
  /** What the live region says: one sentence for each batch of changes. */
  spoken: {
    took: ({ name, paths, title }: { name: string; paths: string; title: string }) =>
      `${name} took ${paths} for ${title}.`,
    youTook: ({ paths, title }: { paths: string; title: string }) =>
      `You took ${paths} for ${title}.`,
    ended: ({ paths, title }: { paths: string; title: string }) =>
      `No longer held: ${paths} (${title}).`,
    changed: ({ count }: { count: number }) => `The board changed. Held now: ${count}.`,
    finishedAndReleased: ({ title, paths }: { title: string; paths: string }) =>
      `Finished ${title} and released ${paths}. Waiting tasks can now start.`,
    releasedUnfinished: ({ title, paths }: { title: string; paths: string }) =>
      `Released ${paths} without finishing ${title}. Waiting tasks stay on hold.`,
    sentence: ({ text }: { text: string }) => `${text}.`,
  },
};

export default collab;
