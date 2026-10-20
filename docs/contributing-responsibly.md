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
- [Learn by hand and a project's AI rules](#learn-by-hand-and-a-projects-ai-rules)
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
| Disclose AI help where the project asks | When the project's files require a disclosure, publishing waits until the description has one (`ai-disclosure`). BELL PR never adds one you did not choose, and never writes a `Signed-off-by` line for you. In a Learn-by-hand run, see [below](#learn-by-hand-and-a-projects-ai-rules) for what counts. |
| Some projects do not accept AI-assisted contributions | A rule that says so, in a sentence about contributions, blocks publishing with no override (`ai-ban`); you can keep practising locally. A mention of AI without that context is only a confirm, and so is a rule against crediting AI as a commit's co-author, against AI-written commit messages or against large AI-generated pull requests: a rule to weigh, quoted for you to decide on. In a Learn-by-hand run the block says what the rule covers, and only a rule on AI-generated content can lead to a confirm instead ([below](#learn-by-hand-and-a-projects-ai-rules)). |
| Leave learning issues to learners | An issue labelled for newcomers in a project whose rules reserve such issues blocks publishing (`area-reserved`). Without such a rule, the task dialog explains why newcomer issues matter before the team starts. Discovery looks for help-wanted issues for the agent team and marks newcomer issues "Learn by hand"; their cards offer **Start learning by hand**, except where the project keeps such issues for people learning without AI tools. |
| Go deep, not wide; stay for the review | Publishing is paced per repository (`pacing`, `pacing-max`; numbers below), and it asks you to confirm while a maintainer has waited more than 7 days for your answer to a review there. **Read feedback** is Free, and an AI follow-up round (Pro) starts only after you restate each selected comment in your own words. BELL PR never replies to maintainers for you. |
| Who may open a pull request | When GitHub reports that pull requests are off, the repository is archived or disabled, or only collaborators may open them and you are not one, publishing is blocked (`pr-closed`). The project overview says so as soon as a project is imported from GitHub. |
| No agent acting on its own | Agents never publish. Nothing reaches GitHub before your review and your approval (and, while the understanding check is on, your explanation), and BELL PR never comments on GitHub. Text in a project's files that is addressed to AI agents is also shown to you, because you are the author: you decide whether it applies (`project-rules`). |

[Troubleshooting](troubleshooting.md#publishing-was-blocked-by-a-project-rule-an-issue-or-pacing)
explains each block and how to clear it.

## Learn by hand and a project's AI rules

In a Learn-by-hand run you write the change yourself, BELL PR's agents
only read, and the guide helps: it explains, answers your questions, gives
hints and, when you ask, reviews your change and explains a test failure.
That is still AI help, and the run's record lists every kind you used.
Learn by hand changes what BELL PR can truthfully say about a run; it
doesn't change what a project's rules say.

### What stays the same

Every check in the table above applies to a Learn-by-hand run too. A rule that restricts AI help itself (for example, a ban on
any content made with the assistance of AI tools), a rule whose reach
BELL PR can't tell from its words, and an issue the project keeps for
people learning without AI tools each block publishing, with no override,
whichever mode you chose. You can still practise on such a project with
every kind of the guide's help; BELL PR just won't publish the run there.

The task dialog says which case applies before you write a line: that
BELL PR won't publish a learn-by-hand run here, and why, or that it can
only if the guide stays within what the project's own text says is fine.
Learn by hand is never preselected on a project whose rules ban AI
contributions or keep issues for newcomers, and discovery never offers
**Start learning by hand** for an issue the project keeps for people
learning without AI tools.

### What BELL PR can and can't say about a Learn-by-hand run

The publish dialog shows the run's record: the kinds of help you used and
how often, BELL PR's runs of your tests and your predictions, and how many
answers BELL PR removed code from. When the run's history is clean (BELL
PR saw no agent write to its files, and no teammate, team task, AI
follow-up round or agent conflict resolution ever joined the run), the
record says:

> BELL PR's agents had no write access and gave you no code for this
> change. The guide showed only quotes of the project's code and of your
> own edits.

Otherwise it says why it makes no Learn-by-hand claim for the run. It
always adds that BELL PR can't see other tools you used, such as editor
autocomplete or another chat, and that the record is for you: it isn't
proof of who wrote the code.

BELL PR never writes a sentence in your voice and never adds a trailer;
how you describe the help you had is yours, within the project's rules.
Where a project asks contributors to say how they used AI, a sentence of
your own that names the AI and says what it did (it explained, answered,
reviewed, pointed out, hinted at or guided you through something) counts
as that disclosure in a clean Learn-by-hand run, and a negated one, such
as "Not reviewed by AI.", does not. In an agent run these words never count. When your text says that no
AI helped, in a run where the guide did help, the publish dialog quotes
that line next to your help record and asks you to confirm or reword it;
it never calls the line true or false.

### Ask the project's people

The guide's **Ask a human** exit links the issue and, when the project's
contributing files name them, the places where its people talk: Zulip,
Discord, Discourse, Matrix, mailing lists, Gitter or the repository's
GitHub Discussions, each with the file and line it came from. It gives
you a short note to fill in yourself; BELL PR writes none of it.

### When the project's own text says some uses of AI are fine

Some projects decline AI-generated content and say, in their own text,
which uses of AI are fine. matplotlib's
[contributing guide](https://github.com/matplotlib/matplotlib/blob/main/doc/devel/contribute.rst),
for example, lists "Gaining understanding of the existing code" and
"Getting solution ideas" among its acceptable uses. For such a project, a
Learn-by-hand run can end in a **quoted confirm** instead of a block:
the publish dialog quotes the project's rule and its text next to your
help record, and asks you to confirm. BELL PR is quoting the project, not
deciding for it: the project's maintainers decide whether your change
fits. The confirm is never an override, takes no reason, and never
appears for an agent run.

It appears only when all of these hold:

1. **The rule is about AI-generated content.** It declines AI-generated
   contributions, or closes AI-generated or automated pull requests for
   issues it keeps for newcomers. Never for a rule on AI help itself, a
   rule whose reach BELL PR can't tell, or an issue kept for people
   learning without AI tools. While a rule that refuses AI help itself
   stands anywhere in the project's rules, no confirm appears.
2. **The project's own text names every kind of help the run used.** The
   text is in the same document as the rule in the project's repository,
   or, for a rule from BELL PR's checked list (below), in the same entry,
   which BELL PR's publisher signed off and whose quotes were checked
   within the last 90 days. BELL PR reads such text narrowly:
   understanding or explaining the code, research, and questions about
   the code name explanations and answers; debugging names help with test
   failures; a private review of your own code names reviews; possible
   solutions or solution ideas name planning help. They count only where AI gives that help, and other
   words, such as "static analysis" or "suggest", name no kind of help.
   Text in code or code comments, quotes of other projects' rules, items
   listed as not acceptable, proposals, sentences with a condition (if,
   when, unless, except) and permissions taken back ("…, but … not
   accepted") never count.
3. **The run's history is clean**: BELL PR's agents had no write access
   and gave you no code for the change.
4. **BELL PR read the project's rules during this run.** If it read them
   before the run started, choose **Check again**.
5. **The run was fitted to that text when it started.** In the task
   dialog you chose **Fit the guide to the project's rules**, so for the
   whole run the guide offered only the kinds of help the text names. A
   run started with every kind of help can't be fitted later, and a run
   whose quoted text has since left the project's rules no longer
   qualifies.
6. **You confirm** in the publish dialog, after reading the quoted rule,
   the project's text and your help record.

When any of them fails, publishing stays blocked, and the block says
which condition failed. QEMU's policy on AI-generated content has such
text, but QEMU's GitHub repository doesn't take pull requests, so BELL PR
can't publish there at all.

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
| An entry of BELL PR's checked list | Checked more than 90 days ago, it still blocks but never leads to the quoted confirm. |

## What BELL PR cannot see

- **Rules published outside the repository**, on a website, a wiki, a
  mailing list or in a separate documentation repository. BELL PR reads
  the repository's own files at the commit it cloned: contributing guides,
  AI policies, codes of conduct, pull request templates and agent guides
  at the root and in `.github/`, `docs/`, `doc/` and `Documentation/`,
  policy-named documents up to three folders deep, files that the
  contributing guide links to inside the repository, and the account's
  default files in its `.github` repository. When it finds no rule there,
  it says which files it read. BELL PR also ships a short, dated checked
  list of AI rules that some projects publish outside their repositories.
  It reads an entry only once BELL PR's publisher has signed it off, adds
  its rules to the ones in the repository (it never removes or softens
  one), and shows them as "From BELL PR's checked list · checked on
  <date>".
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
  that agents wrote a change because it ran them. In a Learn-by-hand run
  it knows what its own agents did and what help the guide gave, and
  nothing about other tools you used.
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
