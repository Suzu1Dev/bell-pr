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
export const agentProviders = ["codex", "claude"] as const;
/** Codex is the default; records without a provider were created with Codex. */
export type AgentProvider = (typeof agentProviders)[number];
export const providerLabels: Record<AgentProvider, string> = {
  codex: "Codex",
  claude: "Claude Code",
};
export interface ModelSettings {
  provider?: AgentProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort | "";
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
  source: "selected" | "catalog-default" | "cli-default";
}
