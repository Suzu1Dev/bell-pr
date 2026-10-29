import { Cpu } from "lucide-react";
import { providerLabels, type ModelExecution } from "../../shared/models";
import { useFormat, useT } from "../i18n";
import "./models.css";

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
  const permissions = useT("permissions");
  const { reasoningEffortWithId } = useT("common");
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
        {demo && <span className="model-summary-sample">{t.sampleChip}</span>}
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
                  ? reasoningEffortWithId({ effort: execution.reasoningEffort })
                  : t.providerDefault({ provider: label })}
              </dd>
            </div>
            {execution.webAccess && (
              <div>
                <dt>{t.network}</dt>
                <dd>{t.webAccessAllowed}</dd>
              </div>
            )}
            {execution.agentAccess === "full" && (
              <div>
                <dt>{permissions.label}</dt>
                <dd>{permissions.summary}</dd>
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
