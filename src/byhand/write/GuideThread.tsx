import { useState } from "react";
import type { ByHandStep, ByHandStepInput, GuideEntry } from "../../../shared/by-hand";
import { CopyRef } from "./CopyRef";
import { useWriteText } from "./text";

/**
 * The guide's answers, newest first (DESIGN v1.2 F6, F7): each move with
 * copyable `path:line` refs, the quotes BELL cut itself under their
 * `path:lines` header ("From the repository" or "From your change"), the
 * note when the filter removed code, and R3's options to choose one with a
 * line on why.
 */
export function GuideThread({ entries, steps, onStep, busy }: { entries: GuideEntry[]; steps: ByHandStep[]; onStep(stepId: string, input: ByHandStepInput): Promise<void>; busy: boolean }) {
  const text = useWriteText();
  const t = text.thread;
  const [picking, setPicking] = useState<{ entryId: string; option: number; why: string }>();
  if (!entries.length) return null;
  return (
    <section aria-label={t.title}>
      <h3>{t.title}</h3>
      <ol className="by-hand-thread">
        {[...entries].reverse().map((entry) => {
          const step = steps.find((item) => item.id === entry.stepId);
          return (
            <li key={entry.id}>
              <strong>{t.kinds[entry.kind] ?? entry.kind}</strong>
              {entry.rung ? <span> {text.guide.rungs[entry.rung] ?? entry.rung}</span> : null}
              {entry.question && <blockquote>{entry.question}</blockquote>}
              <p>{entry.text}</p>
              {entry.ask && <p>{entry.ask}</p>}
              {!!entry.refs?.length && (
                <div className="by-hand-row">
                  {entry.refs.map((ref) => <CopyRef key={`${ref.path}:${ref.line}`} text={`${ref.path}:${ref.line}${ref.endLine ? `-${ref.endLine}` : ""}`} />)}
                </div>
              )}
              {entry.quotes?.map((quote) => (
                <figure key={`${quote.path}:${quote.startLine}`}>
                  <figcaption><code>{`${quote.path}:${quote.startLine}-${quote.endLine}`}</code> {quote.from === "change" ? t.change : t.base}</figcaption>
                  <pre><code>{quote.text}</code></pre>
                </figure>
              ))}
              {(entry.removed ?? 0) > 0 && <p className="by-hand-note">{t.removed}</p>}
              {step && !!entry.options?.length && (
                <ol>
                  {entry.options.map((option, index) => {
                    const chosen = step.chosen?.entryId === entry.id && step.chosen.option === index;
                    const open = picking?.entryId === entry.id && picking.option === index;
                    return (
                      <li key={option.name}>
                        <strong>{option.name}</strong> {option.tradeoff}{" "}
                        {chosen ? <em>{t.chosen}</em> : open ? (
                          <span className="by-hand-row">
                            <input className="text-input" aria-label={t.chooseWhy} placeholder={t.chooseWhy} maxLength={300} value={picking.why}
                              onChange={(event) => setPicking({ ...picking, why: event.target.value })} />
                            <button type="button" className="button secondary" disabled={busy || !picking.why.trim()}
                              onClick={() => void onStep(step.id, { chosen: { ...picking, why: picking.why.trim() } }).then(() => setPicking(undefined), () => undefined)}>{t.choose}</button>
                          </span>
                        ) : <button type="button" className="mission-text-button" onClick={() => setPicking({ entryId: entry.id, option: index, why: "" })}>{t.choose}</button>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
