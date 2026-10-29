# Security policy

BELL PR is open-source software under the Apache License 2.0, maintained by
its community and provided "as is". This page says how to report a
vulnerability privately and what to expect. How BELL PR protects your
computer, and where those protections end, is described in
[docs/security-model.md](docs/security-model.md).

## Supported versions

| Version | Security fixes |
| --- | --- |
| The latest release (while there is no stable release, the newest pre-release) | Yes |
| Earlier releases | No: update to the latest release |

Security fixes ship as new releases, with a note in
[CHANGELOG.md](CHANGELOG.md).

## Reporting a vulnerability

Report a vulnerability privately. Do not open a public issue, pull request
or discussion about it.

- On GitHub, open the repository's **Security** tab and choose **Report a
  vulnerability**. This is GitHub's private vulnerability reporting: only
  you and the maintainers see the report.

<!-- generated:product-link key=securityEmail text="You can also write to the security contact." -->
<!-- /generated:product-link -->

Please include:

- the BELL PR version (`bell-pr --version`), your operating system, and the
  versions of the agent CLIs involved (`bell-pr doctor` lists them);
- the steps to reproduce the problem, and what an attacker gains;
- whether and when you plan to publish your findings.

Do not include real tokens or private data; use test values.

## What to expect

BELL PR is maintained by people in their own time, so these are goals, not
guarantees:

- We aim to acknowledge your report within 7 days and to keep you informed
  while we investigate and fix it.
- We aim to credit you in the release notes, unless you prefer not to be
  named.
- We ask you to give us a reasonable time to ship a fix before you publish
  details; 90 days is a common rule. If a fix needs more time, we will tell
  you why. If you plan to publish sooner, say so in your report.

## Scope

In scope, because the design relies on them:

- the local server: the host and origin checks, and the content security policy;
- the agent sandbox and the environment agents get: the agent CLIs' sandbox
  settings, the credential files agents are denied, the refusal to start
  agents that change code without a sandbox, and the masking of secrets in
  logs and diagnostics;
- how imported repositories are handled: the local git configuration they
  may carry and the agent instruction files they contain are untrusted;
- the publish path: the checks of the pull request text, the confirmations
  before CI workflow changes, and what leaves your computer when you publish;
- the Docker image and the files in `contrib/`.

**Known limitation.** Tokens in your system keyring are not covered. Your main
protection is a fine-grained token with the minimum permissions you need.
This is known and tracked; reports of this same behavior are not eligible as
new vulnerabilities. A different way around the sandbox is still in scope:
report it through GitHub private vulnerability reporting.

Out of scope:

- attacks that need code already running as your user account, or
  administrator access to your computer;
- vulnerabilities in GitHub, OpenAI, Anthropic, the GitHub CLI, the Codex
  CLI, Claude Code or other dependencies: report those to their maintainers
  (we still want to know when a dependency's flaw reaches BELL PR);
- effects of a hostile repository that stay within the limits described in
  the security model, such as changes to its own working copy;
- pull requests that you approved and published, and runs with unsandboxed
  agents, which you chose to trust fully.

## Safe harbor

We consider security research that follows this policy to be authorized,
and we will not take legal action against it, as long as you act in good
faith: you stay within your own installation and accounts, you do not harm
other people's data, privacy or services, you do not read or keep more data
than you need to show the problem, and you give us a reasonable chance to
fix it before you publish. We cannot speak for others: GitHub, the AI
providers and the owners of repositories you test against set their own
rules.
