/** Group work (#/group): who holds which paths of a repository (English). */
import { product } from "../../../shared/product";

interface Held {
  name: string;
  paths: string;
  title: string;
  /** Left out when the board in hand does not have the hold. */
  time?: string;
}

interface DependencyLine {
  holder: string;
  askedPath: string;
  heldPath: string;
  title: string;
}

const collab = {
  eyebrow: "GROUP WORK",
  title: "Who holds which paths?",
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
  manageMembers: "Members",
  myAccount: "Account",
  startWork: "Start work",
  holdTitle: "Title",
  shownOnBoard: "shown on the board",
  paths: "Paths",
  onePerLine: "one per line",
  takeHold: "Take hold",
  pathsHelp:
    "Holding a folder holds everything inside it. Add #L10-L45 to hold only that line range so teammates can edit other parts of the same file concurrently. Letter case is ignored.",
  free: `No one holds these paths, as far as ${product.name} checked`,
  holds: ({ name, paths, title, time }: Held) =>
    `${name} holds ${paths} — ${title}${time ? `, since ${time}` : ""}`,
  youHold: ({ name, paths, title, time }: Held) =>
    `${name} hold ${paths} — ${title}${time ? `, since ${time}` : ""}`,
  dependencyBlock: ({ holder, askedPath, heldPath, title }: DependencyLine) =>
    `Dependency guard: ${askedPath} depends on ${heldPath}, held by ${holder} — ${title}`,
  dependencyWarn: ({ holder, askedPath, heldPath, title }: DependencyLine) =>
    `Dependency warning: ${askedPath} depends on ${heldPath}, held by ${holder} — ${title}`,
  /** Opens the answer after a refused hold; `then` is its first sentence. */
  notTaken: ({ then }: { then: string }) => `Not taken. ${then}`,
  cannotHold: ({ paths }: { paths: string }) => `Cannot be held: ${paths}`,
  heldNow: "Held now",
  me: "You",
  since: ({ time }: { time: string }) => `since ${time}`,
  gone: "No longer held",
  dependsOn: {
    label: "Must finish first",
    help: "Choose up to 50 tasks in this project that must finish before yours starts.",
    empty: "No other tasks in this project yet. You can start right away.",
    selectedCount: ({ count }: { count: number }) => `${count} selected`,
    clear: "Clear",
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
    `${product.name} refuses overlapping holds (#Lstart-Lend ranges and guarded dependencies included), won't publish changes to others' held paths, and stops a run whose Agent changes one (the change stays in the working directory). It can't block editors, terminal tools or direct git pushes.`,
  join: {
    title: "Join this group",
    body: "Ask an admin of this group for an invite code, or sign in with your team account.",
    code: "Invite code",
    submit: "Join",
  },
  auth: {
    tabsLabel: "Join or sign in",
    inviteTab: "Invite code",
    loginTab: "Team account",
    tailscaleTab: "Tailscale",
    loginTitle: "Sign in to team collaboration",
    loginBody: "Use your team username and password to access holds, live progress and review records.",
    tailscaleTitle: "Sign in with Tailscale",
    tailscaleBody: "Authenticate with the Tailscale identity verified by the host's local proxy.",
    tailscaleDetected: ({ login }: { login: string }) => `Detected Tailscale identity: ${login}`,
    optionalAccount: "Create a reusable username & password (optional)",
    username: "Username",
    usernamePlaceholder: "3–32 lowercase letters, numbers, ., _ or -",
    password: "Password",
    passwordPlaceholder: "At least 8 characters",
    inviteOptional: "Invite code (first-time link only)",
    loginSubmit: "Sign in",
    tailscaleSubmit: "Sign in with Tailscale",
  },
  liveProgress: {
    title: "Live team activity",
    subtitle: "What teammates are working on and inspecting right now.",
    empty: "No active workspace sessions reported in the last few minutes.",
    views: {
      group: "Group board",
      workspace: "Workspace",
      changes: "Code changes",
      review: "Review",
      draft: "PR draft",
      publish: "Publish preview",
    },
    inspectingFile: ({ path }: { path: string }) => `Viewing ${path}`,
    inspectingLines: ({ path, start, end }: { path: string; start: number; end: number }) =>
      start === end ? `Viewing ${path} · L${start}` : `Viewing ${path} · L${start}–L${end}`,
    openRun: "Open run",
  },
  depPanel: {
    title: "Cross-file dependency guards",
    subtitle: "Mark files that depend on each other so concurrent edits warn or block before conflicts happen.",
    empty: "No manual dependency rules yet. Add one below or scan static imports.",
    fromLabel: "Dependent file or folder",
    fromPlaceholder: "e.g. src/routes/users.ts",
    toLabel: "Target dependency",
    toPlaceholder: "e.g. shared/user-schema.ts",
    modeLabel: "Protection",
    modeBlock: "Guard (block conflicting holds & Agent edits)",
    modeWarn: "Warning (remind & confirm before publish)",
    badgeBlock: "Guard",
    badgeWarn: "Warn",
    badgeAuto: "Auto import",
    noteLabel: "Reason (optional)",
    notePlaceholder: "e.g. Shares request contract",
    addSubmit: "Add dependency rule",
    remove: "Remove",
    scan: "Scan imports",
    scanning: "Scanning…",
    scannedTitle: ({ count }: { count: number }) => `Detected relative imports (${count})`,
    scannedEmpty: "No relative imports detected or all are already covered by rules.",
    promoteBlock: "Guard",
    promoteWarn: "Warn",
    arrow: "depends on",
  },
  todoPanel: {
    title: "Team handoff TODOs",
    subtitle: "Open items teammates tagged on runs for follow-up or coordination.",
    empty: "No open handoff TODOs across active runs in this repository.",
    assignedTo: ({ name }: { name: string }) => `For ${name}`,
    byAuthor: ({ name }: { name: string }) => `by ${name}`,
    openRun: "Open in workspace",
  },
  accountDialog: {
    title: "My team account",
    subtitle: "Set or update a username and password so you can sign in from any browser over VPN or Tailscale.",
    saved: "Account updated.",
    save: "Save account",
  },
  adminDialog: {
    title: "Manage team members",
    subtitle: "Create accounts, assign admin roles, link Tailscale logins or disable access.",
    createHeading: "Create member account",
    displayName: "Display name",
    roleAdmin: "Admin",
    roleMember: "Member",
    tailscaleLabel: "Tailscale login (optional)",
    tailscalePlaceholder: "e.g. user@example.com",
    createSubmit: "Create member",
    membersHeading: "Members",
    disabledBadge: "Disabled",
    makeAdmin: "Make admin",
    makeMember: "Make member",
    disable: "Disable",
    enable: "Enable",
    remove: "Remove",
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
    adminHelp: "Can invite people, manage accounts, add repositories and revoke holds.",
    create: "Create code",
    codeFor: ({ name }: { name: string }) => `Invite code for ${name}`,
    member: ({ name, time }: { name: string; time: string }) =>
      `${name} types it on the Group or Pair page of this ${product.name} and joins as a member. It works once and stops working at ${time}.`,
    asAdmin: ({ name, time }: { name: string; time: string }) =>
      `${name} types it on the Group or Pair page of this ${product.name} and joins as an admin. It works once and stops working at ${time}.`,
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
