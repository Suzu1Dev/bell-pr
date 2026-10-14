/**
 * The model summary of a run, a project analysis or a discovery (English).
 * Reasoning-effort labels live in `common.reasoningEffort`.
 */
import { product } from "../../../shared/product";

const models = {
  /** The summary's heading, for a contribution run or for an analysis. */
  heading: { run: "Run model", analysis: "Analysis model" },
  /** Accessible name of the summary region. */
  regionLabel: {
    run: "Model settings for this run",
    analysis: "Model settings for this analysis",
  },
  sample: "Sample content. No model has run yet.",
  /** Records written before models were recorded. */
  notRecorded: {
    run: "This older run did not record its model.",
    analysis: "This analysis did not record its model.",
  },
  agent: "Agent",
  model: "Model",
  modelsUsed: "Models called during this run",
  reasoningEffort: "Reasoning effort",
  network: "Network",
  webAccessAllowed: "Web access allowed",
  /** No model was passed and the CLI did not report the one it used. */
  defaultModelUnreported: ({ provider }: { provider: string }) =>
    `${provider} default (model not reported)`,
  /** The model passed with --model differs from the one the CLI reported. */
  passedAndReported: ({
    passed,
    reported,
  }: {
    passed: string;
    reported: string;
  }) => `Passed ${passed} → reported ${reported}`,
  /** No --model was passed; the CLI reported the model it chose. */
  defaultAndReported: ({ reported }: { reported: string }) =>
    `No --model passed → reported ${reported}`,
  withCliVersion: ({ model, version }: { model: string; version: string }) =>
    `${model} (CLI ${version})`,
  /** The reasoning effort was left to the provider's default. */
  providerDefault: ({ provider }: { provider: string }) =>
    `${provider} default`,
  sourceReported: ({ provider }: { provider: string }) =>
    `These are the settings ${product.name} passed to ${provider} and the model the ${provider} CLI reported. Reported values come from CLI events, not from your provider's billing.`,
  sourceUnreported: ({ provider }: { provider: string }) =>
    `These are the settings ${product.name} passed to ${provider}. The model the service actually used was not reported.`,
};

export default models;
