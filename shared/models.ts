export const reasoningEfforts = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];
/**
 * "antigravity" was added after 1.0.1 as a deliberate exception to the rule
 * that persisted enums never grow: a 1.0.x build cannot read the model
 * settings, insights cache or discovery file that name it (docs/upgrading.md).
 */
export const agentProviders = ["codex", "claude", "antigravity"] as const;
/** Codex is the default; records without a provider were created with Codex. */
export type AgentProvider = (typeof agentProviders)[number];
export const providerLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  claude: "Claude Code",
  antigravity: "Antigravity",
};
/** The command each provider's CLI is started with. */
export const providerExecutables: Record<AgentProvider, string> = {
  codex: "codex",
  claude: "claude",
  antigravity: "agy",
};
export const agentAccessModes = ["workspace", "full"] as const;
/** Full access applies only to roles that write; workspace is the default. */
export type AgentAccessMode = (typeof agentAccessModes)[number];
export interface ModelSettings {
  provider?: AgentProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort | "";
  /** Lets run roles search the web and fetch pages; off when absent. Analysis and discovery never get it. */
  webAccess?: boolean;
  /** Explicit permission to run write roles without the sandbox; read roles stay restricted. */
  agentAccess?: AgentAccessMode;
}
export interface ModelOption {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  reasoningEfforts: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
}
export interface ModelCatalog {
  models: ModelOption[];
  source: AgentProvider;
  error?: string;
}
/** Settings explicitly sent to the CLI, not a claim about provider-side routing. */
export interface ModelExecution {
  provider?: AgentProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  /** Recorded only when the run was created with web access on. */
  webAccess?: boolean;
  /** Explicit permission to run write roles without the sandbox; read roles stay restricted. */
  agentAccess?: AgentAccessMode;
  source: "selected" | "catalog-default" | "cli-default";
  /** What the CLI itself reported (Claude Code and Antigravity); absent for Codex and older records. */
  reported?: {
    /** Resolved model ID from system/init, e.g. claude-haiku-4-5-20251001 for the alias haiku. */
    model: string;
    /** Every model ID present in result.modelUsage, union over the calls of one run. */
    modelsUsed?: string[];
    cliVersion?: string;
  };
}
