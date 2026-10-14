# BELL PR End User License Agreement

> **DRAFT, pending counsel review.** This is a working draft. It is not in
> force and it is not legal advice. Do not ship it in a release or sell
> licenses under it until counsel has reviewed it and every owner
> placeholder below is filled in.

EULA version: 1.0-draft-2026-10-14

## Owner placeholders

Fill in each item, then delete this list. Each item appears exactly once in
the text below, as a bracketed placeholder that starts with OWNER. When this
text changes, change the version line above and `eulaVersion` in
`shared/product.ts` together; once counsel has approved the text, the
version becomes `1.0` and the DRAFT banner goes.

- [ ] **Licensor** (preamble): the seller's legal name, legal form and
  postal address.
- [ ] **Free commercial use** (section 3.2): confirm that the Free License
  allows commercial use, or restrict it.
- [ ] **Pro term** (section 4.2): confirm a perpetual license with 12 months
  of updates, or change it to a subscription term. Keys from a pre-signed
  pool count their update period from the day the pool was issued, not from
  the sale, so issue pools close to the sale or with a longer period.
- [ ] **Governing law and venue** (section 18).
- [ ] **Notices** (section 20.5): the address for legal notices.

---

This End User License Agreement (the "Agreement") is a contract between you
and [OWNER: licensor legal name, legal form and address] ("we", "us" or
"our"). It governs your use of BELL PR. Please read it carefully. <!-- claim:EULA-01 -->

## 1. Definitions

- **"Software"** means BELL PR in every form we distribute it, including the
  npm package, container images, documentation and any updates we provide.
- **"Build"** means one released version of the Software, identified by its
  version number and release date.
- **"Free Feature Set"** means the features the Software provides without an
  active Pro license or trial.
- **"Pro Feature Set"** means the additional features that the Software
  unlocks with an active License Key or trial. The Software's plan
  comparison and the feature table in TERMS.md list them. <!-- claim:EULA-02 -->
- **"License Key"** means a key we issue that unlocks the Pro Feature Set
  for a number of seats.
- **"Named User"** means one individual person to whom one seat is assigned.
- **"Update Period"** has the meaning given in section 4.2.
- **"Third-Party Services"** means the services the Software uses through
  tools you install and sign in to yourself, such as GitHub, OpenAI and
  Anthropic.

## 2. Accepting this Agreement

2.1 By installing or using the Software, you agree to this Agreement. If you
do not agree, do not install or use the Software. <!-- claim:EULA-03 -->

2.2 The Software's web interface asks you to accept this version of the
Agreement before you first use it, and again whenever the version changes;
until you accept, the rest of the interface stays locked. The version is the
"EULA version" line at the top of this Agreement. <!-- claim:EULA-04 -->

2.3 If you accept on behalf of an organization, you confirm that you are
authorized to bind it, and "you" includes that organization. <!-- claim:EULA-05 -->

## 3. Free License

3.1 Subject to this Agreement, we grant you a non-exclusive,
non-transferable, non-sublicensable, royalty-free license to install and use
the Software, with the Free Feature Set, on computers you own or control. <!-- claim:EULA-06 -->

3.2 You may use the Free License for personal and commercial purposes
[OWNER: confirm that the Free License allows commercial use]. <!-- claim:EULA-07 -->

## 4. Pro License

4.1 **Grant.** When you buy a Pro license and we deliver a License Key, we
grant you a non-exclusive, non-transferable, non-sublicensable license, for
each seat you paid for, for one Named User to use the Pro Feature Set on
computers that person owns or controls. A Named User may install the
Software on several of their own computers. <!-- claim:EULA-08 -->

4.2 **Term and updates.** The Pro License is perpetual for every Build
released within the Update Period. The Update Period ends on the "updates
until" date that your License Key carries, which the Software shows in the
License section of its settings and with `bell-pr license status`. <!-- claim:EULA-09 -->
Unless your order states otherwise, that date is 12 months after your
purchase
[OWNER: confirm a perpetual license with 12 months of updates, or change it to a subscription term]. <!-- claim:EULA-10 -->
After the Update Period ends, you may keep using the Pro Feature Set in the
Builds released within it. Builds released later run with the Free Feature
Set unless you renew. <!-- claim:EULA-11 -->
If your License Key carries an expiry date instead, the Pro Feature Set ends
7 days after that date (a grace period). <!-- claim:EULA-12 -->

4.3 **Named Users.** Each seat belongs to one Named User at a time. You may
reassign a seat permanently to a different person, for example when someone
leaves your organization, but you may not share a seat between people. <!-- claim:EULA-13 -->

4.4 **Trial.** The Software offers one 14-day trial of the Pro Feature Set
per data directory. It starts only when you start it, and it ends
automatically. <!-- claim:EULA-14 -->
The trial is free of charge, and this section 4 applies to it except for
payment. <!-- claim:EULA-15 -->

4.5 **License Keys.** The Software checks License Keys offline, on your
computer, and never sends them anywhere. <!-- claim:EULA-16 -->
Keep your License Key confidential; you are responsible for its use. <!-- claim:EULA-17 -->
We may revoke a License Key that was refunded, charged back, leaked or
obtained in breach of this Agreement. A revocation takes effect in the
Builds released after it; earlier Builds keep accepting the key offline,
but using a revoked key in any Build breaches this Agreement. <!-- claim:EULA-18 -->

## 5. Restrictions

These restrictions apply to the Free License, the Pro License and the
trial. You must not, and must not allow anyone else to: <!-- claim:EULA-19 -->

(a) redistribute, sell, resell, rent, lease, lend or sublicense the
Software, its package or any License Key, or otherwise make them available
to others, except as this Agreement allows; <!-- claim:EULA-20 -->

(b) remove, disable, modify or get around any license check, License Key
verification, trial limit, acceptance prompt, or copyright, trademark or
license notice in the Software; <!-- claim:EULA-21 -->

(c) host or operate the Software for others, or offer it as a service. One
installation serves one person, who uses it with their own GitHub, OpenAI
and Anthropic accounts; <!-- claim:EULA-22 -->

(d) publish, share or generate License Keys, or use a License Key that we
did not issue to you or that was revoked; <!-- claim:EULA-23 -->

(e) use the Software in breach of any law or of the terms of a Third-Party
Service. <!-- claim:EULA-24 -->

## 6. Third-party components

The Software includes open-source components. Each is licensed under its own
terms, listed in THIRD_PARTY_NOTICES.md, and those terms apply to that
component instead of this Agreement. <!-- claim:EULA-25 -->
Nothing in this Agreement limits the rights those licenses give you. For the
programs under the GNU GPL or LGPL in the container image, THIRD_PARTY_NOTICES.md
also contains a written offer for their source code. <!-- claim:EULA-26 -->

## 7. Third-party services and your accounts

7.1 The Software works through tools you install and sign in to yourself:
git, the GitHub CLI, and the OpenAI Codex CLI or Claude Code. It uses those
tools, and the Third-Party Services behind them, under your own accounts. <!-- claim:EULA-27 -->
It never reads or stores the passwords or tokens those tools keep. <!-- claim:EULA-28 -->

7.2 Each Third-Party Service's own terms and policies govern your use of it.
You are responsible for following them and for any fees, usage limits and
quotas, which count against your own accounts. <!-- claim:EULA-29 -->

7.3 We do not provide, control or support the Third-Party Services. We are
not responsible for their availability, their output, their changes or the
way they handle your data. <!-- claim:EULA-30 -->
BELL PR is not affiliated with, or endorsed by, GitHub, OpenAI or
Anthropic. <!-- claim:EULA-31 -->

## 8. AI output

8.1 The Software uses AI models, through the tools in section 7, to analyse
projects, plan work, write and change code, explain changes and draft pull
request text. <!-- claim:EULA-32 -->
AI output can be wrong, incomplete or insecure, and it can resemble existing
code that is under other licenses. <!-- claim:EULA-33 -->

8.2 You must review every change, explanation and text before you publish it
or rely on it. <!-- claim:EULA-34 -->
The Software publishes nothing until you have marked every changed file as
reviewed and approved the pull request text. <!-- claim:EULA-35 -->
You are responsible for what you publish, including following each
project's contribution rules and licenses. <!-- claim:EULA-36 -->

8.3 The Software labels text that AI models wrote, such as project
analyses, recommendations, explanations and the agents' answers, as
AI-generated. <!-- claim:EULA-37 -->
Whether a pull request says that AI helped is your decision: the Software
offers an editable disclosure line, which is off unless you turn it on or
the project's own rules ask for a disclosure (TERMS.md section 4.4). <!-- claim:EULA-38 -->

## 9. Agent execution risk

9.1 Agents run commands on your computer. To build, test and change the
projects you import, they also run those projects' own code, scripts and
dependencies, which you have not reviewed and which may be harmful. <!-- claim:EULA-39 -->

9.2 The Software gives each run its own working copy and runs agents in the
sandboxes that the agent tools provide: Claude Code agents that change code
run only inside Claude Code's sandbox, and Codex CLI agents run inside the
Codex sandbox. <!-- claim:EULA-40 -->
No sandbox is complete. <!-- claim:EULA-41 -->
If you allow agents to run without a sandbox, they run with all the
permissions of your user account, and the Software marks every run in which
they did. <!-- claim:EULA-42 -->

9.3 Import only projects you are willing to run on that computer, do not run
the Software as an administrator or root, and keep backups. SECURITY.md
describes the safeguards and their limits. You accept the risks described in
this section. <!-- claim:EULA-43 -->

## 10. Your data

The Software runs on your computer and stores its data there. <!-- claim:EULA-44 -->
It sends us no telemetry and never contacts us. <!-- claim:EULA-45 -->
PRIVACY.md describes what the Software stores and what the tools it runs
send to Third-Party Services.

## 11. Updates and support

We may release new Builds, but we are not obliged to provide updates,
support or any particular feature, except for the Pro Feature Set in Builds
released within the Update Period. Features may change from one Build to the
next. <!-- claim:EULA-46 -->

## 12. Ownership

We and our licensors own the Software and all intellectual property in it.
This Agreement licenses the Software to you; it does not sell it. We reserve
every right that this Agreement does not expressly grant. <!-- claim:EULA-47 -->
As between you and us, we claim no ownership of the code and text that the
Software helps you produce. <!-- claim:EULA-48 -->

## 13. Warranty disclaimer

TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SOFTWARE IS PROVIDED "AS IS" AND
"AS AVAILABLE", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE AND
NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SOFTWARE OR ITS AI OUTPUT IS
CORRECT, SECURE OR FREE OF ERRORS, THAT ANY SANDBOX WILL CONTAIN HARMFUL
CODE, OR THAT A PROJECT WILL ACCEPT YOUR CONTRIBUTION. <!-- claim:EULA-49 -->

## 14. Limitation of liability

14.1 TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE ARE NOT LIABLE FOR ANY
INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR ANY
LOSS OF PROFITS, REVENUE, DATA OR GOODWILL, ARISING OUT OF OR RELATED TO THIS
AGREEMENT OR THE SOFTWARE, EVEN IF WE WERE TOLD THEY WERE POSSIBLE. <!-- claim:EULA-50 -->

14.2 TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL LIABILITY ARISING OUT
OF OR RELATED TO THIS AGREEMENT OR THE SOFTWARE IS LIMITED TO THE FEES YOU
PAID US FOR THE SOFTWARE IN THE 12 MONTHS BEFORE THE EVENT THAT GAVE RISE TO
THE CLAIM. <!-- claim:EULA-51 -->

14.3 Nothing in this Agreement limits liability that the law does not allow
to be limited, such as liability for death or personal injury caused by
negligence, for fraud, or for intent or gross negligence where the law
requires it. <!-- claim:EULA-52 -->

## 15. Consumer rights

If you are a consumer, the mandatory consumer laws of the country where you
live may give you rights that this Agreement cannot exclude or limit.
Sections 13 and 14 apply only as far as those laws allow. <!-- claim:EULA-53 -->

## 16. Termination

16.1 This Agreement lasts until it ends under this section. You may end it
at any time by uninstalling the Software and deleting your License Keys. <!-- claim:EULA-54 -->

16.2 Your licenses end automatically if you breach section 5. We may end
your licenses by notice if you materially breach any other part of this
Agreement and do not cure the breach within 30 days after our notice. A Pro
License also ends when we refund it. <!-- claim:EULA-55 -->

16.3 When a license ends, you must stop using what it covered and delete
the License Keys it applied to. Sections 8, 9 and 12 to 20 survive the end
of this Agreement. <!-- claim:EULA-56 -->

## 17. Export compliance

You must comply with the export control and sanctions laws that apply to
you and to the Software. You confirm that you are not located in, or
ordinarily resident in, a country or region under comprehensive embargo,
and that you are not on a government list of restricted parties. You must
not use, export or re-export the Software in breach of those laws. <!-- claim:EULA-57 -->

## 18. Governing law and venue

This Agreement is governed by the law, and disputes about it go to the
courts, named here: [OWNER: governing law and venue]. Section 15 still
applies. <!-- claim:EULA-58 -->

## 19. Changes to this Agreement

We may publish new versions of this Agreement. Each version has its own
"EULA version" line, and a new Build may ship with a new version. <!-- claim:EULA-59 -->
The Software asks you to accept the new version before you use a Build that
ships with it. If you do not accept it, you may keep using earlier Builds
under the version you accepted for them. <!-- claim:EULA-60 -->

## 20. General

20.1 **Entire agreement.** This Agreement, together with the terms of sale
in TERMS.md and the refund policy in REFUND.md for purchases, is the entire
agreement between you and us about the Software. <!-- claim:EULA-61 -->

20.2 **Severability.** If a court finds part of this Agreement
unenforceable, the rest stays in effect. <!-- claim:EULA-62 -->

20.3 **No waiver.** If we do not enforce a part of this Agreement, we do not
waive our right to enforce it later. <!-- claim:EULA-63 -->

20.4 **Assignment.** You may not transfer this Agreement or your licenses
without our written consent, except for reassigning a seat under
section 4.3. We may transfer them as part of a merger, an acquisition or a
sale of the business that the Software belongs to. <!-- claim:EULA-64 -->

20.5 **Notices.** Send legal notices to
[OWNER: address for legal notices]. We may send notices to you at the
e-mail address you gave when you bought a license, or in the release notes
of a Build. <!-- claim:EULA-65 -->

20.6 **Language.** The English version of this Agreement controls.
Translations are provided for convenience only. <!-- claim:EULA-66 -->
