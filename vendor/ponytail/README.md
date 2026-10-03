# Ponytail in BELL PR

Upstream: https://github.com/DietrichGebert/ponytail

Pinned version: **4.10.2**, commit `a17afe0712fc43b08f812d54391a0e5c35353b61`.
`provenance.json` records the original paths and SHA-256 digests. The vendored
`rules.md`, `LICENSE`, and project skill are unmodified upstream files under MIT.

BELL integrates the instruction component at its two Codex invocation boundaries.
The full mode loads `rules.md`; lite is a shorter BELL adaptation of its principles.
BELL's task requirements, file ownership, output schema, review gates, and requested
learning explanations take precedence. Off omits this additional runtime policy.

This project-scoped integration does not install Ponytail lifecycle hooks, change
user-wide Codex configuration, or add an MCP service. The upstream skill is also
available in `.agents/skills/ponytail/` for agents developing BELL itself. Its default
full behavior can be overridden by the project guidance or an explicit user request.

To update, inspect a specific upstream commit and its MIT license, replace only the
listed original files, and update the revision, provenance digests, and BELL policy
version together. Run the policy/usage tests and the build. Do not fetch new rules
at application startup or execute upstream install scripts.
