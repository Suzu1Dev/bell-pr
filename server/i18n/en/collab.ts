import { product } from "../../../shared/product.js";

const name = product.name;
const bin = product.binNames[0];

/** Group work: the people who share one running BELL PR (collab-host.ts, routes/collab.ts). */
export default {
  notSetUp: `Group work is not set up yet on this ${name}.`,
  stopped: `Group work has stopped. Fix the cause on the host (\`${bin} group status\` or the log on the host names it), then restart ${name}.`,
  hostOnly: `Only the computer that runs ${name} can set group work up.`,
  notJoined: "You have not joined this group on this device, or you were removed from it.",
  adminOnly: "Only a group admin can do this.",
  invalidCode: "This invite code is wrong, has expired or was already used.",
  joinLocked: ({ minutes }: { minutes: number }) =>
    `Too many wrong invite codes. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
  tooManyInvites: ({ max, minutes }: { max: number; minutes: number }) =>
    `${max} invite codes are already waiting. Wait until one is used or expires (${minutes} minutes).`,
  removeSelf: "You cannot remove yourself from the group.",
  unknownPerson: "Nobody in this group has this id.",
  unknownRepository: `This ${name} has no repository with this id.`,
  alreadyAdded: "This repository is already one of the group's.",
  cloneFailed: `${name} could not copy the repository for the group. The log on the host has the details.`,
  unknownProject: "The group has no repository with this id.",
  tooManyWaiters: "Too many pages are open on the group's boards. Close one, then try again.",
  slowDown: ({ seconds }: { seconds: number }) =>
    `Too many requests in a short time. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
  invalidScope: ({ max }: { max: number }) =>
    `Name at least one repository file or folder, each path at most ${max} characters. Some can't be held, such as paths outside the repository or with special characters.`,
  tooManyScopes: ({ max }: { max: number }) => `One hold takes at most ${max} paths.`,
  conflict: "Someone already holds a path that overlaps yours. Nothing was held.",
  dependencyUnknown: "This work depends on a task this repository does not have. Nothing was held.",
  dependencyPending: "This work depends on a task that is not done yet. Nothing was held.",
  tooManyDependencies: ({ max }: { max: number }) => `One work request depends on at most ${max} tasks.`,
  full: "The group's record is full. Ask the host to reset group storage.",
  unknownClaim: "This repository has no hold with this id.",
  ended: "This hold has already ended.",
  doneNotSaved:
    "The hold ended, but its task can never be marked done now. Work waiting on it must name another task. See the log on the host.",
  notHolder: "Only the person who holds these paths can release them.",
  staleFence: "This hold has changed since the board was read. Reload the board, then try again.",
  invalidCredentials: "Wrong username or password, or this account is disabled.",
  usernameTaken: "Someone in this group already uses this username.",
  invalidAccountInput:
    "Enter a username of 2 to 32 letters, digits, dots, underscores or hyphens, and a password of 8 to 128 characters.",
  tailscaleUnavailable:
    `Tailscale identity is not available on this connection. Open ${name} through Tailscale Serve with --tailscale-auth enabled, or sign in with a username and password.`,
  tailscaleUnlinked: ({ login }: { login: string }) =>
    `No group account is linked to Tailscale user ${login} yet. Enter an invite code once to link your account, or ask a group admin to bind it.`,
  lastAdmin: "At least one active group admin must remain.",
  dependencyBlocked:
    "Someone holds a file marked as a blocking dependency of your path, so nothing was held.",
  unknownDependency: "This repository has no file dependency rule with this id.",
  atHostName: "Host",
  soloAuthorName: "Developer",
  refused: "Group work refused this request.",
  failed: "Group work could not do this. The log on the host has the details.",
};
