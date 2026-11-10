import { product } from "../../../shared/product.js";

const name = product.name;
const bin = product.binNames[0];

/** Group work: the people who share one running BELL PR (collab-host.ts, routes/collab.ts). */
export default {
  notSetUp: `Group work is not set up yet on this ${name}.`,
  stopped: `Group work has stopped. Fix the cause on the host (\`${bin} group status\` names it), then restart ${name}.`,
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
};
