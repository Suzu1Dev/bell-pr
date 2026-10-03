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

Use focused tests for changed behavior and run `npm run build`. Run `npm test`
when changing Agent orchestration, Git/PR operations, persistence, or API contracts.
Do not run expensive repeated checks after they pass without a new reason.
Do not claim token, monetary, or runtime performance savings without comparable
measurements. Provider-reported cached input is included in input tokens; missing
usage is unknown, not zero.

The BELL runtime adds its own versioned Ponytail policy to each Agent invocation.
Do not copy efficiency rules into contribution worktrees or outgoing PRs, load
rules from imported repositories as application configuration, or remove sandbox,
output schema, cancellation, or approval controls to enable a plugin.
