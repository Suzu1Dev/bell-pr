import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { PairPage } from "../PairPage";
import { cannotTake, HoldAnswer, type Answer } from "./GroupPage";
import { computeFileHoldNotice } from "./useTeamCollaboration";
import { DiffView } from "../review/DiffView";
import { ExplanationPanel } from "../review/ExplanationPanel";
import type { DiffFile, Run } from "../types";

const sampleFile: DiffFile = {
  path: "src/api/users.ts",
  language: "TypeScript",
  status: "modified",
  additions: 2,
  deletions: 1,
  fingerprint: "a".repeat(64),
  patch: "@@ -1,3 +1,4 @@\n import { schema } from './schema';\n-export const limit = 10;\n+export const limit = 25;\n+export const maxLimit = 100;\n",
};

test("PairPage renders team account, invite registration and Tailscale modes in en and zh-TW", () => {
  for (const mode of ["login", "register", "tailscale"] as const) {
    const enHtml = renderEn(
      createElement(PairPage, { initialMode: mode, tailscaleLogin: "ada@example.com" }),
    );
    assertNoHan(enHtml);
    const zhHtml = renderZh(
      createElement(PairPage, { initialMode: mode, tailscaleLogin: "ada@example.com" }),
    );
    if (mode === "login") {
      assert.match(enHtml, /Username/);
      assert.match(zhHtml, /帳號名稱/);
    } else if (mode === "register") {
      assert.match(enHtml, /Create account &amp; join/);
      assert.match(enHtml, /Email/);
      assert.match(zhHtml, /建立帳號並加入/);
      assert.match(zhHtml, /電子郵件信箱/);
    } else {
      assert.match(enHtml, /Detected Tailscale identity: ada@example\.com/);
      assert.match(zhHtml, /偵測到 Tailscale 身分：ada@example\.com/);
    }
  }
});

test("HoldAnswer and cannotTake distinguish warn vs block cross-file dependencies safely", () => {
  const base: Answer = { asOf: "2026-11-10T09:00:05.000Z", invalid: [], holds: [] };
  const warnAnswer: Answer = {
    ...base,
    dependencyHits: [
      {
        askedPath: "src/routes.ts",
        heldPath: "src/schema.ts",
        holder: "Ada",
        title: "Update schema",
        claimId: "c1",
        mode: "warn",
      },
    ],
  };
  const blockAnswer: Answer = {
    ...base,
    dependencyHits: [
      {
        askedPath: "src/routes.ts",
        heldPath: "<script>bad</script>",
        holder: "<b>Ben</b>",
        title: "Lock contract",
        claimId: "c2",
        mode: "block",
      },
    ],
  };

  assert.equal(cannotTake("Add route", warnAnswer), false);
  assert.equal(cannotTake("Add route", blockAnswer), true);

  const enWarn = renderEn(createElement(HoldAnswer, { answer: warnAnswer }));
  assertNoHan(enWarn);
  assert.match(enWarn, /Dependency warning:.*src\/routes\.ts.*depends on.*src\/schema\.ts/);

  const enBlock = renderEn(createElement(HoldAnswer, { answer: blockAnswer }));
  assertNoHan(enBlock);
  assert.match(enBlock, /Dependency guard:/);
  assert.doesNotMatch(enBlock, /<script>|<b>Ben<\/b>/);

  const zhBlock = renderZh(createElement(HoldAnswer, { answer: blockAnswer }));
  assert.match(zhBlock, /相依防護：/);
});

test("computeFileHoldNotice detects line-range holds and cross-file dependency holds", () => {
  const holds = [
    {
      claimId: "c1",
      taskId: "t1",
      title: "Edit top helper",
      holder: "u-ada",
      holderName: "Ada",
      scopes: ["src/api/users.ts#L10-L25"],
      fence: 1,
      since: "2026-11-10T09:00:00.000Z",
    },
    {
      claimId: "c2",
      taskId: "t2",
      title: "Refactor schema",
      holder: "u-cy",
      holderName: "Cy",
      scopes: ["src/api/schema.ts"],
      fence: 1,
      since: "2026-11-10T09:05:00.000Z",
    },
  ];
  const deps = [
    {
      id: "d1",
      from: "src/api/users.ts",
      to: "src/api/schema.ts",
      mode: "block" as const,
      createdBy: "u-ada",
      createdAt: "2026-11-10T09:00:00.000Z",
    },
  ];

  const nonOverlapping = computeFileHoldNotice("src/api/users.ts", holds, deps, "u-ben", {
    start: 40,
    end: 50,
  });
  assert.equal(nonOverlapping.directHolds.length, 1);
  assert.equal(nonOverlapping.directHolds[0].overlapsSelection, false);
  assert.equal(nonOverlapping.dependencyHolds.length, 1);
  assert.equal(nonOverlapping.dependencyHolds[0].mode, "block");

  const overlapping = computeFileHoldNotice("src/api/users.ts", holds, deps, "u-ben", {
    start: 20,
    end: 30,
  });
  assert.equal(overlapping.directHolds[0].overlapsSelection, true);
});

test("ExplanationPanel Team tab and DiffView render reviewer sign-offs, rationales and TODOs in en and zh-TW", () => {
  const teamRecords: Run["teamRecords"] = {
    fileReviews: {
      [sampleFile.path]: [
        {
          reviewerId: "u-ada",
          reviewerName: "Ada",
          fingerprint: sampleFile.fingerprint!,
          reviewedAt: "2026-11-10T09:10:00.000Z",
        },
      ],
    },
    rationales: [
      {
        id: "r1",
        filePath: sampleFile.path,
        lineStart: 2,
        lineEnd: 3,
        authorId: "u-ada",
        authorName: "Ada",
        text: "Raised default limit to match pagination batch size.",
        createdAt: "2026-11-10T09:12:00.000Z",
      },
    ],
    todos: [
      {
        id: "td1",
        filePath: sampleFile.path,
        text: "Update mobile client pagination constant",
        authorId: "u-ada",
        authorName: "Ada",
        assigneeName: "Ben",
        done: false,
        createdAt: "2026-11-10T09:15:00.000Z",
      },
    ],
  };

  const enPanel = renderEn(
    createElement(ExplanationPanel, {
      file: sampleFile,
      messages: [],
      loading: false,
      onAsk() {},
      demo: false,
      initialTab: "team",
      teamRecords,
    }),
  );
  assertNoHan(enPanel);
  assert.match(enPanel, /Reviewed by teammates/);
  assert.match(enPanel, /Raised default limit to match pagination batch size\./);
  assert.match(enPanel, /Update mobile client pagination constant/);
  assert.match(enPanel, /For Ben/);

  const zhPanel = renderZh(
    createElement(ExplanationPanel, {
      file: sampleFile,
      messages: [],
      loading: false,
      onAsk() {},
      demo: false,
      initialTab: "team",
      teamRecords,
    }),
  );
  assert.match(zhPanel, /團隊審閱紀錄/);
  assert.match(zhPanel, /更動原因與開發想法/);
  assert.match(zhPanel, /交辦給 Ben/);

  const enDiff = renderEn(
    createElement(DiffView, {
      file: sampleFile,
      reviewed: false,
      onReview() {},
      onAsk() {},
      view: "unified",
      teamReviews: [{ reviewerId: "u-ada", reviewerName: "Ada" }],
    }),
  );
  assertNoHan(enDiff);
  assert.match(enDiff, /1 team review/);
});

test("BootstrapAdminCard renders remote admin setup with auto-detected Tailscale in en and zh-TW", async () => {
  const { BootstrapAdminCard } = await import("./GroupPage");
  const info = {
    state: "notSetUp" as const,
    host: false,
    canBootstrap: true as const,
    tailscaleAvailable: true,
    tailscaleLogin: "owner@example.com",
    tailscaleName: "Owner",
  };
  const en = renderEn(
    createElement(BootstrapAdminCard, {
      store: { async start() {} },
      info,
    }),
  );
  assertNoHan(en);
  assert.match(en, /Set up team collaboration as admin/);
  assert.match(en, /owner@example\.com/);

  const zh = renderZh(
    createElement(BootstrapAdminCard, {
      store: { async start() {} },
      info,
    }),
  );
  assert.match(zh, /從遠端啟用團隊協作並成為管理員/);
  assert.match(zh, /owner@example\.com/);
});
