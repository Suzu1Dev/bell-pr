import assert from "node:assert/strict";
import test from "node:test";
import en from "../i18n/en";
import zhTW from "../i18n/zh-TW";
import { fileStatusLabel } from "./labels";

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
