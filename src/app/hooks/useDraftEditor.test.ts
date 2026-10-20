import assert from "node:assert/strict";
import test from "node:test";
import type { DraftCheck } from "../../../shared/draft-checks";
import { aiDisclosureLine } from "../../../shared/drafts";
import { mergePublishChecks, savedDisclosure } from "./useDraftEditor";

const check = (id: DraftCheck["id"], message: string = id): DraftCheck => ({
  id,
  kind: id === "secret" || id === "placeholder" ? "block" : "confirm",
  message,
  details: [],
});

test("the publish dialog asks for the confirmations only the server can check", () => {
  const local = [check("unchecked"), check("brevity")];
  // Before the server's list arrives, the dialog shows the local checks.
  assert.deepEqual(mergePublishChecks(local, undefined), local);
  // The commit e-mail, local folders and CI files come from the server, in its words.
  const server = [
    check("unchecked", "From the server"),
    check("local-paths"),
    check("workflows"),
    check("author-email"),
  ];
  assert.deepEqual(
    mergePublishChecks(local, server).map((item) => [item.id, item.message]),
    [
      ["unchecked", "From the server"],
      ["local-paths", "local-paths"],
      ["workflows", "workflows"],
      ["author-email", "author-email"],
      ["brevity", "brevity"],
    ],
  );
  // An empty server list still keeps what the editor found itself.
  assert.deepEqual(mergePublishChecks(local, []), local);
});

test("turning the AI line on adds it to an agent run's description, never to a Learn-by-hand run's", () => {
  const body = "## Summary\n\nRetries GET requests.";
  const agent = savedDisclosure(body, true);
  assert.equal(agent.choice, true);
  assert.ok(agent.body.endsWith(aiDisclosureLine));
  assert.deepEqual(savedDisclosure(`${body}\n\n${aiDisclosureLine}`, false), { body, choice: false });
  // The person's text is theirs: no line, and no choice that the server would act on.
  for (const choice of [true, false, undefined])
    assert.deepEqual(savedDisclosure(body, choice, true), { body });
  assert.deepEqual(savedDisclosure(body, undefined), { body });
});
