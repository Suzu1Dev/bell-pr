export interface DraftSource {
  id: string;
  kind:
    "contributing" | "template" | "documentation" | "maintainer" | "example";
  label: string;
  url?: string;
  path?: string;
  content: string;
}

export interface DraftContext {
  sources: DraftSource[];
  warnings: string[];
  checkedAt: string;
  baseSha: string;
}

export interface DraftRule {
  text: string;
  sourceId: string;
  quote: string;
}

export interface DraftProposal {
  title: string;
  body: string;
  policy: "repository" | "linux";
  summary: string;
  rules: DraftRule[];
  checklist: string[];
  templateSourceId: string;
}

export interface DraftPreparation {
  status: "generating" | "ready" | "failed" | "stale";
  fingerprint: string;
  context?: DraftContext;
  proposal?: DraftProposal;
  error?: string;
  generatedAt?: string;
}

export const linuxContributionUrl =
  "https://docs.kernel.org/process/submitting-patches.html";
