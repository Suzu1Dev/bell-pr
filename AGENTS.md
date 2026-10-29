# BELL PR development

Use Ponytail's efficiency principles for work on this project. Default to lite:
complete the requested behavior with the smallest clear change. The upstream
skill is in `.agents/skills/ponytail/SKILL.md`; pinned provenance and licensing are
in `vendor/ponytail/`. Explicit user requirements take precedence.

Do not append AI-assistance or Codex attribution to BELL PR commit messages.
Keep the DCO `Signed-off-by` trailer required by `CONTRIBUTING.md`.

Before editing, understand the affected flow and inspect existing callers. Reuse
existing code first, then the standard library, native platform capabilities,
and installed dependencies. Add abstractions or dependencies only when the task
needs them. Prefer readable code over compressed one-liners. Fix the shared root
cause when multiple callers are affected.

Preserve validation, error handling, accessibility, API compatibility, file
ownership, and human review before publishing. BELL is a learning tool: retain
requested explanations, examples, and tradeoffs. Efficiency rules must not remove
features or weaken evidence required by structured Agent responses.

Use focused tests for changed behavior and run `npm run build` and
`npm run lint` (warnings are allowed; errors are not). Run `npm test`
when changing Agent orchestration, Git/PR operations, persistence, or API contracts.
Do not run expensive repeated checks after they pass without a new reason.
Do not claim token, monetary, or runtime performance savings without comparable
measurements. Provider-reported cached input is included in input tokens; missing
usage is unknown, not zero.

Persisted data must stay readable by older builds. Every new field written to
`state.json`, the insights cache, or discovery jobs is optional; the shared
type, the server zod schema, and the frontend type change in the same commit.
Agent-output, request-input and write schemas stay strict; persisted reads go
through `lenientRead` (`server/persisted-schema.ts`), so files written by newer
builds still load in older builds. The `state.json` read schema also passes
unknown fields through (`.passthrough()`), so a field a newer build wrote
survives a load and save. `Database.version` stays 1, and the fixtures
in `server/store.test.ts` must keep loading without migration.

The BELL runtime adds its own versioned Ponytail policy to each Agent invocation.
Do not copy efficiency rules into contribution worktrees or outgoing PRs, or
remove output schema, cancellation, or approval controls to enable a plugin.

## Product rules

BELL PR is open-source software under the Apache License 2.0
(`CONTRIBUTING.md` explains how to contribute). Every change also follows
these rules:

1. No user-facing literal outside the i18n dictionaries (English and
   Traditional Chinese, kept in step). Run `node scripts/check-i18n.mjs`.
2. Set the Agents' output language only through `server/prompt-language.ts`.
   PR titles and bodies stay English unless the target project's rules say
   otherwise.
3. No personal details in tracked files: a real person's home path, host or
   tailnet names, private ports, tokens or private keys. Run
   `node scripts/check-personal-info.mjs`.
4. New persisted files (`app-settings.json`, `children.json`) follow the same
   optional-field rule as `state.json`. Persisted read schemas are lenient
   (strip mode and relaxed caps, through `server/persisted-schema.ts`), while
   agent-output and request schemas stay strict. Agent-output caps may only
   rise within the lenient read caps. Never add a value to a persisted enum or
   union.
5. `.agents/` and `AGENTS.md` are for developing BELL PR only and are excluded
   from the npm package.
6. Every new dependency needs a stated reason. No new runtime server
   dependency without the maintainers' agreement in the pull request.
7. Product identity, URLs and e-mail addresses come only from
   `shared/product.ts`. An empty value means hide the link or degrade
   gracefully; never invent one. In Markdown and HTML, product links are
   generated regions: change their sources, then run
   `npx tsx scripts/render-generated-regions.ts --write`; never edit them by
   hand.
8. No repo-wide reformatting. Keep diffs minimal and focused so that review
   stays feasible.
9. The READMEs and `docs/` describe shipped behavior; update them with the
   change. Describe Claude Code neutrally ("Uses the Claude Code CLI you
   installed and signed in to (Claude plan or Anthropic API key). Usage
   counts against your own account."), and never claim that it bills a
   subscription instead of the API. A new `ErrorCode` needs its section in
   `docs/troubleshooting.md`. Run `node scripts/npm-readme.mjs --check-docs`.
10. Understanding and maintainer-respect checks are never gated, and the
    understanding-check switch never turns off a project's own rules, the
    Reviewed ticks or the final approval.
