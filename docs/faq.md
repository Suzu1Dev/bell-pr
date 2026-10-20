# Frequently asked questions

## The idea

### Does BELL PR open pull requests by itself?

No. Nothing reaches GitHub until you have reviewed every changed file,
explained the change back (unless you turned that check off) and approved
the exact title, description and commit. Even then BELL PR
opens a **Draft** PR, which you mark ready on GitHub when you are. It
never force-pushes, never replies to maintainers for you and never ticks a
template's checkboxes for you.

### Then what is it for?

Learning while you contribute, so that you keep your value when AI writes
more of the code. BELL PR is for developers who build with AI agents and
want to understand every line they send to an open-source project. An
agent team does the legwork in isolated worktrees. BELL PR then has you do
the part that makes you better:

- **Understand what you send.** Every change is explained in plain
  language, with an example, alternatives and a question you answer
  before you see the answer. Before you approve, you explain the whole
  change back in your own words.
- **Train your taste.** You choose between the approach the agents took
  and another one, predict what the maintainer will question, and later
  compare that with what the maintainers actually said. What you missed
  comes back in your practice deck.
- **Respect the maintainer's time.** BELL PR quotes the project's own
  rules and checks before you publish that the project takes pull requests
  from you, that the issue is still yours, that the change is reviewable
  and its tests are honest, and that you have answered your last review
  before you open the next pull request.

You review, you decide, and the pull request is yours. It is not a tool
for mass-producing automatic PRs; maintainers' time is precious. See
[Contributing responsibly](contributing-responsibly.md).

### Will maintainers know that AI helped?

That is your decision, within the project's rules. BELL PR mentions AI
assistance only when the project's rules require a disclosure (the draft's
checklist then quotes the rule) or when you turn the AI-assistance note on,
for one draft or for all of them under **Settings → Agent safety**. When
the project requires a disclosure, publishing waits until the description
has one; BELL PR never adds one you did not choose. Some projects do not
accept AI-assisted contributions at all: when the rules BELL PR reads say
so, it will not publish, and you can still practise locally. Read each
project's rules before you start. Discovery tells its agent to leave out
projects that say so.

### Can I turn the understanding check off?

Yes, under **Settings → Learning**. The switch asks you to confirm first
and says what changes: you can then approve a pull request you have not
explained back. Every file still has to be marked Reviewed, you still
approve the pull request yourself, and every project-rule, issue and
pacing check still applies. Runs approved without the check are marked
"Check off" for good, in the workspace, on the learning page and in the
learning record. Turn it back on at any time; runs already approved are
then held to it before they are published. On a shared or classroom
computer, `BELLPR_REQUIRE_UNDERSTANDING_CHECK=1` keeps the check on and
locks the setting; no variable turns it off.

The check is a commitment you make, not a test BELL PR grades: you grade
your own answers against the AI-written references, and no AI model is
asked.

### Does BELL PR detect AI-written code?

No. BELL PR is not an AI detector, and it never guesses who wrote a piece
of code, because such a guess can wrongly flag a person's own work. It
knows that agents wrote a change because it ran them, and it
treats every run as agent-written when a project's rules are about
AI-assisted contributions.

### Why did BELL PR block publishing?

A check found something the maintainers asked about: the project does not
take pull requests from you, its rules do not accept AI-assisted
contributions, a required disclosure or your own words are missing, the
linked issue is closed or someone else's pull request already fixes it,
the issue is kept for newcomers, a test was weakened without a reason, or
you have too many open pull requests there. The publish dialog names the
check and its source. [Troubleshooting](troubleshooting.md#publishing-was-blocked-by-a-project-rule-an-issue-or-pacing)
explains each one and how to clear it.

### Why does BELL PR limit open PRs per project?

Every open pull request waits on a maintainer's time, so BELL PR asks you
to close the loop on the ones you have before you open more in the same
repository. Its budget is 1 open pull request before your first one there
is merged and 2 after. At the budget publishing asks you to confirm, and
at twice the budget it waits until you finish or close one. These are BELL
PR defaults; repositories you can write to are not paced, and local runs
never are. GitHub also lets maintainers
[limit open pull requests for users without write access](https://github.blog/changelog/2026-06-17-limit-open-pull-requests-for-users-without-write-access/)
and
[restrict who can open pull requests](https://github.blog/changelog/2026-02-13-new-repository-settings-for-configuring-pull-request-access/).
BELL PR checks the second before you publish; the first only a
repository's admins can read, so BELL PR explains it when GitHub refuses
a pull request because of it.

### Why won't BELL PR's agents take good first issues?

Issues labelled "good first issue" (or similar) are how newcomers learn a
project by writing the fix themselves. When an agent team takes one, the
next newcomer loses that chance, and some projects say so in writing:
LLVM's [AI tool policy](https://llvm.org/docs/AIToolPolicy.html) forbids
using AI tools on them, and matplotlib's
[contributing guide](https://github.com/matplotlib/matplotlib/blob/main/doc/devel/contribute.rst)
says it closes AI-generated pull requests for them. So discovery looks for
help-wanted issues for the agent team and marks newcomer issues "Learn by
hand: write this one yourself". The task dialog explains this when you
link such an issue, and publishing is blocked when the project's own rules
reserve those issues.

## AI providers and costs

### Is BELL PR free?

Yes. BELL PR is open-source software under the
[Apache-2.0 license](../LICENSE), community-maintained and provided "as
is". Your Claude Code, Codex and GitHub usage counts against your own
accounts.

### Which AI does BELL PR use?

The AI coding CLI you installed and signed in to: the OpenAI Codex CLI or
Claude Code. BELL PR starts the CLI on your computer for each agent turn;
it has no model of its own and no BELL PR cloud.

### Do I need an API key? What does it cost?

BELL PR uses the sign-in your CLI already has. With the Codex CLI: BELL PR
uses the Codex CLI you installed and signed in to, and usage counts
against your own account. With Claude Code: BELL PR uses the Claude Code
CLI you installed and signed in to (Claude plan or Anthropic API key), and
usage counts against your own account. Your provider's prices and usage
limits apply. Agent teams run several agents at once, which uses your
limits faster; **Settings → Performance** sets how many run at the same
time.

Each run shows the usage the provider reported, as tokens and calls. BELL
PR does not convert it into money, and usage a provider does not report is
shown as unknown.

### Which models can I use?

The models your CLI offers. Choose the agent, the model and the reasoning
effort in the model settings; they are shared by every project, and each
run records the ones it started with. Each model lists the efforts it
supports, up to xhigh, max and ultra where it has them; leaving the effort
on "Default" uses the model's own default.

## Privacy and safety

### Does my code leave my computer?

Only to the services you set up yourself: your AI provider, through its
CLI, receives the instructions, the code the agents read and your
questions; GitHub receives what you import, search and publish. BELL PR
has no cloud service of its own and sends nothing to its maintainers.
There is no telemetry, no analytics and no account. Details:
[Privacy and your data](privacy-and-data.md).

### Can I use BELL PR on private repositories?

Yes, if your GitHub CLI account can access them. Remember that the agents
send the code they read to your AI provider; do not import a project whose
code your provider must not see.

### Can the agents harm my computer?

Agents run the imported project's code, its tests and build scripts, on
your computer, so import only projects you are willing to run. BELL PR
limits what they can do: agents that write code run in their CLI's
operating-system sandbox, which keeps their writes in the run's working
copy and closes the network; Claude Code agents are also denied your SSH
keys, the GitHub CLI's sign-in and BELL PR's own data, while Codex's
sandbox does not limit reading; and the project's own agent instructions
and settings are never loaded. If you allow unsandboxed Claude Code
agents, they have your full user rights, and those runs are marked. The
[security model](security-model.md) explains every protection and its
limits.

Agents are also told never to change the machine: no `sudo` and no
global or user-level installs. When a check needs a tool the machine
lacks, the run's overview lists it with a suggested command, for you to
check against the project's documentation and run yourself; BELL PR never
runs it.

### Why do I need a sign-in link for a program on my own computer?

BELL PR is a local web server. The link proves that the browser belongs to
you and not to another user of the computer, another machine or a web page
you visit. Lost it? Run `bell-pr open`.

## Using it

### Which platforms does it run on?

macOS, Linux, and Windows through WSL2. It needs Node.js 22 or later, Git,
the GitHub CLI and the Codex CLI or Claude Code. There is also a Docker
image, in beta: [Docker](docker.md).

### Does it work with GitLab or Bitbucket?

Not for publishing: BELL PR imports from GitHub and opens pull requests
there. You can import a local Git repository without a GitHub remote to
analyze it, run agents and review the changes, but such runs cannot be
published.

### Can I change the agents' code myself?

Yes. **Code changes** shows the run's worktree path with a copy button.
Edit the files in your own editor (do not commit; BELL PR does that when
you publish), then choose **Refresh the diff**. Changed files get new
explanations and need another review.

### Can several people use one BELL PR?

No. BELL PR is a single-user tool: it works with one person's Git, GitHub
and AI sign-ins. Each person runs their own. To reach your BELL PR from
another of your machines, put an HTTPS reverse proxy in front of it, as
[Self-hosting](self-hosting.md) describes; never expose it to the internet
without one.

### Can I run two BELL PRs on one computer?

Yes, with different data directories and ports, for example
`bell-pr start --data-dir ~/bellpr-work --port 4400`. Each data directory
allows one running BELL PR, and the sign-in cookies of different ports do
not interfere.

### Which languages does it speak?

English and Traditional Chinese (Taiwan). The language you choose applies
to the interface and to what agents write for you. Pull request titles and
descriptions stay in English unless the project's rules ask for another
language.

### Can I show BELL PR in a talk or a screen share?

Yes. Add `?present=1` to the address after the `#/…` part, for example
`#/home?present=1`: your GitHub login then reads "you" and paths lose their
folders. The sample project can play its whole run as a timeline with
`#/runs/demo-run/activity?demo=play`; `speed=1` to `4` sets the pace, and
`locale=en` or `locale=zh-TW` sets the language for that page load only.

### Does an address with `?run=` still open?

Yes. An address that keeps the view in a query string, such as
`?run=<id>&tab=draft`, `?project=<id>` or `?page=discovery`, opens the
same contribution, tab, project or page, and the address bar switches to
the `#/…` form.

### Where is my data, and how do I delete it?

In `~/.bellpr` unless you chose another data directory. **Settings → Data &
privacy** shows its size, frees the files of single runs and deletes
everything. See [Privacy and your data](privacy-and-data.md#deleting-data).

### Does BELL PR change my Git or CLI configuration?

No. BELL PR never changes the global configuration of Git, the GitHub CLI,
the Codex CLI or Claude Code. It runs them with its own options for each
command. The fix commands it suggests (for example `git config --global
user.email …`) are for you to run.
