# Legal review: every claim mapped to the code

This is the automated half of the legal review of BELL PR 1.0. Each claim in
the five legal documents is marked with an HTML comment such as
`<!-- claim:PRIV-07 -->` after the sentence or sentences it covers, and has
exactly one row below. A row names the code that implements the claim
(`path:line` at the time of this review) or says **owner decision**: a
statement only the owner or counsel can make true, such as a legal term, a
price or a contact.

The other half is a person's review: the product lead reads the texts against
the security, privacy and licensing modules, and counsel reviews them before
any payment is taken (owner gate G4). Both are pending.

| Document | Claims | Owner placeholders | EULA version |
| --- | --- | --- | --- |
| LICENSE.md (EULA) | EULA-01 to EULA-66 | 5 | `1.0-draft-2026-10-14` (`shared/product.ts` `eulaVersion`) |
| PRIVACY.md | PRIV-01 to PRIV-57 | 4 | |
| TERMS.md | TERMS-01 to TERMS-34 | 4 | |
| REFUND.md | REFUND-01 to REFUND-19 | 5 | |
| SECURITY.md | SEC-01 to SEC-37 | 1 | |

## How the check works

`node site/build-legal.mjs --check` (also run by `node site/check-site.mjs`)
fails when:

- a claim ID in a legal document has no row here, a row has no claim in the
  documents, or an ID appears twice;
- a row names neither "owner decision" nor a `path:line` reference, or a
  reference points to a missing file or past its last line;
- the number of lines with an `[OWNER` placeholder in a document differs
  from the length of its owner placeholder list, or a document says TODO or
  TBD;
- a page in `site/legal/` is not the current rendering of its document.

Line numbers drift as the code changes; the check only catches references
that no longer exist. When a claim's code moves, update its row.

When the text of LICENSE.md changes, change `eulaVersion` in
`shared/product.ts` and the `EULA version:` line together
(`shared/product-eula.test.ts` checks that they match), so the app asks
everyone to accept the new text. After counsel's review the version becomes
`1.0` and the DRAFT banners go.

## Corrections made in this review

The wave-1 drafts described planned behavior. These statements were wrong
or incomplete against the shipped code and are corrected in the documents:

- **AI disclosure (TERMS-21, EULA-38).** The drafts said BELL PR adds a
  disclosure line to every pull request by default. It is off by default:
  the line appears when the person turns it on for one draft or in Settings
  (`shared/app-settings.ts:34`, `server/drafts.ts:111`, `server/drafts.ts:321`),
  or in the suggested description when the project's own rules ask for a
  disclosure (`src/draft/DraftGuidancePanel.tsx:129`).
- **Retention (PRIV-38).** The drafts said the working copies of finished,
  cancelled and failed runs are removed after 14 days. Only cancelled and
  failed runs are (`server/cleanup.ts:33`); runs in review, approved and
  published runs keep their checkout until the person frees it.
- **Data inventory (PRIV-34).** Added `author-emails.json`
  (`server/publish.ts:53`), `state.json.corrupt-<time>`
  (`server/store.ts:393`), the AI-assistance note setting, and the temporary
  index files with their cleanup (PRIV-35).
- **Session token (SEC-14, SEC-16).** The drafts said the token is never on a
  command line. It was never on BELL PR's own, but the startup link that
  holds it was passed to `open`/`xdg-open` when BELL PR opened the browser.
  Since finding 1 was fixed, the browser gets a one-time link instead
  (`server/index.ts:555`, `server/cli.ts:173`), so the token is on no
  command line, and SEC-14 and SEC-16 say so.
- **Web access (PRIV-28, PRIV-29, SEC-32).** Named which agents get it
  (`server/run-executor.ts:134`), the Claude Code WebFetch domain list
  (`server/agent-cli.ts:38`) and Codex's live web search
  (`server/agent-cli.ts:205`).
- **Update period (EULA-09, EULA-10).** Tied to the "updates until" date the
  key carries (`server/license.ts:114`, `server/license.ts:245`), since keys
  from a pre-signed pool count it from the day the pool was issued; see
  finding 2.
- **What is sent to the AI provider (PRIV-18, PRIV-19).** Added maintainer
  feedback and check results for coaching and follow-up rounds, and what
  discovery sends.
- **Diagnostics (PRIV-53)** now lists what the report holds and what it
  masks (`server/routes/maintenance.ts:85`).
- **Docker (SEC-36).** The agent sandbox cannot start under Docker's default
  options for Claude Code or Codex (`server/sandbox.ts:59`, and the probe in
  the "Agent sandbox in Docker" section of `docs/docker.md`).
- **Sign-ins (EULA-28, PRIV-10).** The texts said BELL PR never reads the
  tools' tokens. It does not store them, but it passes the CLIs' own sign-in
  variables through (`server/process.ts:125`) and runs `gh auth token` to
  see whether a sign-in exists (`server/doctor.ts:299`); the texts now say
  that it only asks the tools whether the person is signed in.
- **The tools' own usage data (PRIV-12).** The texts said the tools' own
  settings decide. The agents get only the variables their CLI needs
  (`server/process.ts:50`), plus, since finding 7 was fixed, the usage-data
  opt-outs the person set (`server/process.ts:108`); the Codex CLI starts
  without its `config.toml` (`server/agent-cli.ts:191`), so an opt-out made
  only there does not reach them.
- **Refunded seats (REFUND-14).** A revocation covers a whole key
  (`server/license-keys.ts:19`), so a key that also holds kept seats is
  replaced.

## Findings for the product lead

These are differences between the code and other files that 7B does not
own. The legal texts already describe the shipped behavior.

1. **Startup sign-in link on a command line.** Fixed after the merge: BELL
   PR opened the startup link, which carries the session secret itself,
   through `open`/`xdg-open` (`server/cli.ts:173`), so it could appear in a
   process list that other local users can read. It now opens a one-time
   link (`mintOneTimeToken`, `server/index.ts:555`) instead,
   `server/cli.test.ts` checks the opener's arguments, and SECURITY.md
   (SEC-14, SEC-16) and `docs/security-model.md` say so.
2. **Update period of pool keys.** `tools/license/issue.ts:154` sets `upd`
   12 months from the day a key is issued, which for a pre-signed pool is
   the day the pool was made. The plan copy ("perpetual use of the builds
   released within 12 months of purchase", `shared/i18n/plans.en.ts`, in the
   generated tables of the site, the READMEs and TERMS.md) promises 12
   months from purchase. The owner should issue pools close to the sale, use
   a longer `--updates-months`, or change the copy.
3. **Web access copy.** Fixed after the merge: the plan copy said "Pro: on,
   limited to an allowlist of domains", but web access is off until the
   person turns it on, only Claude Code's WebFetch has a domain allowlist
   (`server/agent-cli.ts:38`), and Codex's live web search has none
   (`server/agent-cli.ts:205`). `shared/i18n/plans.{en,zh-TW}.ts` now say
   so, and the generated tables are rebuilt.
4. **Claim markers in the app.** Fixed after the merge:
   `scripts/generate-third-party-notices.mjs` now leaves HTML comments (the
   `claim:` and generated-region markers) out of the `dist/legal/*.txt`
   copies that the app shows, and `scripts/check-pack.mjs` fails when one
   remains. The owner placeholder lists stay visible there while the texts
   are drafts.
5. **REFUND.md is not in the app.** Fixed after the merge: the About
   dialog offered the EULA, privacy policy, terms and security policy, but
   not the refund policy that the EULA and the terms refer to. The build
   now copies REFUND.md to `dist/legal/REFUND.txt` like the others, without
   its HTML comments, `scripts/check-pack.mjs` requires it, and About lists
   it.
6. **CI.** Fixed after the merge: the build-and-test job of
   `.github/workflows/ci.yml` now runs `node site/check-site.mjs` and
   `node site/build-legal.mjs --self-test`, so CI catches a stale legal
   page or claim table.
7. **Usage-data opt-outs.** Fixed after the merge: `agentEnvironment()`
   passed only the listed variables, so an opt-out such as
   `DISABLE_TELEMETRY` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set in
   the environment did not reach Claude Code. It now passes `DO_NOT_TRACK`
   to both CLIs and Claude Code's documented opt-out variables to Claude
   Code (`server/process.ts:108`, tested in `server/process.test.ts`).
   `codex exec --ignore-user-config` (`server/agent-cli.ts:191`) still
   skips any setting in the person's Codex `config.toml`, such as
   `[analytics] enabled = false`; the Codex flags are unchanged, and
   PRIVACY.md and `docs/privacy-and-data.md` say so.

## Evidence: no telemetry, no contact with the seller

Commands run on the tree of this review, test files excluded:

- `git grep -n "fetch(" -- server src` finds `src/api.ts:196`, the web
  interface's same-origin requests to `/api`, and two lines of sample diff
  text in `src/demo/shared.ts`. The server makes no `fetch` call.
- `git grep -nE 'from "node:(https?|net|tls|dgram|http2)"' -- server src shared bin`
  finds `server/index.ts:25` (`node:http`: BELL PR's own server and the
  health probe that `bell-pr open` sends to it on this computer) and
  `server/config.ts:8` (`isIP` from `node:net`).
- `git grep -n "https://" -- server src` (fixtures, i18n and sample data
  excluded) finds only GitHub URLs that are handed to `git` and `gh` under
  the person's account, links the person clicks, and text.
- No update check, analytics or error-reporting package is a dependency
  (`package.json`), and the interface's content security policy allows
  only its own origin (`server/http-guard.ts:83`).

## LICENSE.md (EULA)

| ID | Claim | Implemented by, or owner decision |
| --- | --- | --- |
| EULA-01 | The agreement is a contract with the licensor [OWNER] | Owner decision: licensor entity (G4) |
| EULA-02 | The Pro Feature Set is what a key or the trial unlocks, as the app's plan comparison and the table in TERMS.md list it | `shared/plans.ts:14`, `shared/plans.ts:170`, `src/license/UpgradeDialog.tsx:98`; TERMS.md table generated by `scripts/render-generated-regions.ts` |
| EULA-03 | Installing or using the Software means agreeing | Owner decision: counsel review (G4) |
| EULA-04 | The web interface asks to accept this version before first use and again when it changes, and stays locked until then | `src/onboarding/Welcome.tsx:156`, `src/onboarding/eula.ts:8`, `src/app/AppShell.tsx:432`, `src/onboarding/EulaPrompt.tsx:58`, `shared/product.ts:67`, `shared/product-eula.test.ts:12` |
| EULA-05 | Accepting for an organization binds it | Owner decision: counsel review (G4) |
| EULA-06 | Free License grant on computers you own or control | Owner decision: counsel review (G4); Free is the plan without a key, `shared/plans.ts:52` |
| EULA-07 | Free allows commercial use [OWNER] | Owner decision: commercial terms |
| EULA-08 | Pro grant per seat for one Named User, on several of their computers | Owner decision: counsel review (G4); keys carry `seats` and no device binding, `server/license.ts:100` |
| EULA-09 | The Update Period ends on the key's "updates until" date, shown in Settings and `bell-pr license status` | `server/license.ts:114`, `server/license.ts:245`, `src/license/LicenseCard.tsx:110`, `server/license.ts:855` |
| EULA-10 | That date is 12 months after purchase unless the order says otherwise [OWNER] | Owner decision: license term; `tools/license/issue.ts:154` (12 months from issue by default; finding 2) |
| EULA-11 | After the Update Period, earlier builds keep Pro and later builds run Free | `server/license.ts:245`, `server/license.ts:729`, `server/license.ts:754` |
| EULA-12 | A key with an expiry date keeps Pro for a 7-day grace period | `server/license.ts:241`, `shared/plans.ts:69` |
| EULA-13 | A seat belongs to one Named User; reassignment allowed, sharing not | Owner decision: counsel review (G4); not enforced in code |
| EULA-14 | One 14-day trial per data directory, started by the person, ending on its own | `shared/plans.ts:66`, `server/license.ts:502`, `server/license.ts:711`, `server/routes/license.ts:46` |
| EULA-15 | The trial is free and section 4 applies to it | Owner decision: counsel review (G4) |
| EULA-16 | License keys are checked offline and never sent anywhere | `server/license.ts:254`, `server/license-keys.ts:17`; no network module, see the evidence above |
| EULA-17 | Keep the key confidential | Owner decision: counsel review (G4); keys are masked in logs and agent text, `server/secrets.ts:17` |
| EULA-18 | Revocation of refunded, charged-back, leaked or misused keys reaches only later builds; using a revoked key breaches the EULA | `server/license-keys.ts:12`, `server/license-keys.ts:19`, `server/license.ts:236`; owner decision for the legal part |
| EULA-19 | The restrictions apply to Free, Pro and the trial | Owner decision: counsel review (G4) |
| EULA-20 | No redistribution, resale or sublicensing | Owner decision: counsel review (G4) |
| EULA-21 | No circumventing license checks, the trial limit, the acceptance prompt or notices | Owner decision: counsel review (G4); the checks are `server/license.ts:254` and `src/onboarding/eula.ts:8` |
| EULA-22 | No hosting the Software for others | Owner decision: counsel review (G4) |
| EULA-23 | No publishing, sharing or generating keys, no revoked keys | Owner decision: counsel review (G4) |
| EULA-24 | No unlawful use or use against third-party terms | Owner decision: counsel review (G4) |
| EULA-25 | Open-source components are under their own terms, listed in THIRD_PARTY_NOTICES.md | `THIRD_PARTY_NOTICES.md:1`, generated by `scripts/generate-third-party-notices.mjs:47` |
| EULA-26 | THIRD_PARTY_NOTICES.md holds a written source offer for GPL/LGPL programs in the container image | `THIRD_PARTY_NOTICES.md:271`; owner decision for the contact (TERMS-32) |
| EULA-27 | The Software works through git, gh and the Codex CLI or Claude Code under the person's accounts | `server/agent-cli.ts:149`, `server/process.ts:125`, `server/publish.ts:505` |
| EULA-28 | It does not store the tools' passwords or tokens, and only asks the tools whether the person is signed in | `server/process.ts:125` (passes the CLIs' own sign-in variables through), `server/agent-cli.ts:219` (sign-in checked with each CLI's own status command), `server/doctor.ts:299` (`gh auth token` only shows that a sign-in exists; its output is not kept) |
| EULA-29 | Third-party terms, fees and quotas are the person's | Owner decision: counsel review (G4) |
| EULA-30 | The seller does not control or answer for third-party services | Owner decision: counsel review (G4) |
| EULA-31 | No affiliation with GitHub, OpenAI or Anthropic | Owner decision: trademark and provider terms (G1, G5) |
| EULA-32 | AI models analyse, plan, change code, explain and draft PR text | `server/insights.ts:1257`, `server/run-executor.ts:695`, `server/run-executor.ts:753`, `server/learning.ts:229`, `server/draft-jobs.ts:121` |
| EULA-33 | AI output can be wrong, insecure or resemble licensed code | Owner decision: counsel review (G4); the app says so at `src/i18n/en/review.ts:97` |
| EULA-34 | The person must review everything before relying on it | Owner decision: counsel review (G4) |
| EULA-35 | Nothing is published until every changed file is reviewed and the PR text approved | `server/publish.ts:269`, `server/publish.ts:332`, `server/publish.ts:352` |
| EULA-36 | The person is responsible for what they publish | Owner decision: counsel review (G4) |
| EULA-37 | AI-written analyses, recommendations, explanations and answers are labelled AI-generated | `src/mission/ProjectOverview.tsx:1060`, `src/mission/ProjectOverview.tsx:1131`, `src/review/ExplanationPanel.tsx:72`, `src/review/ExplanationPanel.tsx:852`, `src/learning/LearningNotes.tsx:158` |
| EULA-38 | The disclosure line is the person's choice: off unless turned on or the project's rules ask | `shared/drafts.ts:86`, `server/drafts.ts:111`, `server/drafts.ts:381`, `src/draft/DraftGuidancePanel.tsx:129` |
| EULA-39 | Agents run commands and the projects' own code on the computer | `server/agent-cli.ts:54` (write roles get Bash), `server/agent-cli.ts:201` (Codex `workspace-write`) |
| EULA-40 | Each run has its own working copy; Claude Code write agents run only in its sandbox, Codex agents in Codex's | `server/workbench.ts:514`, `server/sandbox.ts:153`, `server/agent-cli.ts:105`, `server/agent-cli.ts:201` |
| EULA-41 | No sandbox is complete | Owner decision: risk statement for counsel (G4) |
| EULA-42 | Unsandboxed agents have the user's full permissions, and such runs are marked | `server/sandbox.ts:161`, `server/run-executor.ts:226`, `src/workspace/RunNotices.tsx:16` |
| EULA-43 | Import only projects you are willing to run; accept the risks | Owner decision: counsel review (G4) |
| EULA-44 | The Software runs on the computer and stores its data there | `server/config.ts:72`, `server/config.ts:97` |
| EULA-45 | No telemetry, never contacts the seller | `src/api.ts:196`, `server/index.ts:25`; see the evidence above |
| EULA-46 | No obligation to provide updates or support beyond the Update Period | Owner decision: counsel review (G4) |
| EULA-47 | The seller owns the Software; licensed, not sold | Owner decision: counsel review (G4) |
| EULA-48 | No ownership claimed in the person's output | Owner decision: counsel review (G4) |
| EULA-49 | Warranty disclaimer | Owner decision: counsel review (G4) |
| EULA-50 | Exclusion of indirect damages | Owner decision: counsel review (G4) |
| EULA-51 | Liability cap at 12 months of fees | Owner decision: counsel review (G4) |
| EULA-52 | Liability that cannot be limited stays | Owner decision: counsel review (G4) |
| EULA-53 | Mandatory consumer rights prevail | Owner decision: counsel review (G4) |
| EULA-54 | The person may end the agreement by uninstalling | Owner decision: counsel review (G4) |
| EULA-55 | Licenses end on breach or refund | Owner decision: counsel review (G4) |
| EULA-56 | Effects of termination and surviving sections | Owner decision: counsel review (G4) |
| EULA-57 | Export control and sanctions | Owner decision: counsel review (G4) |
| EULA-58 | Governing law and venue [OWNER] | Owner decision: governing law (G4) |
| EULA-59 | Each EULA version carries its own version line | `shared/product.ts:67`, `shared/product-eula.test.ts:12` |
| EULA-60 | A new version is asked for before use; earlier builds stay under the accepted version | `src/onboarding/eula.ts:8`, `src/app/AppShell.tsx:432`; owner decision for the legal part |
| EULA-61 | Entire agreement with TERMS.md and REFUND.md | Owner decision: counsel review (G4) |
| EULA-62 | Severability | Owner decision: counsel review (G4) |
| EULA-63 | No waiver | Owner decision: counsel review (G4) |
| EULA-64 | Assignment | Owner decision: counsel review (G4) |
| EULA-65 | Notices to [OWNER] and to the buyer's e-mail or release notes | Owner decision: notice address (G4) |
| EULA-66 | The English version controls | Owner decision: counsel review (G4) |

## PRIVACY.md

| ID | Claim | Implemented by, or owner decision |
| --- | --- | --- |
| PRIV-01 | No BELL PR cloud and no account | `server/config.ts:72`; no network module, see the evidence above |
| PRIV-02 | No telemetry, no license server, never contacts the seller | `server/license.ts:254`, `src/api.ts:196`, `server/index.ts:25` |
| PRIV-03 | Code and questions go only to the chosen AI provider and GitHub, under the person's accounts | `server/agent-cli.ts:149`, `server/process.ts:125`, `server/publish.ts:505` |
| PRIV-04 | Web access is off unless turned on | `server/agent-cli.ts:153`, `server/run-executor.ts:134` |
| PRIV-05 | Everything stays in the data directory and can be deleted from the app | `server/config.ts:97`, `server/cleanup.ts:349` |
| PRIV-06 | Who makes BELL PR [OWNER] | Owner decision: seller entity (G4) |
| PRIV-07 | No telemetry, analytics, crash reports or update checks | `src/api.ts:196`, `server/index.ts:25`; see the evidence above |
| PRIV-08 | Activating, removing a key and starting the trial send nothing | `server/license.ts:462`, `server/license.ts:485`, `server/license.ts:502`, `server/license.ts:609` (local file writes only) |
| PRIV-09 | The interface loads nothing from other sites; fonts and icons are bundled; the CSP blocks other sites | `server/http-guard.ts:83`, `server/http-guard.ts:216`, `src/theme/fonts.css:4`, `e2e/no-external-requests.spec.ts:21` |
| PRIV-10 | BELL PR does not store the tools' passwords and tokens, and only asks the tools whether the person is signed in | `server/process.ts:125`, `server/agent-cli.ts:219`, `server/doctor.ts:299` |
| PRIV-11 | Providers' own terms decide what they keep and train on | Owner decision: statement about third parties (G4, G5) |
| PRIV-12 | The tools may send their own usage data; BELL PR neither adds nor removes it, passes only the variables each CLI needs plus the person's usage-data opt-outs (`DO_NOT_TRACK` to both, Claude Code's documented ones to Claude Code), and starts Codex without its `config.toml`, so an opt-out made only there does not reach the agents | `server/process.ts:50`, `server/process.ts:108`, `server/process.ts:109`, `server/process.ts:125` (only listed variables are passed; none is set or removed), `server/agent-cli.ts:191` (`--ignore-user-config`); see finding 7 |
| PRIV-13 | Which features use the AI CLI, and which providers Claude Code may use | `server/agent-cli.ts:149`, `server/sync-runs.ts:398` (conflict resolution), `server/process.ts:70`, `server/process.ts:76` |
| PRIV-14 | BELL PR's instructions, the direction and the approved plan are sent | `server/run-executor.ts:695`, `server/run-executor.ts:753` |
| PRIV-15 | Repository files, analysis excerpts, diffs, rules and templates are sent | `server/insights.ts:1220`, `server/drafts.ts:384`, `server/learning.ts:229` |
| PRIV-16 | Output of the agents' commands is sent | `server/agent-cli.ts:54` (write roles run commands through the CLI, which returns the output to its model) |
| PRIV-17 | Questions are sent with the diff, explanation and reports | `server/explanations.ts:271`, `server/learning.ts:358` |
| PRIV-18 | Review comments and check results are sent for coaching and follow-up rounds | `server/pr-feedback.ts:42`, `server/explanations.ts:216`, `server/followup-runs.ts:44` |
| PRIV-19 | Discovery sends the interests and the found repositories' details, documents, issues and comments | `server/discovery.ts:694`, `server/discovery-sources.ts:88`, `server/discovery-sources.ts:239` |
| PRIV-20 | Credential-shaped text is masked before logs, answers, questions and team messages are saved, and in draft context | `server/secrets.ts:17`, `server/run-executor.ts:91`, `server/run-executor.ts:204`, `server/run-executor.ts:427`, `server/learning.ts:373`, `server/drafts.ts:384` |
| PRIV-21 | Imported repositories are cloned and fetched; details, issues, guidelines and templates are read | `server/repositories.ts:53`, `server/repositories.ts:270`, `server/draft-sources.ts:41` |
| PRIV-22 | Discovery searches GitHub | `server/discovery-sources.ts:239` |
| PRIV-23 | Review comments and checks of the person's PRs are read for coaching | `server/learning.ts:414`, `server/pr-feedback.ts:42` |
| PRIV-24 | GitHub writes only after approval: fork, branch, draft PR, approved follow-up commits; never a force push | `server/publish.ts:332`, `server/publish.ts:505`, `server/publish.ts:572`, `server/publish.ts:772`, `server/pr-branch.ts:5` |
| PRIV-25 | Commits carry the configured git identity and become public | `server/publish.ts:303` |
| PRIV-26 | A non-no-reply commit e-mail needs confirmation, once per address | `shared/draft-checks.ts:468`, `shared/draft-checks.ts:473`, `server/publish.ts:116`, `server/publish.ts:402` |
| PRIV-27 | Web access is Pro and turned on in the AI provider settings | `server/license.ts:286`, `src/i18n/en/settings.ts:119` |
| PRIV-28 | Which agents may use the web, and which never do | `server/run-executor.ts:134`, `server/learning.ts:242`, `server/draft-jobs.ts:128`, `server/insights.ts:1259`, `server/discovery.ts:689`, `server/followup-runs.ts:189` |
| PRIV-29 | Claude Code may open pages on three GitHub domains only; Codex uses OpenAI's web search | `server/agent-cli.ts:38`, `server/agent-cli.ts:63`, `server/agent-cli.ts:205` |
| PRIV-30 | The run log keeps queries and addresses, not page contents | `server/run-executor.ts:292` |
| PRIV-31 | Agents are told not to put contents or secrets in queries | `server/prompts/team.ts:28` |
| PRIV-32 | One data directory: `~/.bellpr`, `--data-dir` or `BELLPR_DATA_DIR` | `server/config.ts:97`, `server/config.ts:105` |
| PRIV-33 | The data directory is 0700 and BELL PR's files are private to the user | `server/store.ts:346`, `server/store.ts:351`, `server/index.ts:330` |
| PRIV-34 | The data inventory table | `server/store.ts:36`, `server/store.ts:37`, `server/store.ts:393`, `server/store.ts:534`, `server/repositories.ts:253`, `server/workbench.ts:514`, `server/run-executor.ts:497`, `server/insights.ts:695`, `server/insights.ts:747`, `server/discovery.ts:434`, `server/license.ts:348`, `server/app-settings.ts:134`, `server/publish.ts:53`, `server/config.ts:114`, `server/config.ts:116`, `server/config.ts:120`, `server/log.ts:15`, `server/log.ts:305`, `server/log.ts:306`, `server/cli.ts:241` |
| PRIV-35 | Temporary index files are deleted when done or at the next start | `server/sync.ts:40`, `server/cleanup.ts:153`, `server/janitor.ts:13` |
| PRIV-36 | What the browser keeps, and the 30-day cookie | `src/i18n/index.tsx:35`, `src/app/AppShell.tsx:143`, `src/app/AppShell.tsx:527`, `src/app/AppShell.tsx:545`, `src/app/hooks/demoStorage.ts:15`, `src/app/ErrorBoundary.tsx:118`, `server/http-guard.ts:80` |
| PRIV-37 | `BELLPR_LICENSE_KEY` holds the key wherever it is set | `server/index.ts:512` |
| PRIV-38 | Cancelled and failed runs lose their working copy after 14 days or the set period (1-365); others keep it | `server/cleanup.ts:33`, `server/cleanup.ts:52`, `server/cleanup.ts:408`, `shared/app-settings.ts:29` |
| PRIV-39 | Run records stay until deleted | `server/cleanup.ts:245`, `server/cleanup.ts:279` |
| PRIV-40 | Free a working copy, delete a run, remove a repository with its clone and analysis | `server/routes/maintenance.ts:131`, `server/routes/maintenance.ts:134`, `server/routes/maintenance.ts:137`, `server/cleanup.ts:310`, `src/modals/RunsModal.tsx:62`, `src/app/AppShell.tsx:931` |
| PRIV-41 | "Delete all data" keeps settings, license and the server's own files | `server/cleanup.ts:332`, `server/cleanup.ts:349`, `src/settings/DataSection.tsx:391` |
| PRIV-42 | Removing everything: the data directory and the browser's site data | `server/config.ts:97`, `src/i18n/index.tsx:35` |
| PRIV-43 | Data at GitHub or the AI provider is under their control | Owner decision: statement about third parties (G4) |
| PRIV-44 | Keys are checked offline against a built-in public key | `server/license.ts:254`, `server/license-keys.ts:17` |
| PRIV-45 | What a key contains | `server/license.ts:100` |
| PRIV-46 | Name and e-mail only if embedded; pool keys have neither | `server/license.ts:105`, `tools/license/issue.ts:121` |
| PRIV-47 | The key stays local; name and e-mail are shown in Settings, About and the CLI | `server/license.ts:609`, `src/license/LicenseCard.tsx:42`, `src/about/AboutDialog.tsx:108`, `server/license.ts:836` |
| PRIV-48 | Logs record only the license ID and the plan | `server/license.ts:433`, `server/license.ts:477`, `server/license.ts:560` |
| PRIV-49 | Sales go through the Merchant of Record [OWNER]; no card details | Owner decision: Merchant of Record |
| PRIV-50 | What the seller receives from the Merchant of Record and why | Owner decision: counsel review (G4) |
| PRIV-51 | Order record retention [OWNER]; no sale or advertising | Owner decision: retention period |
| PRIV-52 | Support messages are used only to answer | Owner decision: counsel review (G4) |
| PRIV-53 | What the diagnostics report holds and masks | `server/routes/maintenance.ts:52`, `server/routes/maintenance.ts:85`, `server/routes/maintenance.ts:90`, `server/routes/maintenance.ts:125` |
| PRIV-54 | The report reaches the seller only if the person sends it | `src/about/AboutDialog.tsx:123` (copied to the clipboard; nothing is sent) |
| PRIV-55 | Data subject rights and the privacy contact [OWNER] | Owner decision: privacy contact (G4, G6) |
| PRIV-56 | Not directed at children | Owner decision: counsel review (G4) |
| PRIV-57 | Each release ships its policy version | Owner decision: release process; `scripts/generate-third-party-notices.mjs:47` copies the policy into each build |

## TERMS.md

| ID | Claim | Implemented by, or owner decision |
| --- | --- | --- |
| TERMS-01 | The terms work with the EULA, privacy policy and refund policy | Owner decision: counsel review (G4) |
| TERMS-02 | The seller [OWNER] | Owner decision: seller entity (G4) |
| TERMS-03 | Seller disclosures required by law [OWNER] | Owner decision: counsel review (G4) |
| TERMS-04 | The Merchant of Record [OWNER] resells, charges taxes and invoices | Owner decision: Merchant of Record |
| TERMS-05 | The checkout shows price, currency and taxes | Owner decision: Merchant of Record and prices |
| TERMS-06 | A key for the seats bought, under EULA section 4 | `server/license.ts:100` (`seats`); owner decision for the legal part |
| TERMS-07 | The feature table lists Free and Pro in this build | `shared/plans.ts:170`; generated into TERMS.md by `scripts/render-generated-regions.ts` |
| TERMS-08 | Pro includes no AI or GitHub usage | `server/process.ts:125` (agents use the person's own sign-ins); owner decision for the legal part |
| TERMS-09 | REFUND.md covers delivery and consent to immediate delivery | Owner decision: delivery method |
| TERMS-10 | A free 14-day trial, once per data directory | `shared/plans.ts:66`, `server/license.ts:502` |
| TERMS-11 | REFUND.md covers refunds and refunded keys | Owner decision: refund window |
| TERMS-12 | Organizations assign each seat to one Named User | Owner decision: counsel review (G4) |
| TERMS-13 | Free needs no purchase, key or account, and has no time limit | `shared/plans.ts:52`, `server/license.ts:754` |
| TERMS-14 | Using BELL PR means agreeing to the responsible-contribution rules | Owner decision: counsel review (G4) |
| TERMS-15 | Nothing is published before every file is reviewed and the text approved; the PR opens as a draft | `server/publish.ts:269`, `server/publish.ts:352`, `server/publish.ts:572` |
| TERMS-16 | Approve only what you understand; you are the author | Owner decision: counsel review (G4) |
| TERMS-17 | Follow each project's rules, CLA/DCO and AI policy | Owner decision: counsel review (G4) |
| TERMS-18 | BELL PR shows the rules and templates it finds, with sources, and can miss some | `server/draft-sources.ts:41`, `src/draft/DraftGuidancePanel.tsx:214` |
| TERMS-19 | BELL PR never adds a sign-off and refuses suggestions that contain one | `server/drafts.ts:65`, `server/drafts.ts:239`, `server/drafts.ts:294`, `server/prompts/followups.ts:49` |
| TERMS-20 | Add a sign-off only if you can certify it | Owner decision: counsel review (G4) |
| TERMS-21 | The disclosure line: editable, off unless turned on per PR or in Settings, suggested when rules ask | `shared/drafts.ts:86`, `server/drafts.ts:111`, `server/drafts.ts:127`, `server/drafts.ts:321`, `src/draft/DraftGuidancePanel.tsx:123`, `src/draft/DraftGuidancePanel.tsx:129`, `src/i18n/en/settings.ts:127` |
| TERMS-22 | Keep an accurate disclosure where a project asks | Owner decision: counsel review (G4) |
| TERMS-23 | AI-written text in the app is labelled AI-generated | `src/review/ExplanationPanel.tsx:72`, `src/review/ExplanationPanel.tsx:852`, `src/mission/ProjectOverview.tsx:1060`, `src/mission/ProjectOverview.tsx:1131`, `src/learning/LearningNotes.tsx:158` |
| TERMS-24 | No bulk or unsolicited pull requests | Owner decision: counsel review (G4) |
| TERMS-25 | Follow GitHub's and the AI provider's policies | Owner decision: counsel review (G4) |
| TERMS-26 | Breach may end the licenses | Owner decision: counsel review (G4) |
| TERMS-27 | Third-party services run under the person's accounts and terms | `server/process.ts:125`, `server/agent-cli.ts:149` |
| TERMS-28 | The seller does not provide or support those services | Owner decision: counsel review (G4) |
| TERMS-29 | Non-affiliation and trademarks | Owner decision: trademark and provider terms (G1, G5) |
| TERMS-30 | Changes apply to later purchases | Owner decision: counsel review (G4) |
| TERMS-31 | Statutory consumer rights prevail | Owner decision: counsel review (G4) |
| TERMS-32 | The support contact [OWNER], also for source-code requests | Owner decision: support contact (G6); `THIRD_PARTY_NOTICES.md:271` |
| TERMS-33 | The EULA's governing law applies | Owner decision: governing law (G4) |
| TERMS-34 | The feature table comes from the same source as the app's plan comparison; the EULA governs the term and the privacy policy says what web access allows | `shared/plans.ts:170`, `src/license/UpgradeDialog.tsx:98`; PRIV-29 for web access; see findings 2 and 3 about two rows of its copy |

## REFUND.md

| ID | Claim | Implemented by, or owner decision |
| --- | --- | --- |
| REFUND-01 | Delivery method [OWNER] | Owner decision: delivery method; pools are supported by `tools/license/issue.ts:121` |
| REFUND-02 | Manual delivery within N business days [OWNER] | Owner decision: delivery time |
| REFUND-03 | A key is pasted in Settings or passed to `bell-pr license activate` | `src/license/useEntitlements.ts:51`, `server/routes/license.ts:32`, `server/license.ts:952` |
| REFUND-04 | Activation needs no internet and sends nothing | `server/license.ts:462`, `server/license.ts:609` |
| REFUND-05 | Pool keys contain no name or e-mail | `tools/license/issue.ts:121` |
| REFUND-06 | Settings and `bell-pr license status` show the key's dates | `src/license/LicenseCard.tsx:110`, `server/license.ts:842`, `server/license.ts:855` |
| REFUND-07 | EU and EEA consumers consent to immediate supply | Owner decision: consumer law and checkout consent (G4) |
| REFUND-08 | Taiwan's 7-day cancellation right does not apply after consent | Owner decision: consumer law (G4) |
| REFUND-09 | The voluntary window applies regardless; mandatory rights prevail | Owner decision: counsel review (G4) |
| REFUND-10 | Full refund within [OWNER] days, for any reason | Owner decision: refund window |
| REFUND-11 | Partial refunds per seat, back to the original payment method | Owner decision: Merchant of Record |
| REFUND-12 | The 14-day trial lets the person try Pro first | `shared/plans.ts:66`, `server/license.ts:502` |
| REFUND-13 | After the window, refunds only where the law requires | Owner decision: counsel review (G4) |
| REFUND-14 | Refunded or charged-back seats are revoked and their Pro License ends; a key that also holds kept seats is replaced | Owner decision: refund process; revocation covers a whole key (its license ID), `server/license-keys.ts:19`, `server/license.ts:236` |
| REFUND-15 | Remove the key in Settings, with `bell-pr license deactivate`, or from `BELLPR_LICENSE_KEY` | `server/routes/license.ts:42`, `server/license.ts:485`, `server/license.ts:958`, `server/license.ts:650` |
| REFUND-16 | Revocation takes effect in later builds; older builds keep accepting the key offline | `server/license-keys.ts:12`, `server/license-keys.ts:19`, `server/license.ts:236` |
| REFUND-17 | Using a refunded key breaches the EULA | Owner decision: counsel review (G4) |
| REFUND-18 | How to ask for a refund: Merchant of Record [OWNER] and refund contact [OWNER] | Owner decision: Merchant of Record and contact |
| REFUND-19 | Changes apply to later purchases | Owner decision: counsel review (G4) |

## SECURITY.md

| ID | Claim | Implemented by, or owner decision |
| --- | --- | --- |
| SEC-01 | Supported versions | Owner decision: support policy |
| SEC-02 | Security fixes ship as new releases | Owner decision: release process |
| SEC-03 | Releases after the update period run Free but can be installed for fixes | `server/license.ts:245`, `server/license.ts:729` |
| SEC-04 | Report privately to [OWNER] | Owner decision: security contact (G6) |
| SEC-05 | What to include; `bell-pr doctor` lists the CLI versions | `server/doctor.ts:344`; owner decision for the request |
| SEC-06 | Acknowledgement within 5 business days | Owner decision: support policy |
| SEC-07 | Credit in the release notes | Owner decision: support policy |
| SEC-08 | 90-day disclosure window | Owner decision: support policy |
| SEC-09 | No legal action against good-faith research | Owner decision: counsel review (G4) |
| SEC-10 | Listens on 127.0.0.1 by default | `server/config.ts:72` |
| SEC-11 | Another address needs `--host`/`BELLPR_HOST` and, unless it is loopback or all interfaces, `BELLPR_PUBLIC_URL`; non-local origins need HTTPS | `server/config.ts:242`, `server/config.ts:258`, `server/config.ts:203`, `server/http-guard.ts:38` |
| SEC-12 | Only its own hosts and allowed origins, no cross-site requests, JSON for changes, a strict CSP | `server/http-guard.ts:221`, `server/http-guard.ts:232`, `server/http-guard.ts:247`, `server/http-guard.ts:216` |
| SEC-13 | Listening on all interfaces exposes the sign-in page; publish on 127.0.0.1 | `Dockerfile:80`, `server/config.ts:258`, `server/http-guard.ts:237` |
| SEC-14 | A random 32-byte token in memory, never in a file, environment or command line; a restart signs out | `server/index.ts:529`, `server/index.ts:532`, `server/index.ts:556` |
| SEC-15 | The printed link holds the token and works until restart | `server/index.ts:548` |
| SEC-16 | The browser opened at start gets a one-time link, which goes to `open`/`xdg-open`; the token never does | `server/index.ts:556`, `server/routes/auth.ts:128`, `server/cli.ts:173`, `server/cli.ts:179`; `server/cli.test.ts` checks the opener's arguments; finding 1 |
| SEC-17 | HttpOnly, SameSite=Strict cookie for 30 days; all but the health check and sign-in page need it | `server/routes/auth.ts:65`, `server/routes/auth.ts:66`, `server/http-guard.ts:80`, `server/app.ts:163`, `server/http-guard.ts:237` |
| SEC-18 | One-time links: once, 120 seconds, at most 5, digests only | `server/routes/auth.ts:27`, `server/routes/auth.ts:28`, `server/routes/auth.ts:138` |
| SEC-19 | The link file is private and deleted once read | `server/index.ts:358`, `server/index.ts:359`, `server/cli.ts:241` |
| SEC-20 | Any program of the same user can ask for a link | `server/cli.ts:278`; owner decision for the trust statement |
| SEC-21 | A local repository is cloned into the data directory | `server/repositories.ts:38`, `server/repositories.ts:54` |
| SEC-22 | Git runs with overrides and refuses unsafe local configuration | `server/process.ts:310`, `server/process.ts:392`, `server/process.ts:438` |
| SEC-23 | Project instruction files and settings are not loaded as instructions | `server/agent-cli.ts:169`, `server/agent-cli.ts:171`, `server/agent-cli.ts:195`, `server/agent-cli.ts:197` |
| SEC-24 | Reports, diffs and feedback reach agents as untrusted data | `server/prompts/team.ts:45`, `server/prompts/team.ts:60`, `server/explanations.ts:271` |
| SEC-25 | PR text is checked for secrets and local paths, and CI workflow changes need confirmation | `shared/draft-checks.ts:373`, `shared/draft-checks.ts:447`, `shared/draft-checks.ts:457` |
| SEC-26 | Agents that change code run builds and tests | `server/agent-cli.ts:54` |
| SEC-27 | Claude Code write agents' commands are sandboxed: writes in the working copy only, no network | `server/agent-cli.ts:105`, `server/agent-cli.ts:123`, `server/agent-cli.ts:124`, `server/sandbox.ts:153` |
| SEC-28 | Every Claude Code agent is denied credential files and BELL PR's other data | `server/agent-cli.ts:112`, `server/sandbox.ts:321`, `server/sandbox.ts:284` |
| SEC-29 | Read-only Claude Code agents cannot run commands and read only their working directory | `server/agent-cli.ts:54`, `server/agent-cli.ts:115` |
| SEC-30 | Codex agents: writes in the working copy, no network, reads anything the user can | `server/agent-cli.ts:201` |
| SEC-31 | No agent gets the GitHub token or a license key; each gets only its own sign-in settings | `server/process.ts:50`, `server/process.ts:125` |
| SEC-32 | Web access: search, Claude Code pages on three GitHub domains, untrusted data | `server/agent-cli.ts:38`, `server/agent-cli.ts:205`, `server/prompts/team.ts:28` |
| SEC-33 | Without the sandbox, Claude Code write agents are refused unless allowed; such runs are marked | `server/sandbox.ts:153`, `server/sandbox.ts:136`, `server/run-executor.ts:226`, `src/settings/SafetySection.tsx:126` |
| SEC-34 | Unsandboxed agents have the user's full permissions | `server/sandbox.ts:161` |
| SEC-35 | Sandboxes depend on versions and can have flaws; do not run as root | Owner decision: risk statement for counsel (G4); detection at `server/sandbox.ts:86` |
| SEC-36 | In Docker the sandbox needs the documented options | `server/sandbox.ts:59`, `server/sandbox.ts:169`; the probe results are in `docs/docker.md`, "Agent sandbox in Docker" |
| SEC-37 | Out-of-scope reports | Owner decision: support policy |
