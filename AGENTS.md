# BELL PR development

Use Ponytail's efficiency principles for work on this project. Default to lite:
complete the requested behavior with the smallest clear change. The upstream
skill is in `.agents/skills/ponytail/SKILL.md`; pinned provenance and licensing are
in `vendor/ponytail/`. Explicit user requirements take precedence.

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
builds still load in older builds. `Database.version` stays 1, and the fixtures
in `server/store.test.ts` must keep loading without migration.

The BELL runtime adds its own versioned Ponytail policy to each Agent invocation.
Do not copy efficiency rules into contribution worktrees or outgoing PRs, or
remove output schema, cancellation, or approval controls to enable a plugin.

## Product rules

BELL PR is sold as a product. Every change also follows these rules:

1. No user-facing literal outside the i18n dictionaries. Run
   `node scripts/check-i18n.mjs`.
2. Set the Agents' output language only through `server/prompt-language.ts`.
   PR titles and bodies stay English unless the target project's rules say
   otherwise.
3. Gate Pro features only through `shared/plans.ts` plus `requirePro` or
   `assertModelEntitlement`. Never gate reads of existing data (GET of runs,
   diff, insights, discovery results, notes, the learning page, status),
   cancel, or the continuation of an existing run. The single explicit
   exception is `GET /api/runs/:id/export.md`, which generates a new document.
4. No personal infrastructure strings (the owner's user, host or tailnet
   names, private ports or home paths) in tracked files. Run
   `node scripts/check-personal-info.mjs`.
5. New persisted files (`license.json`, `app-settings.json`, `children.json`)
   follow the same optional-field rule as `state.json`. Persisted read schemas
   are lenient (strip mode and relaxed caps, through
   `server/persisted-schema.ts`), while agent-output and request schemas stay
   strict. Agent-output caps may only rise within the lenient read caps. Never
   add a value to a persisted enum or union.
6. `.agents/` and `AGENTS.md` are for developing BELL PR only and are excluded
   from the npm package.
7. Every new dependency needs a stated reason. No new runtime server dependency
   without the owner's sign-off.
8. Product identity, URLs and e-mail addresses come only from
   `shared/product.ts`. An empty value means hide the link or degrade
   gracefully; never invent one.
9. No repo-wide reformatting. Keep diffs minimal so that cherry-picks from the
   upstream repository stay feasible.
