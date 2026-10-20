import assert from "node:assert/strict";
import test from "node:test";
import { Workbench } from "./workbench.js";

// The Workbench is a façade: the routes, the CLI and the tests call these
// members, and the work lives in modules behind it. Moving work into a
// module must not add, remove or rename one of them.
const fields = [
  "store",
  "agentSlots",
  "appSettings",
  "entitlements",
  "understanding",
  "contribution",
  "learningLoop",
  "maintenance",
] as const;
const getters = [
  "maxActiveRuns",
  "effectiveMaxActiveRuns",
  "agentTimeoutScale",
  "maxQueuedRuns",
  "limits",
] as const;
const methods = [
  "resume",
  "applyRetention",
  "updateAppSettings",
  "setMaxActiveRuns",
  "models",
  "repo",
  "run",
  "lock",
  "doctor",
  "status",
  "importRepository",
  "managedClone",
  "updateRepository",
  "createRun",
  "entitlementsChanged",
  "sendTeamMessage",
  "approvePlan",
  "revisePlan",
  "retryTeam",
  "cancel",
  "rerunReview",
  "diff",
  "explanations",
  "prepareDraft",
  "editable",
  "draft",
  "review",
  "approve",
  "commits",
  "commit",
  "checkPremise",
  "walkthrough",
  "contextLines",
  "saveNote",
  "chat",
  "fetchPrFeedback",
  "syncRun",
  "undoSync",
  "resolveConflicts",
  "startFollowUp",
  "discardFollowUp",
  "publish",
  "removeWorkspace",
  "removeRun",
  "removeRepository",
  "eraseAll",
  "storage",
  "shutdown",
] as const;

type Listed = (typeof fields)[number] | (typeof getters)[number] | (typeof methods)[number];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// `tsc` (npm run build) fails here when a public member is added, removed
// or renamed without updating the lists above.
const listed: Same<keyof Workbench, Listed> = true;

test("the Workbench keeps its public members", () => {
  assert.equal(listed, true);
  const own = (name: string) =>
    Object.getOwnPropertyDescriptor(Workbench.prototype, name);
  for (const name of methods)
    assert.equal(typeof own(name)?.value, "function", `${name}() is a method`);
  for (const name of getters)
    assert.equal(typeof own(name)?.get, "function", `${name} is a getter`);
  // Fields belong to each instance, not to the prototype.
  for (const name of fields)
    assert.equal(own(name), undefined, `${name} is an instance field`);
});
