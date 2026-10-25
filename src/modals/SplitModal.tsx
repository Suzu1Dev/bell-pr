import { useEffect, useState, type FormEvent } from "react";
import { Info, Loader2, Lock, Plus, Split, Trash2, TriangleAlert } from "lucide-react";
import { suggestSplit } from "../../shared/reviewability";
import { splitLimits, type SplitRequest, type SplitTask } from "../../shared/split";
import { useT } from "../i18n";
import type { DiffFile, Run } from "../types";
import { Modal } from "./Modal";

interface SplitModalProps {
  run: Run;
  files: DiffFile[];
  busy: boolean;
  formError: string;
  splitRun(request: SplitRequest): Promise<void>;
  closeModal(): void;
}

/** A contribution being made. Its key stays put while the person edits titles and moves files. */
interface Group {
  key: number;
  title: string;
}

interface Plan {
  groups: Group[];
  /** The key of the contribution each file goes to; a file with no entry is left out. */
  placed: Record<string, number>;
  nextKey: number;
}

/** How much of a title a file's "goes to" menu shows. */
const optionTitleChars = 20;

/**
 * The starting plan: the change's independent parts, one contribution each, or
 * two empty contributions when the plan shows fewer than two. Blocked files
 * never move, so they never take part in a suggested part.
 */
function startingPlan(files: DiffFile[], tasks: SplitTask[]) {
  const { parts } = suggestSplit(
    files.filter((file) => !file.blocked),
    tasks,
  );
  const usable = parts.length >= splitLimits.minContributions ? parts : [];
  const placed: Record<string, number> = {};
  usable.slice(0, splitLimits.maxContributions).forEach((part, index) => {
    for (const path of part.paths) placed[path] = index + 1;
  });
  const count = Math.min(
    Math.max(usable.length, splitLimits.minContributions),
    splitLimits.maxContributions,
  );
  const groups = Array.from({ length: count }, (_, index) => ({
    key: index + 1,
    title: usable[index]?.title ?? "",
  }));
  const plan: Plan = { groups, placed, nextKey: count + 1 };
  return {
    plan,
    dropped: usable.length > splitLimits.maxContributions,
    // A part that cites several issues holds several fixes in files that cannot be cut apart.
    mixed: parts.filter((part) => part.issues.length > 1),
  };
}

/** Splits the open contribution into 2 to 8 contributions, each with its own files and title. */
export function SplitModal({ run, files, busy, formError, splitRun, closeModal }: SplitModalProps) {
  const t = useT("modals").split;
  const common = useT("common");
  const [{ plan: initial, dropped, mixed }] = useState(() =>
    startingPlan(files, run.team?.tasks ?? []),
  );
  const [plan, setPlan] = useState(initial);
  // Where the keyboard goes after the control it was on moves or goes away: a moved file's menu,
  // which lands in another card, or a contribution's title after one is added or removed.
  const [focusId, setFocusId] = useState<string>();
  const { groups, placed } = plan;
  const { minContributions, maxContributions, titleChars, maxPaths } = splitLimits;

  useEffect(() => {
    if (focusId === undefined) return;
    document.getElementById(focusId)?.focus();
    setFocusId(undefined);
  }, [focusId, plan]);

  const membersOf = (key: number) => files.filter((file) => placed[file.path] === key);
  const leftOut = files.filter((file) => placed[file.path] === undefined);
  const overLimit = groups.some((group) => membersOf(group.key).length > maxPaths);
  const valid =
    groups.length >= minContributions &&
    groups.length <= maxContributions &&
    groups.every((group) => {
      const title = group.title.trim();
      const count = membersOf(group.key).length;
      return title.length > 0 && title.length <= titleChars && count >= 1 && count <= maxPaths;
    });

  function place(path: string, key: number | undefined) {
    setPlan((current) => {
      const next = { ...current.placed };
      if (key === undefined) delete next[path];
      else next[path] = key;
      return { ...current, placed: next };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    await splitRun({
      contributions: groups.map((group) => ({
        title: group.title.trim(),
        paths: membersOf(group.key).map((file) => file.path),
      })),
    });
  }

  /** A contribution's name in a "goes to" menu: its number and the start of its title. */
  const optionText = (group: Group, index: number) => {
    const title = group.title.trim();
    if (!title) return t.contribution({ number: index + 1 });
    return `${index + 1}. ${title.length > optionTitleChars ? `${title.slice(0, optionTitleChars - 1)}…` : title}`;
  };

  const row = (file: DiffFile) => {
    const index = files.indexOf(file);
    const current = placed[file.path];
    return (
      <li className="split-member" key={file.path}>
        <code className="split-path">{file.path}</code>
        <span className="split-delta">
          +{file.additions} −{file.deletions}
        </span>
        <select
          id={`split-move-${index}`}
          className="split-move"
          aria-label={t.goesTo({ path: file.path })}
          value={current === undefined ? "" : String(current)}
          disabled={busy || !!file.blocked}
          onChange={(event) => {
            place(file.path, event.target.value === "" ? undefined : Number(event.target.value));
            setFocusId(`split-move-${index}`);
          }}
        >
          <option value="">{t.leaveOut}</option>
          {groups.map((group, groupIndex) => (
            <option key={group.key} value={String(group.key)}>
              {optionText(group, groupIndex)}
            </option>
          ))}
        </select>
        {file.blocked ? (
          <p className="split-blocked">
            <Lock size={12} aria-hidden="true" />
            <span>{t.blocked({ reason: file.blocked })}</span>
          </p>
        ) : null}
      </li>
    );
  };

  return (
    <Modal title={t.title} subtitle={t.subtitle} onClose={closeModal} wide>
      <form onSubmit={submit}>
        {mixed.map((part) => (
          <div className="split-warning" role="note" key={part.taskIds.join(",")}>
            <TriangleAlert size={16} aria-hidden="true" />
            <p>{t.mixed({ title: part.title, issues: part.issues })}</p>
          </div>
        ))}
        <div className="split-cards">
          {groups.map((group, index) => {
            const members = membersOf(group.key);
            return (
              <section className="split-card" key={group.key} aria-label={t.contribution({ number: index + 1 })}>
                <header className="split-card-head">
                  <span className="split-badge" aria-hidden="true">
                    {index + 1}
                  </span>
                  <input
                    id={`split-title-${group.key}`}
                    className="text-input"
                    aria-label={t.titleLabel({ number: index + 1 })}
                    placeholder={t.titlePlaceholder}
                    value={group.title}
                    maxLength={titleChars}
                    disabled={busy}
                    onChange={(event) =>
                      setPlan((current) => ({
                        ...current,
                        groups: current.groups.map((item) =>
                          item.key === group.key ? { ...item, title: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || groups.length <= minContributions}
                    aria-label={t.remove({ number: index + 1 })}
                    onClick={() => {
                      // The card goes with this button: the next card's title takes the keyboard, or the previous one's.
                      const neighbour = groups[index + 1] ?? groups[index - 1];
                      setFocusId(neighbour && `split-title-${neighbour.key}`);
                      // The files of a removed contribution go back to leaving out.
                      setPlan((current) => ({
                        ...current,
                        groups: current.groups.filter((item) => item.key !== group.key),
                        placed: Object.fromEntries(
                          Object.entries(current.placed).filter(([, key]) => key !== group.key),
                        ),
                      }));
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </header>
                {members.length ? (
                  <ul className="split-members">{members.map(row)}</ul>
                ) : (
                  <p className="split-empty">{t.empty}</p>
                )}
              </section>
            );
          })}
          <button
            type="button"
            className="split-add"
            disabled={busy || groups.length >= maxContributions}
            onClick={() => {
              // The new card's title is what the person fills in next, and the eighth card disables this button.
              setFocusId(`split-title-${plan.nextKey}`);
              setPlan((current) => ({
                ...current,
                groups: [...current.groups, { key: current.nextKey, title: "" }],
                nextKey: current.nextKey + 1,
              }));
            }}
          >
            <Plus size={14} aria-hidden="true" /> {t.add}
          </button>
          {leftOut.length ? (
            <section className="split-card is-left-out" aria-label={t.leaveOut}>
              <header className="split-card-head">
                <h3>{t.leftOutTitle}</h3>
                <span className="split-hint">{t.leftOutHint}</span>
              </header>
              <ul className="split-members">{leftOut.map(row)}</ul>
            </section>
          ) : null}
        </div>
        <div className="split-info">
          <Info size={16} aria-hidden="true" />
          <ul>
            <li>
              {t.creates} {t.original}
            </li>
            <li>{t.filesOnly}</li>
            <li>{t.testEach}</li>
          </ul>
        </div>
        {dropped ? (
          <p className="field-help">{t.suggestionLimit({ count: maxContributions })}</p>
        ) : null}
        {overLimit ? <p className="field-help">{t.pathLimit({ count: maxPaths })}</p> : null}
        {formError ? (
          <p role="alert" className="inline-error">
            {formError}
          </p>
        ) : null}
        <div className="split-footer">
          <p className="split-summary" role="status">
            {t.summary({ contributions: groups.length, leftOut: leftOut.length })}
          </p>
          <div className="split-footer-buttons">
            <button type="button" className="button secondary" onClick={closeModal}>
              {common.actions.cancel}
            </button>
            <button type="submit" className="button primary" disabled={busy || !valid}>
              {busy ? (
                <Loader2 size={14} className="spin" aria-hidden="true" />
              ) : (
                <Split size={14} aria-hidden="true" />
              )}
              {busy ? t.submitting : t.submit}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
