import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { agentEnvironment } from "./process.js";

/** Sets environment variables for one test and restores them afterwards. */
function withEnv(t: TestContext, values: Record<string, string | undefined>) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const claudeAuth = {
  ANTHROPIC_API_KEY: "sk-ant-test-key",
  ANTHROPIC_AUTH_TOKEN: "auth-token",
  ANTHROPIC_BASE_URL: "https://gateway.example.invalid",
  CLAUDE_CODE_USE_BEDROCK: "1",
  CLAUDE_CODE_USE_VERTEX: "1",
  CLAUDE_CODE_USE_FOUNDRY: "1",
  AWS_ACCESS_KEY_ID: "AKIA-test",
  AWS_SECRET_ACCESS_KEY: "aws-secret",
  AWS_SESSION_TOKEN: "aws-session",
  AWS_REGION: "us-east-1",
  GOOGLE_APPLICATION_CREDENTIALS: "/creds/google.json",
  ANTHROPIC_VERTEX_PROJECT_ID: "vertex-project",
  CLOUD_ML_REGION: "us-east5",
  CLAUDE_CONFIG_DIR: "/config/claude",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth-token",
};
const codexAuth = {
  CODEX_HOME: "/config/codex",
  OPENAI_API_KEY: "sk-openai-test",
  CODEX_API_KEY: "codex-key",
};

test("each agent CLI gets its own sign-in variables and never the other's", (t) => {
  withEnv(t, {
    ...claudeAuth,
    ...codexAuth,
    // Never forwarded to any agent.
    GITHUB_TOKEN: "ghp_never",
    GH_TOKEN: "ghp_never",
    BELLPR_LICENSE_KEY: "BELLPR1.never",
    NPM_TOKEN: "npm-never",
  });
  const claude = agentEnvironment("claude");
  for (const [key, value] of Object.entries(claudeAuth))
    assert.equal(claude[key], value, key);
  assert.equal(claude.ANTHROPIC_API_KEY, "sk-ant-test-key");
  assert.equal(claude.CLAUDE_CODE_USE_BEDROCK, "1");
  for (const key of Object.keys(codexAuth)) assert.equal(claude[key], undefined, key);
  assert.equal(claude.OPENAI_API_KEY, undefined);

  const codex = agentEnvironment("codex");
  for (const [key, value] of Object.entries(codexAuth))
    assert.equal(codex[key], value, key);
  for (const key of Object.keys(codex)) {
    assert.doesNotMatch(key, /^ANTHROPIC_/, key);
    assert.doesNotMatch(key, /^(?:CLAUDE_|AWS_|GOOGLE_|CLOUD_ML_)/, key);
  }

  // Without a provider: both sets, a superset of what earlier builds passed.
  const both = agentEnvironment();
  for (const [key, value] of Object.entries({ ...claudeAuth, ...codexAuth }))
    assert.equal(both[key], value, key);

  for (const env of [claude, codex, both]) {
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.BELLPR_LICENSE_KEY, undefined);
    assert.equal(env.NPM_TOKEN, undefined);
    assert.equal(env.NO_COLOR, "1");
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(env.PATH, process.env.PATH);
  }
});

test("empty variables are left out", (t) => {
  withEnv(t, { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" });
  assert.equal("ANTHROPIC_API_KEY" in agentEnvironment("claude"), false);
  assert.equal("OPENAI_API_KEY" in agentEnvironment("codex"), false);
});
