import assert from "node:assert/strict";
import test from "node:test";
import type { DraftCheck } from "../../../shared/draft-checks";
import { mergePublishChecks } from "./useDraftEditor";

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
