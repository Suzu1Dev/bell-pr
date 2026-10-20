import { useState } from "react";
import { Columns2 } from "lucide-react";
import type { Run } from "../../types";
import { useWriteText } from "./text";

/**
 * "Compare with the guide's steps" (DESIGN v1.2 F3; cut K4): after a first
 * draft, the person's steps and the guide's side by side, a contrasting
 * case built on the attempt. The reveal is recorded as `compare`.
 */
export function PlanCompare({ run, onReveal, busy }: { run: Run; onReveal(): Promise<void>; busy: boolean }) {
  const text = useWriteText();
  const [shown, setShown] = useState(false);
  const list = (title: string, steps: { title: string }[] = []) => (
    <div>
      <strong>{title}</strong>
      <ol>
        {steps.map((step, index) => (
          <li key={index}>{step.title}</li>
        ))}
      </ol>
    </div>
  );
  return shown ? (
    <section aria-label={text.compare.title}>
      <h4>{text.compare.title}</h4>
      <div className="by-hand-row">
        {list(text.guide.steps, run.byHand?.plan?.steps)}
        {list(text.plan.outline, run.byHand?.guidePlan?.steps)}
      </div>
    </section>
  ) : (
    <button type="button" className="button secondary" disabled={busy} onClick={() => void onReveal().then(() => setShown(true), () => undefined)}>
      <Columns2 size={15} aria-hidden="true" /> {text.compare.action}
    </button>
  );
}
