# Licenses of programs added to the Docker image

The Dockerfile installs two programs whose packages do not carry their
license files, so it copies them from here:

| File | Program | Source |
| --- | --- | --- |
| `gh-LICENSE.txt` | GitHub CLI (`gh`), MIT | `LICENSE` of github.com/cli/cli at tag v2.102.0 |
| `codex-LICENSE.txt` | OpenAI Codex CLI, Apache-2.0 | `LICENSE` of github.com/openai/codex at tag rust-v0.159.0 |
| `codex-NOTICE.txt` | OpenAI Codex CLI, Apache-2.0 NOTICE | `NOTICE` of github.com/openai/codex at tag rust-v0.159.0 |

In the image they are `/usr/share/doc/gh/copyright` and
`/usr/local/lib/node_modules/@openai/codex/{LICENSE,NOTICE}`.
`scripts/generate-third-party-notices.mjs` also prints them in section E of
THIRD_PARTY_NOTICES.md.

When you change `CODEX_VERSION` in the Dockerfile, check that upstream's
`LICENSE` and `NOTICE` at the new tag still match these files.
