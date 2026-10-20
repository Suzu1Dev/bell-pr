/**
 * Your words (DESIGN v1.2 F11): no AI-drafted PR text in a Learn-by-hand
 * run; the project's PR template verbatim, the person's own explanation
 * (the "Your words in the PR" card above), and the facts list, shown and
 * never inserted: it has no insert or copy button.
 */
import { useState } from "react";
import { byHandClean, byHandSummary, type ByHandTemplate } from "../../../shared/by-hand";
import type { ContributionRules } from "../../../shared/contribution";
import { providerLabels } from "../../../shared/models";
import { useFormat } from "../../i18n";
import type { Run } from "../../types";
import { helpsLine, useRecordMessages } from "./ByHandRecord";

export interface DraftHelpersProps {
  run: Run;
  /** The project's PR templates (GET …/by-hand/template). */
  templates?: ByHandTemplate[];
  /** Puts the chosen template into the description, verbatim. */
  onUseTemplate(content: string): void;
  /** "Always add" is on: "Write your AI note in your own words" beside the facts list. */
  alwaysDiscloseAi?: boolean;
  /** The project's quoted rules, for its disclosure rule. */
  rules?: ContributionRules;
  disabled?: boolean;
}

export function DraftHelpers({ run, templates = [], onUseTemplate, alwaysDiscloseAi, rules, disabled }: DraftHelpersProps) {
  const m = useRecordMessages();
  const fmt = useFormat();
  const [chosen, setChosen] = useState(0);
  if (!run.learnByHand) return null;
  const { provider, reported } = run.modelExecution ?? {};
  const facts = [
    ...(provider ? [m.cli({ cli: `${providerLabels[provider]} ${reported?.cliVersion ?? ""}`.trim(), model: reported?.model })] : []),
    helpsLine(m, fmt, byHandSummary(run)),
    ...(byHandClean(run).clean ? [m.claim] : []),
    m.otherTools,
    ...(rules?.findings ?? []).filter((finding) => finding.kind === "disclose").map((finding) => m.rule(finding)),
  ];
  const template = templates[chosen] ?? templates[0];
  return (
    <section className="byhand-record draft-guidance-disclosure" aria-label={m.helpers}>
      <h3>{m.helpers}</h3>
      {template && (
        <div className="byhand-template">
          {templates.length > 1 && (
            <select aria-label={m.templateChoice} value={chosen} onChange={(event) => setChosen(Number(event.target.value))} disabled={disabled}>
              {templates.map((entry, index) => <option key={entry.path} value={index}>{entry.path}</option>)}
            </select>
          )}
          <button type="button" className="button secondary" disabled={disabled} onClick={() => onUseTemplate(template.content)}>
            {m.template}
          </button>
        </div>
      )}
      <h3>{m.facts}</h3>
      <ul className="draft-checklist-sources">
        {facts.map((fact) => <li key={fact}>{fact}</li>)}
      </ul>
      {alwaysDiscloseAi && <p className="byhand-record-claim" role="note">{m.ownWords}</p>}
    </section>
  );
}
