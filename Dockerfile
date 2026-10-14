# syntax=docker/dockerfile:1
#
# BELL PR container image. docs/docker.md explains how to run it.
#
#   docker build -t bell-pr .
#
# Build arguments:
#   NODE_IMAGE           Node.js 22 base image. Debian trixie, because
#                        syncing runs needs git 2.40 or later (bookworm
#                        ships 2.39).
#   CODEX_VERSION        The OpenAI Codex CLI version installed in the image.
#   INSTALL_CLAUDE_CODE  "true" also installs Claude Code. Only for images
#                        you build for yourself: published images never
#                        include it. Otherwise install it into the running
#                        container as docs/docker.md describes.
ARG NODE_IMAGE=node:22-trixie-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && rm -rf dist/.vite

FROM ${NODE_IMAGE}
ARG CODEX_VERSION=0.159.0
ARG INSTALL_CLAUDE_CODE=false

# git, gh and the agent CLIs do the work; bubblewrap and socat are what
# Claude Code's sandbox needs; tini reaps the agent processes. The Debian
# copyright files in /usr/share/doc stay in the image.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bubblewrap ca-certificates git ripgrep socat tini; \
    node -e "fetch('https://cli.github.com/packages/githubcli-archive-keyring.gpg').then(async (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); require('node:fs').writeFileSync('/usr/share/keyrings/githubcli-archive-keyring.gpg', Buffer.from(await r.arrayBuffer())); })"; \
    chmod 0644 /usr/share/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends gh; \
    rm -rf /var/lib/apt/lists/*; \
    git --version | awk '{ split($3, v, "."); if (v[1] < 2 || (v[1] == 2 && v[2] < 40)) { print "git 2.40 or later is required, found " $3; exit 1 } }'

RUN set -eux; \
    npm install -g --no-audit --no-fund "@openai/codex@${CODEX_VERSION}"; \
    if [ "${INSTALL_CLAUDE_CODE}" = "true" ]; then \
      npm install -g --no-audit --no-fund @anthropic-ai/claude-code; \
    fi; \
    npm cache clean --force; \
    node -e "fetch('https://raw.githubusercontent.com/nodejs/node/v' + process.versions.node + '/LICENSE').then(async (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); require('node:fs').writeFileSync('/usr/local/share/doc/node/LICENSE', await r.text()); })"

# The gh and Codex packages do not carry their license files.
COPY contrib/docker/licenses/gh-LICENSE.txt /usr/share/doc/gh/copyright
COPY contrib/docker/licenses/codex-LICENSE.txt /usr/local/lib/node_modules/@openai/codex/LICENSE
COPY contrib/docker/licenses/codex-NOTICE.txt /usr/local/lib/node_modules/@openai/codex/NOTICE

WORKDIR /opt/bell-pr
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/bin ./bin
COPY --from=build /src/build ./build
COPY --from=build /src/dist ./dist
COPY --from=build /src/vendor/ponytail/rules.md /src/vendor/ponytail/LICENSE /src/vendor/ponytail/provenance.json ./vendor/ponytail/
COPY --from=build /src/LICENSE.md /src/THIRD_PARTY_NOTICES.md ./

# `bell-pr` on PATH for `docker exec <container> bell-pr open --print`. The
# node user gets its own npm prefix for `npm install -g` (Claude Code), and
# /data is its data volume.
RUN set -eux; \
    ln -s /opt/bell-pr/bin/bellpr.mjs /usr/local/bin/bell-pr; \
    ln -s /opt/bell-pr/bin/bellpr.mjs /usr/local/bin/bellpr; \
    mkdir -p /data /home/node/.npm-global; \
    chown node:node /data /home/node/.npm-global; \
    chmod 0700 /data

ENV NODE_ENV=production \
    BELLPR_HOST=0.0.0.0 \
    BELLPR_DATA_DIR=/data \
    BELLPR_NO_OPEN=1 \
    NPM_CONFIG_PREFIX=/home/node/.npm-global \
    PATH=/home/node/.npm-global/bin:$PATH

USER node
WORKDIR /home/node
VOLUME /data
EXPOSE 4311

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.BELLPR_PORT || 4311) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

LABEL org.opencontainers.image.title="BELL PR" \
      org.opencontainers.image.description="Self-hosted, local-first workbench for open-source contributions" \
      org.opencontainers.image.licenses="LicenseRef-BELL-PR-EULA"

ENTRYPOINT ["tini", "--", "node", "/opt/bell-pr/bin/bellpr.mjs"]
CMD ["start"]
