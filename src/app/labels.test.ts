import assert from "node:assert/strict";
import test from "node:test";
import en from "../i18n/en";
import zhTW from "../i18n/zh-TW";
import { fileStatusLabel, initialsOf } from "./labels";

test("a file status reads from the dictionary, and an unknown one as modified", () => {
  assert.deepEqual(fileStatusLabel(en.common.fileStatus, "added"), {
    badge: "A",
    title: "New file",
  });
  assert.equal(fileStatusLabel(zhTW.common.fileStatus, "deleted").title, "已刪除");
  for (const status of ["renamed", "", "toString", "__proto__"])
    assert.deepEqual(
      fileStatusLabel(en.common.fileStatus, status),
      en.common.fileStatus.modified,
      status,
    );
});

test("avatar initials come from the first two words of a login", () => {
  assert.equal(initialsOf("octo-cat"), "OC");
  assert.equal(initialsOf("octocat"), "O");
  assert.equal(initialsOf("mona_lisa.octo"), "ML");
  assert.equal(initialsOf("42-bots"), "4B");
  assert.equal(initialsOf("--"), "");
  assert.equal(initialsOf(""), "");
});
