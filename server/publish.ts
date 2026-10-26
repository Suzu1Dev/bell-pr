/**
 * The human review gate and publishing: the PR draft, per-file review,
 * approval, and publishing exactly the reviewed files as one commit in a
 * GitHub Draft PR, or a follow-up round as one more commit on the PR's
 * branch. Nothing reaches GitHub without that approval.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertGitConfigSafe,
  command,
  git,
  gitNetwork,
  redact,
} from "./process.js";
import {
  assertGitHubRepository,
  assertRefName,
  parseGitHubSource,
  readDiff,
  reviewFingerprint,
} from "./git.js";
import { validBranchName, type RunDraft } from "../shared/drafts.js";
import {
  draftPreflight,
  findDraftPlaceholders,
  type DraftCheck,
} from "../shared/draft-checks.js";
import type { Locale } from "../shared/i18n/locale.js";
import { activeFollowUp, type FollowUpRound } from "../shared/followups.js";
import {
  AppError,
  type DiffFile,
  type Repository,
  type Run,
} from "./types.js";
import { assertRemoteHead, prHasCommit, remoteBranchHead } from "./pr-branch.js";
import { assertConflictsResolved } from "./sync-runs.js";
import { applyAiDisclosure } from "./drafts.js";
import { assertReady } from "./by-hand.js";
import { assertGitIdentity, githubTokenScopes } from "./doctor.js";
import { setupError } from "./cli-errors.js";
import type { WorkbenchContext } from "./workbench.js";
import { currentLocale, sm } from "./i18n/index.js";
import { secretInPatch } from "./secrets.js";
import { assertUnderstood, understandingRequired } from "./understanding.js";
import { reviewabilitySnapshot } from "../shared/reviewability.js";
import { byHandPreflight } from "../shared/by-hand.js";
import type {
  ContributionFacts,
  GuardOverride,
} from "../shared/contribution.js";
import { explainPrCreateFailure, refreshRunFacts } from "./contribution-facts.js";

const now = () => new Date().toISOString();

const json = <T>(value: string) => JSON.parse(value) as T;

/**
 * Commit e-mail addresses the person already confirmed publishing with
 * (the one-time `author-email` check), stored as SHA-256 digests of the
 * lower-cased address in `<data>/author-emails.json`.
 */
const confirmedEmailsFile = (directory: string) =>
  path.join(directory, "author-emails.json");
const emailDigest = (email: string) =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

async function confirmedEmails(directory: string): Promise<Set<string>> {
  try {
    const value = JSON.parse(
      await readFile(confirmedEmailsFile(directory), "utf8"),
    ) as { confirmed?: unknown };
    return new Set(
      Array.isArray(value.confirmed)
        ? value.confirmed.filter(
            (entry): entry is string =>
              typeof entry === "string" && /^[a-f0-9]{64}$/.test(entry),
          )
        : [],
    );
  } catch {
    return new Set();
  }
}

async function confirmEmails(directory: string, emails: string[]) {
  const confirmed = await confirmedEmails(directory);
  for (const email of emails) confirmed.add(emailDigest(email));
  const file = confirmedEmailsFile(directory);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify({ version: 1, confirmed: [...confirmed].sort() }, null, 2),
    { mode: 0o600 },
  );
  await rename(temporary, file);
}

/** The author and committer addresses a commit made in the checkout would carry. */
async function commitEmails(run: Run) {
  const emails: string[] = [];
  for (const ident of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
    try {
      const value = (await git(run.worktreePath, ["var", ident])).stdout;
      const email = /<([^<>]*)>/.exec(value)?.[1]?.trim();
      if (email && !emails.includes(email)) emails.push(email);
    } catch {
      /* No identity yet: the commit itself reports that. */
    }
  }
  return emails;
}

/** The reviewability snapshot of the run's files, with the project's own references. */
function changesOf(run: Run, files: DiffFile[], repo?: Repository) {
  return reviewabilitySnapshot({
    files,
    planScopes: run.team?.tasks.map((task) => task.files),
    planTasks: run.team?.tasks,
    generated: repo?.contributionRules?.generated,
    mergedSizes: repo?.contributionRules?.mergedSizes,
  });
}

/**
 * Every check on what a first publish sends to GitHub: the PR text checks,
 * credentials and local paths in the title, description and commit
 * message, CI configuration among the changed files, once per address a
 * commit e-mail that is not GitHub's no-reply one, and the respect checks
 * (the project's rules, the stored GitHub facts, reviewability, pacing).
 * The publish dialog shows the same list (GET /api/runs/:id/preflight),
 * which never calls GitHub: it uses the facts stored on the run unless
 * `extra.facts` passes fresher ones.
 */
export async function publishChecks(
  run: Run,
  files: DiffFile[],
  dataDirectory: string,
  locale: Locale = currentLocale(),
  extra: {
    repo?: Repository;
    facts?: ContributionFacts;
    overrides?: GuardOverride[];
  } = {},
): Promise<DraftCheck[]> {
  const confirmed = await confirmedEmails(dataDirectory);
  const emails = (await commitEmails(run)).filter(
    (email) => !confirmed.has(emailDigest(email)),
  );
  const directories = [os.homedir(), dataDirectory];
  try {
    directories.push(await realpath(dataDirectory));
  } catch {
    /* Not created yet. */
  }
  const checks = draftPreflight(
    {
      title: run.draft.title,
      body: run.draft.body,
      commitMessage: run.draft.commitMessage,
      sources: run.draftPreparation?.context?.sources,
      proposalBody: run.draftPreparation?.proposal?.body,
      appliedBody: run.draftPreparation?.appliedBody,
      earlierBodies: run.draftPreparation?.earlierBodies,
      localDirectories: directories,
      changedPaths: files.map((file) => file.path),
      commitEmails: emails,
      changes: changesOf(run, files, extra.repo),
      rules: extra.repo?.contributionRules,
      facts: extra.facts ?? run.contributionFacts,
      overrides: extra.overrides ?? run.guardOverrides,
      testReasons: run.reviewability?.testReasons,
      // A pass counts whatever the setting says: only an unpassed run
      // with the check turned off asks about a rule on explaining a change.
      understandingOff: !understandingRequired() && !run.understanding?.passedAt,
      issueUrl: run.contributionSettings?.issueUrl,
      // A clean Learn-by-hand run; "rules read during this run" is checked here, where publishing is.
      learnByHand: byHandPreflight(run, now(), { createdAt: true }),
    },
    locale,
  );
  // The quoted confirm carries a digest of its words, which publish() wants back with its tick.
  return checks.map((check) => (check.id === "by-hand-rules" ? { ...check, digest: checkDigest(check) } : check));
}

/** A digest of a check's words: its message and details, as shown. */
const checkDigest = (check: DraftCheck) =>
  createHash("sha256").update(JSON.stringify([check.message, ...check.details])).digest("hex");

/** GitHub only lets a token with the `workflow` scope push changes to these files. */
const workflowPath = /^\.github\/workflows\//;

/**
 * Refuses with 409 `gh_workflow_scope` when the files to push change a
 * GitHub Actions workflow and the GitHub CLI's token reports scopes
 * without `workflow`. A token that reports none (fine-grained) or no
 * answer from GitHub is not refused here; GitHub's own answer to the push
 * is hinted the same way.
 */
async function assertWorkflowScope(files: DiffFile[]) {
  if (!files.some((file) => workflowPath.test(file.path))) return;
  const scopes = await githubTokenScopes();
  if (scopes && !scopes.includes("workflow"))
    throw setupError("gh_workflow_scope", 409);
}

/** The draft, file reviews and approval change only in review or approved, never while publishing. */
export function editable(run: Run) {
  if (!["review", "approved"].includes(run.status) || run.publishing)
    throw new AppError((m) => m.run.publish.notEditable, 409);
}

export async function saveDraft(
  ctx: WorkbenchContext,
  id: string,
  edited: RunDraft,
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    editable(run);
    // Turning the AI disclosure on or off adds or removes BELL's line.
    const draft = applyAiDisclosure(run.draft, edited, { learnByHand: run.learnByHand });
    if (
      activeFollowUp(run.followUps) &&
      (draft.title !== run.draft.title || draft.body !== run.draft.body)
    )
      throw new AppError((m) => m.run.publish.roundKeepsPrText, 409);
    // An empty message is stored as absent so the title-only fallback applies.
    const commitMessage = draft.commitMessage?.trim();
    // Likewise an empty GitHub branch falls back to the run's own branch.
    const publishBranch = draft.publishBranch?.trim();
    if (publishBranch && !validBranchName(publishBranch))
      throw new AppError((m) => m.run.publish.invalidBranch, 422);
    // Pushing the reviewed commit to the target branch would skip the PR entirely.
    if (publishBranch?.toLowerCase() === run.baseBranch.toLowerCase())
      throw new AppError(
        (m) => m.run.publish.branchIsTarget({ branch: run.baseBranch }),
        422,
      );
    // After a push, another branch would let a retry open a second PR.
    if (
      run.publishedBranch &&
      (publishBranch || run.branch) !== run.publishedBranch
    )
      throw new AppError(
        (m) => m.run.publish.branchLocked({ branch: run.publishedBranch! }),
        409,
      );
    const saved: RunDraft = {
      title: draft.title,
      body: draft.body,
      ...(commitMessage ? { commitMessage } : {}),
      ...(publishBranch ? { publishBranch } : {}),
      ...(draft.aiDisclosure !== undefined
        ? { aiDisclosure: draft.aiDisclosure }
        : {}),
    };
    run.draft = saved;
    run.status = "review";
    delete run.approvedFingerprint;
    await ctx.store.save();
    return run;
  });
}

export async function review(
  ctx: WorkbenchContext,
  id: string,
  filePath: string,
  reviewed: boolean,
  displayedFingerprint: string,
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    editable(run);
    const files = await ctx.diff(id);
    const file = files.find((value) => value.path === filePath);
    if (!file) throw new AppError((m) => m.run.review.fileNotFound, 404);
    if (file.fingerprint !== displayedFingerprint)
      throw new AppError((m) => m.run.publish.fileChanged, 409);
    if (file.blocked) throw new AppError(file.blocked, 422);
    if (reviewed) run.reviewedFingerprints[filePath] = file.fingerprint;
    else delete run.reviewedFingerprints[filePath];
    run.reviewedFiles = Object.keys(run.reviewedFingerprints);
    run.status = "review";
    delete run.approvedFingerprint;
    await ctx.store.save();
    return run;
  });
}

export async function approve(
  ctx: WorkbenchContext,
  id: string,
  displayedDraft: Run["draft"],
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    editable(run);
    // Learn by hand: never while BELL runs the person's tests, and only the
    // version the person marked ready is approved (DESIGN v1.2 F5, F9),
    // from the one read of the change that was checked.
    let ready: DiffFile[] | undefined;
    if (run.learnByHand) {
      const tests = `tests:${id}`;
      if (ctx.byHandJobs.has(tests) || ctx.controllers.has(tests))
        throw new AppError((m) => m.byHand.flow.testsRunning, 409);
      ready = await ctx.diff(id);
      assertReady(run, ready);
    }
    if (
      displayedDraft.title !== run.draft.title ||
      displayedDraft.body !== run.draft.body ||
      (displayedDraft.commitMessage?.trim() ?? "") !==
        (run.draft.commitMessage ?? "") ||
      (displayedDraft.publishBranch?.trim() ?? "") !==
        (run.draft.publishBranch ?? "")
    )
      throw new AppError((m) => m.run.publish.draftChanged, 409);
    const files = ready ?? (await ctx.diff(id));
    if (
      !files.length ||
      files.some(
        (file) =>
          file.blocked ||
          run.reviewedFingerprints[file.path] !== file.fingerprint,
      )
    ) {
      throw new AppError((m) => m.run.publish.reviewAllFirst, 409);
    }
    const repo = ctx.store.data.repos.find((value) => value.id === run.repoId);
    // The Explain-it-back check, unless the person turned it off.
    const understood = assertUnderstood(run, files, repo);
    if (!run.draft.title.trim() || !run.draft.body.trim())
      throw new AppError((m) => m.run.publish.prTextRequired, 422);
    await assertConflictsResolved(run);
    // A follow-up round pushes only a commit, so its message is what goes out.
    const round = activeFollowUp(run.followUps);
    if (round) {
      const message = run.draft.commitMessage?.trim();
      if (!message || findDraftPlaceholders(message).length)
        throw new AppError((m) => m.run.publish.roundMessageRequired, 422);
      if (secretInPatch(message))
        throw new AppError((m) => m.security.draftChecks.secret, 422);
      const unreviewable = await unreviewableRoundPaths(run, round, files);
      if (unreviewable.length) throw unreviewableError(unreviewable);
    } else {
      // The checks explain themselves in the request's locale; the
      // acknowledgements below match their ids, never their text.
      // The project's rules and the change's tests stop approval early;
      // the GitHub facts wait for publishing, which reads them again.
      const unfinished = draftPreflight(
        {
          title: run.draft.title,
          body: run.draft.body,
          commitMessage: run.draft.commitMessage,
          sources: run.draftPreparation?.context?.sources,
          proposalBody: run.draftPreparation?.proposal?.body,
          appliedBody: run.draftPreparation?.appliedBody,
          earlierBodies: run.draftPreparation?.earlierBodies,
          rules: repo?.contributionRules,
          changes: changesOf(run, files, repo),
          testReasons: run.reviewability?.testReasons,
          learnByHand: byHandPreflight(run, now()),
        },
        currentLocale(),
      ).find((check) => check.kind === "block");
      if (unfinished)
        throw new AppError(
          [unfinished.message, ...unfinished.details].join("\n"),
          422,
        );
    }
    // Publishing commits in the checkout, so its Git identity (repository
    // settings included) must be set before anything is approved.
    await assertGitIdentity(run.worktreePath);
    run.approvedFingerprint = reviewFingerprint(files, run.draft);
    run.status = "approved";
    // Recorded only once approval succeeds: "Check off" for good, until a
    // later approval with the check passed.
    if (understood.passed) delete run.understandingCheckOff;
    else if (!understood.required) run.understandingCheckOff = true;
    await ctx.store.save();
    return run;
  });
}

/**
 * `acknowledged` lists the preflight items the person confirmed in the
 * publish dialog. They are recomputed here from the saved draft, so a stale
 * or partial list is rejected before anything is pushed. The quoted
 * confirm's tick counts only with `rulesDigest`, the digest of the words
 * the dialog showed, when it matches the words the server shows now.
 */
export async function publish(
  ctx: WorkbenchContext,
  id: string,
  displayedFingerprint: string,
  acknowledged: string[] = [],
  overrides: Pick<GuardOverride, "id" | "reason">[] = [],
  rulesDigest?: string,
) {
  return ctx.lock(id, async () => {
    const run = ctx.run(id);
    if (
      !run.approvedFingerprint ||
      displayedFingerprint !== run.approvedFingerprint
    )
      throw new AppError((m) => m.run.publish.approvalStale, 409);
    if (run.status === "published") return run;
    const repo = ctx.repo(run.repoId);
    if (run.status !== "approved" || !run.approvedFingerprint)
      throw new AppError((m) => m.run.publish.approveFirst, 409);
    if (!repo.url || !parseGitHubSource(repo.url))
      throw new AppError((m) => m.run.publish.noGithubOrigin, 422);
    // Nothing is committed or pushed from a checkout whose Git settings could run commands.
    await assertGitConfigSafe(run.worktreePath);
    // Nor before Git knows who commits.
    await assertGitIdentity(run.worktreePath);
    const files = await ctx.diff(id);
    if (
      run.status !== "approved" ||
      run.approvedFingerprint !== reviewFingerprint(files, run.draft)
    )
      throw new AppError((m) => m.run.publish.diffChanged, 409);
    if (
      files.some(
        (file) =>
          file.blocked ||
          run.reviewedFingerprints[file.path] !== file.fingerprint,
      )
    )
      throw new AppError((m) => m.run.publish.notAllReviewed, 409);
    // The current setting applies, also to runs approved while it was off
    // and to runs approved by builds before the check existed.
    assertUnderstood(run, files, repo);
    const round = activeFollowUp(run.followUps);
    if (round) return publishFollowUp(ctx, run, round, files);
    if (run.prUrl)
      throw new AppError((m) => m.run.publish.prAlreadySent, 409);
    await assertConflictsResolved(run);
    const headBranch = run.draft.publishBranch || run.branch;
    if (
      run.draft.publishBranch &&
      headBranch.toLowerCase() === run.baseBranch.toLowerCase()
    )
      throw new AppError(
        (m) =>
          m.run.publish.branchIsTargetReapprove({ branch: run.baseBranch }),
        422,
      );
    if (run.publishedBranch && run.publishedBranch !== headBranch)
      throw new AppError(
        (m) =>
          m.run.publish.branchLockedPublish({ branch: run.publishedBranch! }),
        409,
      );
    assertRefName(headBranch);
    // An earlier attempt pushed and may have opened the PR without hearing
    // back (gh timed out, the server stopped). That PR is recorded before
    // the checks below, which would count it as one more of the person's
    // open PRs and could refuse the retry. A failed lookup, or a commit this
    // publish would no longer make, is left to the full publish below.
    if (resumesPublish(run)) {
      let prUrl: string | undefined;
      try {
        await assertPriorCommit(
          run,
          run.publishCommit,
          await reviewedTree(ctx, run, files),
        );
        prUrl = await openPrUrl(
          repo.fullName,
          run.publishedBranch,
          run.headRepository.split("/")[0],
          run.publishCommit,
        );
      } catch {
        // The full publish checks the same again and records what failed.
      }
      if (prUrl) {
        run.prUrl = prUrl;
        run.status = "published";
        delete run.error;
        ctx.log(run, "system", sm().run.publish.prCreated);
        await ctx.store.save();
        return run;
      }
    }
    // A block the person lifted with a reason counts for this publish, and
    // is recorded on the run once publishing goes ahead (below); a reason
    // already recorded, as on a retry, is not added again.
    const at = now();
    const same = (a: Pick<GuardOverride, "id" | "reason">, b: typeof a) =>
      a.id === b.id && a.reason === b.reason;
    const lifted = overrides
      .map((override) => ({ id: override.id, reason: override.reason.trim(), at }))
      .filter(
        (override, index, all) =>
          all.findIndex((other) => same(other, override)) === index &&
          !(run.guardOverrides ?? []).some((recorded) => same(recorded, override)),
      );
    const guardOverrides = [...(run.guardOverrides ?? []), ...lifted].slice(-8);
    // The GitHub facts are read again; a failed read is never a pass.
    run.contributionFacts =
      (await refreshRunFacts(ctx, run, { timeoutMs: 10_000 })) ??
      run.contributionFacts;
    // Runs approved before these checks existed are held to them as well.
    const checks = await publishChecks(
      run,
      files,
      ctx.store.directory,
      currentLocale(),
      { repo, overrides: guardOverrides },
    );
    const blocking = checks.find((check) => check.kind === "block");
    if (blocking)
      throw new AppError(
        [blocking.message, ...blocking.details].join("\n"),
        422,
      );
    const unconfirmed = checks.filter(
      (check) =>
        check.kind === "confirm" &&
        (!acknowledged.includes(check.id) ||
          (check.id === "by-hand-rules" && rulesDigest !== check.digest)),
    );
    if (unconfirmed.length)
      throw new AppError(
        (m) =>
          m.run.publish.confirmFirst({
            items: unconfirmed.map((check) => check.message),
          }),
        422,
      );
    await assertWorkflowScope(files);
    // The commit e-mail is asked about once per address.
    if (checks.some((check) => check.id === "author-email"))
      await confirmEmails(ctx.store.directory, await commitEmails(run));
    if (lifted.length) run.guardOverrides = guardOverrides;
    run.publishing = true;
    delete run.error;
    await ctx.store.save();
    try {
      const githubUser = (
        await command("gh", ["api", "user", "--jq", ".login"], {
          timeoutMs: 15_000,
        })
      ).stdout.trim();
      if (!/^[A-Za-z0-9-]+$/.test(githubUser))
        throw new AppError((m) => m.run.publish.githubUserInvalid, 422);
      const metadata = json<{
        viewerPermission: string;
        defaultBranchRef: { name: string };
      }>(
        (
          await command("gh", [
            "repo",
            "view",
            repo.fullName,
            "--json",
            "viewerPermission,defaultBranchRef",
          ])
        ).stdout,
      );
      if (metadata.defaultBranchRef.name !== run.baseBranch)
        throw new AppError((m) => m.run.publish.defaultBranchChanged, 409);
      const remoteSha = (
        await command("gh", [
          "api",
          `repos/${repo.fullName}/git/ref/heads/${encodeURIComponent(run.baseBranch)}`,
          "--jq",
          ".object.sha",
        ])
      ).stdout.trim();
      if (remoteSha !== run.baseSha)
        throw new AppError(
          (m) =>
            run.publishCommit
              ? m.run.publish.targetMovedAfterCommit
              : m.run.publish.targetMoved,
          409,
        );
      const head = (
        await git(run.worktreePath, ["symbolic-ref", "--short", "HEAD"])
      ).stdout.trim();
      if (head !== run.branch)
        throw new AppError((m) => m.run.publish.branchChanged, 409);
      const previousHead = (
        await git(run.worktreePath, ["rev-parse", "HEAD"])
      ).stdout.trim();
      await git(run.worktreePath, [
        "merge-base",
        "--is-ancestor",
        run.baseSha,
        previousHead,
      ]);

      const tree = await reviewedTree(ctx, run, files);
      let commit = run.publishCommit;
      if (commit) await assertPriorCommit(run, commit, tree);
      else {
        commit = (
          await git(
            run.worktreePath,
            ["commit-tree", tree, "-p", run.baseSha],
            {
              // The person's full message (subject, body, their own trailers)
              // or, when none was written, the title alone as before.
              input:
                (run.draft.commitMessage?.trim() || run.draft.title) + "\n",
            },
          )
        ).stdout.trim();
      }
      await git(run.worktreePath, [
        "update-ref",
        `refs/heads/${run.branch}`,
        commit,
        previousHead,
      ]);
      await git(run.worktreePath, ["read-tree", commit]);
      run.publishCommit = commit;
      await ctx.store.save();

      let headRepository = repo.fullName;
      let headOwner = repo.owner;
      if (
        !["ADMIN", "MAINTAIN", "WRITE"].includes(metadata.viewerPermission)
      ) {
        await command(
          "gh",
          ["repo", "fork", repo.fullName, "--clone=false", "--remote=false"],
          { timeoutMs: 120_000 },
        );
        headRepository = `${githubUser}/${repo.name}`;
        const fork = json<{ parent?: { nameWithOwner: string } }>(
          (
            await command("gh", [
              "repo",
              "view",
              headRepository,
              "--json",
              "parent",
            ])
          ).stdout,
        );
        if (
          fork.parent?.nameWithOwner.toLowerCase() !==
          repo.fullName.toLowerCase()
        )
          throw new AppError((m) => m.run.publish.notAFork, 409);
        headOwner = githubUser;
      }
      assertGitHubRepository(headRepository);
      run.headRepository = headRepository;
      await ctx.store.save();
      await gitNetwork(
        run.worktreePath,
        [
          "push",
          "--",
          `https://github.com/${headRepository}.git`,
          `${commit}:refs/heads/${headBranch}`,
        ],
        { timeoutMs: 120_000 },
      );
      run.publishedBranch = headBranch;
      await ctx.store.save();
      const headRef = `${headOwner}:${headBranch}`;
      let prUrl = await openPrUrl(repo.fullName, headBranch, headOwner, commit);
      if (!prUrl) {
        const result = await command(
          "gh",
          [
            "pr",
            "create",
            "--repo",
            repo.fullName,
            "--base",
            run.baseBranch,
            "--head",
            headRef,
            "--draft",
            "--title",
            run.draft.title,
            "--body-file",
            "-",
          ],
          { input: run.draft.body, timeoutMs: 120_000 },
        );
        prUrl = result.stdout.match(
          /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/,
        )?.[0];
      }
      if (!prUrl)
        throw new AppError((m) => m.run.publish.noPrUrl, 502);
      run.prUrl = prUrl;
      run.status = "published";
      ctx.log(run, "system", sm().run.publish.prCreated);
    } catch (caught) {
      let error = caught;
      // GitHub's own limits (such as on open pull requests) in plain words.
      const explained = explainPrCreateFailure(error);
      if (explained) error = explained;
      run.error = redact(
        error instanceof Error ? error.message : sm().run.publish.failed,
      );
      if (run.publishCommit)
        run.error = sm().run.publish.failedAfterPush({ error: run.error });
      ctx.log(run, "system", run.error);
      throw error;
    } finally {
      run.publishing = false;
      await ctx.store.save();
    }
    return run;
  });
}

/**
 * Paths whose pushed content a round changed but the review list cannot
 * show: a file put back to its base version or deleted drops out of the
 * diff against the base, yet it would change the pushed commit.
 */
async function unreviewableRoundPaths(
  run: Run,
  round: FollowUpRound,
  files: DiffFile[],
  tree?: string,
) {
  // A sync round's tree is the target branch plus the reviewed files.
  const base = round.mergeParent ?? round.parentCommit;
  const changed = (
    await git(
      run.worktreePath,
      tree
        ? ["diff-tree", "-r", "--no-renames", "--name-only", "-z", base, tree]
        : ["diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", base, "--"],
    )
  ).stdout
    .split("\0")
    .filter(Boolean);
  const listed = new Set(files.map((file) => file.path));
  return changed.filter((filePath) => !listed.has(filePath));
}

function unreviewableError(paths: string[]) {
  return new AppError(
    (m) => m.run.publish.roundReverts({ files: paths.slice(0, 10) }),
    409,
  );
}

/**
 * Pushes an approved follow-up round as one commit on top of the PR head.
 * The PR title and description are left alone, and nothing is force-pushed:
 * GitHub's branch is checked before a commit is made, and the push itself
 * is a plain fast-forward. The caller holds the run lock.
 */
async function publishFollowUp(
  ctx: WorkbenchContext,
  run: Run,
  round: FollowUpRound,
  files: DiffFile[],
) {
  const message = run.draft.commitMessage?.trim();
  if (!message)
    throw new AppError((m) => m.run.publish.roundMessageMissing, 422);
  await assertConflictsResolved(run);
  if (findDraftPlaceholders(message).length)
    throw new AppError((m) => m.run.publish.roundMessagePlaceholders, 422);
  if (secretInPatch(message))
    throw new AppError((m) => m.security.draftChecks.secret, 422);
  if (!run.prUrl || !run.headRepository)
    throw new AppError((m) => m.run.publish.roundNoPushTarget, 409);
  const branch = run.publishedBranch ?? run.branch;
  assertGitHubRepository(run.headRepository);
  assertRefName(branch);
  await assertGitConfigSafe(run.worktreePath);
  await assertWorkflowScope(files);
  const roundNumber = (run.followUps?.indexOf(round) ?? 0) + 1;
  const finish = (commit: string) => {
    round.status = "published";
    round.publishedAt = now();
    run.publishCommit = commit;
    run.status = "published";
    ctx.log(
      run,
      "system",
      sm().run.publish.roundPushed({
        round: roundNumber,
        branch,
        commit: commit.slice(0, 7),
      }),
    );
  };
  run.publishing = true;
  delete run.error;
  await ctx.store.save();
  try {
    const head = (
      await git(run.worktreePath, ["symbolic-ref", "--short", "HEAD"])
    ).stdout.trim();
    if (head !== run.branch)
      throw new AppError((m) => m.run.publish.branchChangedPush, 409);
    const previousHead = (
      await git(run.worktreePath, ["rev-parse", "HEAD"])
    ).stdout.trim();
    if (previousHead !== round.parentCommit && previousHead !== round.commit)
      throw new AppError((m) => m.run.publish.commitChangedPush, 409);
    // A retry after the push landed but before BELL recorded it, also when
    // the branch moved on or the PR was merged since.
    if (round.commit && (await prHasCommit(ctx, run, round.commit))) {
      finish(round.commit);
      return run;
    }
    const remoteHead = await remoteBranchHead(run);
    // Checked before anything local changes, so a refusal leaves the round discardable.
    assertRemoteHead(run, remoteHead, round.parentCommit);
    const state = (
      await command("gh", [
        "pr",
        "view",
        run.prUrl,
        "--json",
        "state",
        "--jq",
        ".state",
      ])
    ).stdout.trim();
    if (state !== "OPEN")
      throw new AppError(
        (m) =>
          state === "MERGED" ? m.run.publish.prMerged : m.run.publish.prClosed,
        409,
      );
    const tree = await reviewedTree(ctx, run, files);
    const parentTree = (
      await git(run.worktreePath, ["rev-parse", `${round.parentCommit}^{tree}`])
    ).stdout.trim();
    if (tree === parentTree)
      throw new AppError((m) => m.run.publish.roundEmpty, 422);
    const unreviewable = await unreviewableRoundPaths(run, round, files, tree);
    if (unreviewable.length) throw unreviewableError(unreviewable);
    let commit = round.commit;
    if (commit) {
      // A retry after the commit was made: it must be the same reviewed content.
      const [priorTree, priorParents, priorMessage] = await Promise.all([
        git(run.worktreePath, ["rev-parse", `${commit}^{tree}`]),
        git(run.worktreePath, ["rev-list", "--parents", "-n", "1", commit]),
        git(run.worktreePath, ["log", "-1", "--format=%B", commit]),
      ]);
      if (
        priorTree.stdout.trim() !== tree ||
        priorParents.stdout.trim().split(/\s+/).slice(1).join(" ") !==
          [round.parentCommit, round.mergeParent].filter(Boolean).join(" ") ||
        priorMessage.stdout.trim() !== message
      )
        throw new AppError((m) => m.run.publish.roundCommitDiffers, 409);
    } else {
      commit = (
        await git(
          run.worktreePath,
          [
            "commit-tree",
            tree,
            "-p",
            round.parentCommit,
            ...(round.mergeParent ? ["-p", round.mergeParent] : []),
          ],
          { input: `${message}\n` },
        )
      ).stdout.trim();
    }
    // Recorded before the branch moves, so an interruption from here on can
    // be retried (HEAD may be the parent or this commit) or discarded.
    round.commit = commit;
    await ctx.store.save();
    if (previousHead !== commit)
      await git(run.worktreePath, [
        "update-ref",
        `refs/heads/${run.branch}`,
        commit,
        previousHead,
      ]);
    await git(run.worktreePath, ["read-tree", commit]);
    // A plain push: GitHub rejects it if the branch moved since the check above.
    await gitNetwork(
      run.worktreePath,
      [
        "push",
        "--",
        `https://github.com/${run.headRepository}.git`,
        `${commit}:refs/heads/${branch}`,
      ],
      { timeoutMs: 120_000 },
    );
    finish(commit);
  } catch (error) {
    run.error = redact(
      error instanceof Error ? error.message : sm().run.publish.pushFailed,
    );
    ctx.log(run, "system", run.error);
    throw error;
  } finally {
    run.publishing = false;
    await ctx.store.save();
  }
  return run;
}

/**
 * Whether an earlier attempt pushed this run's commit but recorded no PR,
 * which GitHub may have opened all the same (gh timed out, the server
 * stopped). publish() looks for that PR before its checks.
 */
export function resumesPublish(
  run: Run,
): run is Run &
  Required<Pick<Run, "publishCommit" | "publishedBranch" | "headRepository">> {
  return (
    !run.prUrl &&
    !!run.publishCommit &&
    !!run.publishedBranch &&
    !!run.headRepository
  );
}

/**
 * Refuses when the commit of an earlier publish, which may already be on
 * GitHub, is not the one this publish would make: its tree is not the
 * reviewed tree, or its message is not the saved one.
 */
async function assertPriorCommit(run: Run, commit: string, tree: string) {
  const priorTree = (
    await git(run.worktreePath, ["rev-parse", `${commit}^{tree}`])
  ).stdout.trim();
  if (priorTree !== tree)
    throw new AppError((m) => m.run.publish.priorCommitDiffers, 409);
  const priorMessage = (
    await git(run.worktreePath, ["log", "-1", "--format=%B", commit])
  ).stdout.trim();
  if (priorMessage !== (run.draft.commitMessage?.trim() || run.draft.title))
    throw new AppError((m) => m.run.publish.priorMessageDiffers, 409);
}

/**
 * The address of the open PR on `repoFullName` whose head is `commit` on
 * `branch` of `headOwner`'s repository, if there is one. gh pr list --head
 * takes the branch name alone ("<owner>:<branch>" matches nothing), so the
 * owner is checked here.
 */
async function openPrUrl(
  repoFullName: string,
  branch: string,
  headOwner: string,
  commit: string,
) {
  const open = json<
    {
      url: string;
      headRefOid: string;
      headRepositoryOwner?: { login: string } | null;
    }[]
  >(
    (
      await command("gh", [
        "pr",
        "list",
        "--repo",
        repoFullName,
        "--head",
        branch,
        "--state",
        "open",
        "--json",
        "url,headRefOid,headRepositoryOwner",
      ])
    ).stdout,
  );
  return open.find(
    (pr) =>
      pr.headRefOid === commit &&
      pr.headRepositoryOwner?.login.toLowerCase() === headOwner.toLowerCase(),
  )?.url;
}

/**
 * Builds a fresh index from the reviewed base and stages only the reviewed
 * paths, checking each staged patch against what the person approved.
 * commit-tree then produces one clean commit, excluding any unreviewed
 * intermediate agent history.
 */
async function reviewedTree(
  ctx: WorkbenchContext,
  run: Run,
  files: DiffFile[],
) {
  // Build a fresh index from the reviewed base, then stage only explicitly reviewed paths.
  // commit-tree produces one clean commit, excluding any unreviewed intermediate agent history.
  const indexPath = path.join(
    ctx.store.directory,
    `publish-index-${run.id}`,
  );
  const indexEnv = {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
    GIT_TERMINAL_PROMPT: "0",
  };
  // The temporary index never outlives the publish, whatever happens.
  try {
    return await stageReviewedTree(run, files, indexEnv);
  } finally {
    await rm(indexPath, { force: true });
    await rm(`${indexPath}.lock`, { force: true });
  }
}

async function stageReviewedTree(
  run: Run,
  files: DiffFile[],
  indexEnv: NodeJS.ProcessEnv,
) {
  await git(run.worktreePath, ["read-tree", run.baseSha], {
    env: indexEnv,
  });
  await git(
    run.worktreePath,
    [
      "--literal-pathspecs",
      "add",
      "--",
      ...files.map((file) => file.path),
    ],
    { env: indexEnv },
  );
  const stagedFiles = (
    await git(
      run.worktreePath,
      [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--name-only",
        "-z",
        run.baseSha,
        "--",
      ],
      { env: indexEnv },
    )
  ).stdout
    .split("\0")
    .filter(Boolean)
    .sort();
  if (
    JSON.stringify(stagedFiles) !==
    JSON.stringify(files.map((file) => file.path).sort())
  )
    throw new AppError((m) => m.run.publish.stagedFilesDiffer, 409);
  for (const file of files) {
    const stagedPatch = (
      await git(
        run.worktreePath,
        [
          "--literal-pathspecs",
          "diff",
          "--cached",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          run.baseSha,
          "--",
          file.path,
        ],
        { env: indexEnv },
      )
    ).stdout;
    if (stagedPatch !== file.patch)
      throw new AppError(
        (m) => m.run.publish.fileChangedWhileStaging({ path: file.path }),
        409,
      );
  }
  const latest = await readDiff(run);
  if (reviewFingerprint(latest, run.draft) !== run.approvedFingerprint)
    throw new AppError((m) => m.run.publish.filesChangedWhilePublishing, 409);
  return (
    await git(run.worktreePath, ["write-tree"], { env: indexEnv })
  ).stdout.trim();
}
