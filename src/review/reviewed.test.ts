import assert from "node:assert/strict";
import test from "node:test";
import { getDemo } from "../demo";
import { isFileReviewed } from "./reviewed";

test("review marks belong to the displayed fingerprint; only fingerprint-free samples use old path marks", () => {
  const sample = getDemo("en");
  const file = { ...sample.files[0], fingerprint: "current-round" };
  const run = { ...sample.run, reviewedFiles: [file.path], reviewedFingerprints: { [file.path]: "first-round" } };
  assert.equal(isFileReviewed(run, file), false);
  assert.equal(isFileReviewed({ ...run, reviewedFingerprints: { [file.path]: file.fingerprint } }, file), true);
  assert.equal(isFileReviewed(run, { ...file, fingerprint: undefined }), false);
  assert.equal(isFileReviewed(run, { ...file, fingerprint: undefined }, true), true);
  assert.equal(isFileReviewed(run, file, true), false);
});
