/**
 * A Learn-by-hand run's drafting helpers in the Draft tab's guide area
 * (DESIGN v1.2 F11): DraftHelpers from the one byhand chunk, with the
 * project's PR templates read once per run, put into the description at
 * the cursor.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { ByHandTemplate } from "../../shared/by-hand";
import type { ContributionRules } from "../../shared/contribution";
import { api } from "../api";
import { ErrorBoundary } from "../app/ErrorBoundary";
import type { Run } from "../types";

const DraftHelpers = lazy(() =>
  import("../byhand/lazy").then((module) => ({ default: module.DraftHelpers })),
);

/** Newlines that `text` ends (or starts) with. */
const newlines = (text: string, end: boolean) => (end ? /\n*$/ : /^\n*/).exec(text)![0].length;
/** The newlines that put a blank line between two non-empty texts. */
const gap = (a: string, b: string) => (a && b ? "\n".repeat(Math.max(0, 2 - newlines(a, true) - newlines(b, false))) : "");

/**
 * The description with a PR template put in, verbatim: the whole of an
 * empty description, otherwise at the cursor (the end without one), as a
 * paragraph of its own. Nothing the person wrote is replaced, so nothing
 * needs a confirm.
 */
export function insertTemplate(body: string, template: string, at = body.length) {
  if (!body.trim()) return template;
  const index = Math.min(Math.max(at, 0), body.length);
  const [before, after] = [body.slice(0, index), body.slice(index)];
  return before + gap(before, template) + template + gap(template, after) + after;
}

export function ByHandHelpers({
  run,
  onDraftBody,
  ...props
}: {
  run: Run;
  rules?: ContributionRules;
  alwaysDiscloseAi?: boolean;
  disabled?: boolean;
  /** Updates the description in the editor. */
  onDraftBody?(update: (body: string) => string): void;
}) {
  const [read, setRead] = useState<{ runId: string; templates: ByHandTemplate[] }>();
  useEffect(() => {
    let cancelled = false;
    // Templates that can't be read are not offered; the person writes from scratch.
    api<{ templates: ByHandTemplate[] }>(`/runs/${encodeURIComponent(run.id)}/by-hand/template`).then(
      ({ templates }) => !cancelled && setRead({ runId: run.id, templates }),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [run.id]);
  // The Draft tab's description field (src/workspace/DraftTab.tsx), for the cursor.
  const cursor = () => (document.getElementById("pr-body") as HTMLTextAreaElement | null)?.selectionEnd;
  return (
    <ErrorBoundary resetKey={run.id}>
      <Suspense fallback={<LoaderCircle className="spin" size={16} aria-hidden="true" />}>
        <DraftHelpers
          {...props}
          run={run}
          templates={read?.runId === run.id ? read.templates : undefined}
          onUseTemplate={(template) => onDraftBody?.((body) => insertTemplate(body, template, cursor()))}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
