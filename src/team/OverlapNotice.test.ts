import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { LocalOverlap } from "../../shared/team";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { OverlapNotice } from "./OverlapNotice";

const overlaps: LocalOverlap[] = [
  { runId: "r1", title: "Fix a", status: "review", paths: ["web/a.js", "web/b.js"], taskIds: ["web"] },
  { runId: "r2", title: "Docs", status: "published", paths: ["docs/"] },
];
const notice = (confirmed: boolean, list?: LocalOverlap[]) =>
  createElement(OverlapNotice, { overlaps: list, confirmed, onConfirm() {}, disabled: false });

test("the overlap notice names each other contribution, where it is and the files it shares, with a tick to approve anyway", () => {
  const html = renderEn(notice(false, overlaps));
  assertNoHan(html);
  assert.match(html, /aria-label="Overlap with your other contributions"/);
  assert.match(html, /2 other contributions of yours to this project change files this plan covers/);
  assert.match(html, /“Fix a” \(Ready for your review\):<\/b> <span>web\/a\.js, web\/b\.js<\/span>/);
  assert.match(html, /“Docs” \(PR published\):/);
  assert.match(html, /<input type="checkbox"\/>I know these overlap; approve anyway/);
  assert.match(renderEn(notice(true, overlaps)), /<input type="checkbox" checked=""\/>/);
  assert.match(renderZh(notice(false, overlaps)), /你在這個專案的其他 2 個貢獻也改了這個計畫涵蓋的檔案/);
});

test("a Learn-by-hand plan is changed and confirmed, not sent back and approved", () => {
  const html = renderEn(createElement(OverlapNotice, { overlaps, confirmed: false, onConfirm() {}, disabled: false, byHand: true }));
  assert.match(html, /Change your steps to keep away from these files/);
  assert.match(html, /I know these overlap; confirm my plan anyway/);
  assert.doesNotMatch(html, /Send the plan back/);
});

test("without overlaps, or before they are read, there is no notice", () => {
  assert.equal(renderEn(notice(false, [])), "");
  assert.equal(renderEn(notice(false)), "");
});
