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
export interface ModelSettings {
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
  source: "codex";
  error?: string;
}
/** Settings explicitly sent to Codex, not a claim about provider-side routing. */
export interface ModelExecution {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  source: "selected" | "catalog-default" | "cli-default";
}
