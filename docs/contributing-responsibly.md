# Be the PR a maintainer is glad to open

Every open pull request asks a maintainer for time. AI agents make a
change cheap to produce, but not cheap to review, and many open-source
projects now write down what they expect from contributors who use AI
tools. BELL PR is built on one principle: **practise anything locally;
publish only what is welcome.** You can run agents on any project and
learn from the result on your own machine. Before anything reaches GitHub,
BELL PR asks you to explain the change back and checks it against what
maintainers ask for.

This page quotes what maintainers ask, in their own published words, shows
how each BELL PR check maps to it, lists the numbers BELL PR uses, and
says what BELL PR cannot see.

> The projects below are named only to quote rules they published
> themselves, as they read in October 2026. None of them endorses or is
> affiliated with BELL PR. Rules change and differ from project to
> project: always read the current rules of the project you contribute to.

Contents:

- [What maintainers ask](#what-maintainers-ask)
- [How BELL PR maps to it](#how-bell-pr-maps-to-it)
- [The numbers BELL PR uses](#the-numbers-bell-pr-uses)
- [What BELL PR cannot see](#what-bell-pr-cannot-see)
- [BELL PR never says a project allows AI](#bell-pr-never-says-a-project-allows-ai)

## What maintainers ask

### Understand everything you send

- The LLVM project's
  [AI tool policy](https://llvm.org/docs/AIToolPolicy.html): "Contributors
  must read and review all LLM-generated code or text before they ask
  other project members to review it." Contributors should also be "able
  to answer questions about their work" during review.
- The Linux kernel's
  [guidelines on tool-generated content](https://github.com/torvalds/linux/blob/master/Documentation/process/generated-content.rst):
  "You are expected to understand and to be able to defend everything you
  submit."
- Ghostty's
  [AI policy](https://github.com/ghostty-org/ghostty/blob/main/AI_POLICY.md):
  "The human-in-the-loop must fully understand all code."
- matplotlib's
  [contributing guide](https://github.com/matplotlib/matplotlib/blob/main/doc/devel/contribute.rst),
  in its list of unacceptable uses of generative AI: "Using AI output
  without ensuring that you fully understand the output or without
  verifying that it is the correct approach".

### Explain it in your own words

- The Python developer's guide,
  [Guidelines for using AI tools](https://devguide.python.org/getting-started/ai-tools/index.html):
  "We expect PR authors and those filing issues to be able to explain
  their proposed changes in their own words."
- curl's
  [pull request template](https://github.com/curl/curl/blob/master/.github/pull_request_template.md):
  "If you cannot understand or explain your work without using Artificial
  Intelligence (AI) then do not file here." and "Please explain your
  issues or improvements briefly and clearly in your own human voice."

### Small, focused, tested, and worth the review

- LLVM's [AI tool policy](https://llvm.org/docs/AIToolPolicy.html): "Our
  golden rule is that a contribution should be worth more to the project
  than the time it takes to review it."
- The Python developer's
  [Guidelines for using AI tools](https://devguide.python.org/getting-started/ai-tools/index.html):
  "Make minimal, focused changes", "Write tests that exercise the
  change", and "It is not acceptable to alter or bypass existing tests, or
  remove desired functionality, in order to make a failing test pass."
- curl's
  [contribution guide](https://github.com/curl/curl/blob/master/docs/CONTRIBUTE.md),
  "On AI use in curl": code written with the help of AI "must still follow
  coding standards, be written clearly, be documented, feature test cases
  and adhere to all the normal requirements we have."

### Start from an issue, and say so when AI helped

- Ghostty's
  [contributing guide](https://github.com/ghostty-org/ghostty/blob/main/CONTRIBUTING.md):
  "Pull requests should be associated with a previously accepted issue."
- Ghostty's
  [AI policy](https://github.com/ghostty-org/ghostty/blob/main/AI_POLICY.md):
  "All AI usage in any form must be disclosed."
- LLVM's [AI tool policy](https://llvm.org/docs/AIToolPolicy.html) asks
  contributors to "be transparent and label contributions" that contain
  substantial tool-generated content, for example with an `Assisted-by:`
  commit trailer.
- The Linux kernel's
  [guidelines for AI coding assistants](https://github.com/torvalds/linux/blob/master/Documentation/process/coding-assistants.rst):
  "AI agents MUST NOT add Signed-off-by tags." The human who submits is
  responsible for "Reviewing all AI-generated code."
- Disclosure is not the same everywhere. The Python developer's
  [Guidelines for using AI tools](https://devguide.python.org/getting-started/ai-tools/index.html):
  "Disclosure of the use of AI tools in the PR description is appreciated,
  while not required." Other projects do not accept AI-assisted
  contributions at all.

### Leave learning issues to learners

- LLVM's [AI tool policy](https://llvm.org/docs/AIToolPolicy.html):
  "Using AI tools to fix issues labelled as "good first issues" is
  forbidden."
- matplotlib's
  [contributing guide](https://github.com/matplotlib/matplotlib/blob/main/doc/devel/contribute.rst),
  on good first issues: "pull requests that are AI generated will be
  closed."

### Go deep, not wide, and stay for the review

- matplotlib's
  [contributing guide](https://github.com/matplotlib/matplotlib/blob/main/doc/devel/contribute.rst)
  lists as unacceptable "Increasing breadth of contributions, i.e.
  simultaneously contributing to several projects", and adds: "Instead of
  spreading your resources, you can provide greater value by engaging more
  deeply with one or two projects."
- LLVM's [AI tool policy](https://llvm.org/docs/AIToolPolicy.html):
  "Passing maintainer feedback to an LLM doesn't help anyone grow, and does
  not sustain our community."

### No agent acting on its own

- matplotlib's
  [contributing guide](https://github.com/matplotlib/matplotlib/blob/main/doc/devel/contribute.rst)
  lists as unacceptable "External AI tooling (e.g. bots, agents) directly
  interacting with the project", including creating issues and pull
  requests.

### What GitHub lets maintainers set

- [New repository settings for configuring pull request access](https://github.blog/changelog/2026-02-13-new-repository-settings-for-configuring-pull-request-access/)
  (GitHub changelog, February 13, 2026): maintainers can turn pull
  requests off, or set them so that "only collaborators (i.e., users with
  write access) can create new ones."
- [Limit open pull requests for users without write access](https://github.blog/changelog/2026-06-17-limit-open-pull-requests-for-users-without-write-access/)
  (GitHub changelog, June 17, 2026): maintainers can "set a maximum number
  of open pull requests that users without write access may have open".
  "Draft pull requests do not count towards a user's limit", and a person
  at the limit will "need to close or merge an existing pull request
  before opening another one."

## How BELL PR maps to it

Every check below is Free and works the same on every plan; no plan can
skip one. The switch for the understanding check controls only the
understanding check.

| What maintainers ask | What BELL PR does |
| --- | --- |
| Understand and defend what you send | Before approval you **explain the change back**: your own summary, questions about the riskiest files, what you did not test, then your own grades against AI-written references. The server holds approval and publishing until you have done it for the latest version of the change. It is on by default; turning it off in **Settings → Learning** marks every run approved without it "Check off" for good. During review, **try first** asks you to answer each file's question before the answer shows. |
| Review it yourself before you ask others to | Every file must be marked Reviewed at its current version, and you approve the pull request yourself. The commit holds only the files you reviewed, and the pull request is always a Draft. Neither can be switched off. |
| Your own words | **Use my explanation** puts your summary from the check at the start of the description, on a click. While the description is still BELL PR's suggested wording, publishing asks you to confirm it (`own-words`); where the project asks for the contributor's own words, it waits until you rewrite it. |
| Small, focused, tested | The Draft tab's reviewability snapshot shows the change's size beside the project's last merged pull requests. A very large change, source code changed without a test, files outside the plan, whitespace-only changes or new dependencies need your confirmation (`reviewability`). A skipped, deleted or loosened test blocks publishing until each one has your one-line reason (`tests-weakened`). The agent team is told never to weaken, skip or delete a test. |
| An issue first, and work nobody else is doing | The task dialog shows the linked issue's state, assignees, claims, other pull requests that would close it and the latest maintainer comment, before agents start. At publish, a closed issue blocks (`issue-closed`); someone else's open pull request for it blocks until you give a reason (`issue-has-pr`); an assignee, a claim, a not-ready label, a locked issue or a recently closed attempt asks you to confirm (`issue-state`). A rule that asks for an issue first, with no issue linked, asks you to confirm (`project-rules`). |
| Disclose AI help where the project asks | When the project's files require a disclosure, publishing waits until the description has one (`ai-disclosure`). BELL PR never adds one you did not choose, and never writes a `Signed-off-by` line for you. |
| Some projects do not accept AI-assisted contributions | A rule that says so, in a sentence about contributions, blocks publishing with no override (`ai-ban`); you can keep practising locally. A mention of AI without that context is only a confirm. |
| Leave learning issues to learners | An issue labelled for newcomers in a project whose rules reserve such issues blocks publishing (`area-reserved`). Without such a rule, the task dialog explains why newcomer issues matter before the team starts. Discovery looks for help-wanted issues for the agent team and marks newcomer issues "Learn by hand". |
| Go deep, not wide; stay for the review | Publishing is paced per repository (`pacing`, `pacing-max`; numbers below), and it asks you to confirm while a maintainer has waited more than 7 days for your answer to a review there. **Read feedback** is Free, and an AI follow-up round (Pro) starts only after you restate each selected comment in your own words. BELL PR never replies to maintainers for you. |
| Who may open a pull request | When GitHub reports that pull requests are off, the repository is archived or disabled, or only collaborators may open them and you are not one, publishing is blocked (`pr-closed`). The project overview says so as soon as a project is imported from GitHub. |
| No agent acting on its own | Agents never publish. Nothing reaches GitHub before your review and your approval (and, while the understanding check is on, your explanation), and BELL PR never comments on GitHub. Text in a project's files that is addressed to AI agents is also shown to you, because you are the author: you decide whether it applies (`project-rules`). |

[Troubleshooting](troubleshooting.md#publishing-was-blocked-by-a-project-rule-an-issue-or-pacing)
explains each block and how to clear it.

## The numbers BELL PR uses

These are BELL PR's own defaults. They are not research findings and not
any project's rule, and they are the same on every plan.

| What | BELL PR default |
| --- | --- |
| File questions in the understanding check | By the changed lines of the files that need review (lockfiles, generated files, whitespace-only changes and docs changes of 3 lines or fewer are left out): none up to 15 lines, 1 up to 100, 2 up to 400, 3 above. Plus "What did you not test, and why?" when source code changed. |
| Minimum length of your words in the check | 15 words for your explanation, 3 words for each answer (or "I don't know") and for each correction. A Chinese, Japanese or Korean character counts as one word. |
| Size bands of the reviewability snapshot | Small up to 100 changed lines, medium up to 400, large up to 1,000, very large above 1,000 lines or 20 files, after [Google's guidance on small changes](https://google.github.io/eng-practices/review/developer/small-cls.html) ("100 lines is usually a reasonable size for a CL, and 1000 lines is usually too large, but it's up to the judgment of your reviewer"). Lockfiles and generated files are not counted. A very large change asks whether it could be split. |
| Open pull requests per repository | 1 before your first pull request there is merged, 2 after. Drafts count, because BELL PR always opens drafts (GitHub's own limit leaves drafts out). At the budget publishing asks you to confirm; at twice the budget it waits. Repositories where you have write, maintain or admin permission are not paced, and local runs never are. |
| A maintainer waiting on you | A pull request of yours in that repository with changes requested and no update for more than 7 days asks you to confirm before you publish another. |
| Claims and earlier attempts on the issue | A claim comment from the last 30 days, and a pull request for the issue that was closed without merging in the last 90 days, ask you to confirm. |
| Your reason to publish next to someone else's pull request | 20 to 200 characters, saved on the run. |
| Your reason for a weakened test | At least 3 words for each flagged item. |
| Practice | Items come back after 1, 3, 7 and 21 days; a miss starts over at 1 day. |

## What BELL PR cannot see

- **Rules published outside the repository**, on a website, a wiki, a
  mailing list or in a separate documentation repository. BELL PR reads
  the repository's own files at the commit it cloned: contributing guides,
  AI policies, codes of conduct, pull request templates and agent guides
  at the root and in `.github/`, `docs/`, `doc/` and `Documentation/`,
  policy-named documents up to three folders deep, files that the
  contributing guide links to inside the repository, and the account's
  default files in its `.github` repository. When it finds no rule there,
  it says which files it read.
- **What a rule means for your change.** BELL PR finds rules by their
  wording and quotes them with their file and line. A quote shows that the
  text exists, not how the maintainers apply it. An unclear mention of AI
  is a confirm for you to decide, never a block and never a pass.
- **GitHub's own limit on open pull requests.** Only a repository's
  admins can read it. When GitHub refuses a pull request because of it,
  BELL PR explains that in plain words.
- **Lists of trusted contributors** and similar gates that a project keeps
  in its own format. Read the project's contributing guide.
- **Work that is not linked.** BELL PR finds other pull requests through
  GitHub's closing references to the issue. A pull request that fixes the
  same problem without linking the issue does not show.
- **Who wrote a piece of code.** BELL PR is not an AI detector. It knows
  that agents wrote a change because it ran them.
- **Whether the maintainers will want your change.** Passing every check
  means BELL PR found nothing against publishing, not that the change will
  be accepted.

When BELL PR cannot read a GitHub fact, because the GitHub CLI is signed
out, GitHub did not answer in time or the rate limit was reached, it says
"Couldn't check" and why. An unknown is never counted as a pass.

## BELL PR never says a project allows AI

BELL PR reports only what the files it read say. When it finds no rule,
the project overview reads "Not found in the N files BELL PR read. Some
projects publish their rules on a website or wiki; check before you
publish." It never says that a project has no policy, that nobody else is
working on an issue, or that a project allows AI-assisted contributions,
and passing its checks is not permission from the maintainers. Whether to
contribute, and how to describe the help you had, stays your decision
within each project's rules.
