import { product } from "../../../shared/product.js";

const name = product.name;
const bin = product.binNames[0];

/** Group work: the people who share one running BELL PR (collab-host.ts, routes/collab.ts). */
export default {
  notSetUp: `Group work is not set up yet on this ${name}.`,
  stopped: `Group work has stopped. Fix the cause on the host (\`${bin} group status\` or the server log names it), then restart ${name}.`,
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
    `Name at least one file or folder of the repository, each as a path of at most ${max} characters. Some paths cannot be held, such as one outside the repository or one with special characters.`,
  tooManyScopes: ({ max }: { max: number }) => `One hold takes at most ${max} paths.`,
  conflict: "Someone already holds a path that is in the way. Nothing was held.",
  full: "The group's record is full. Ask the host to reset group storage.",
  unknownClaim: "This repository has no hold with this id.",
  ended: "This hold has already ended.",
  notHolder: "Only the person who holds these paths can release them.",
  staleFence: "This hold has changed since the board was read. Reload the board, then try again.",
  refused: "Group work refused this request.",
  failed: "Group work could not do this. The log on the host has the details.",
};
