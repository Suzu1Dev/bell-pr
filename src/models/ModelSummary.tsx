import { Cpu } from "lucide-react";
import {
  providerLabels,
  type ModelExecution,
  type ReasoningEffort,
} from "../../shared/models";
import { useFormat, useT } from "../i18n";
import enCommon from "../i18n/en/common";
import "./models.css";

/**
 * English reasoning-effort labels.
 *
 * @deprecated Read `useT("common").reasoningEffort`, which follows the UI
 * locale. This alias only keeps older importers compiling; remove it once
 * nothing imports it.
 */
export const reasoningLabels: Record<ReasoningEffort, string> =
  enCommon.reasoningEffort;

export function ModelSummary({
  execution,
  demo = false,
  analysis = false,
}: {
  execution?: ModelExecution;
  demo?: boolean;
  analysis?: boolean;
}) {
  const t = useT("models");
  const effortLabels = useT("common").reasoningEffort;
  const fmt = useFormat();
  const kind = analysis ? "analysis" : "run";
  const label = providerLabels[execution?.provider ?? "codex"];
  const reported = execution?.reported;
  // Claude Code reports the resolved model in system/init; Codex reports nothing, so its model stays "not reported".
  let modelText =
    execution?.model || t.defaultModelUnreported({ provider: label });
  if (reported) {
    modelText =
      execution?.model === reported.model
        ? reported.model
        : execution?.model
          ? t.passedAndReported({
              passed: execution.model,
              reported: reported.model,
            })
          : t.defaultAndReported({ reported: reported.model });
    if (reported.cliVersion)
      modelText = t.withCliVersion({
        model: modelText,
        version: reported.cliVersion,
      });
  }
  const modelsUsed = reported?.modelsUsed ?? [];
  const showModelsUsed =
    modelsUsed.length > 1 ||
    (modelsUsed.length === 1 && modelsUsed[0] !== reported?.model);
  return (
    <section className="model-summary" aria-label={t.regionLabel[kind]}>
      <div className="model-summary-heading">
        <Cpu size={16} aria-hidden="true" />
        <strong>{t.heading[kind]}</strong>
      </div>
      {demo ? (
        <p>{t.sample}</p>
      ) : !execution ? (
        <p>{t.notRecorded[kind]}</p>
      ) : (
        <>
          <dl>
            <div>
              <dt>{t.agent}</dt>
              <dd>{label}</dd>
            </div>
            <div>
              <dt>{t.model}</dt>
              <dd>{modelText}</dd>
            </div>
            {showModelsUsed && (
              <div>
                <dt>{t.modelsUsed}</dt>
                <dd>{fmt.list(modelsUsed, { type: "unit" })}</dd>
              </div>
            )}
            <div>
              <dt>{t.reasoningEffort}</dt>
              <dd>
                {execution.reasoningEffort
                  ? `${effortLabels[execution.reasoningEffort]} · ${execution.reasoningEffort}`
                  : t.providerDefault({ provider: label })}
              </dd>
            </div>
            {execution.webAccess && (
              <div>
                <dt>{t.network}</dt>
                <dd>{t.webAccessAllowed}</dd>
              </div>
            )}
          </dl>
          <p>
            {reported
              ? t.sourceReported({ provider: label })
              : t.sourceUnreported({ provider: label })}
          </p>
        </>
      )}
    </section>
  );
}
