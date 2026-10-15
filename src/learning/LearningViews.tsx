/**
 * The learning page's views: the notes (the default) and the practice
 * deck. Each has its own address, `#/learning?view=<view>` read from the
 * hash query, so a link, a reload or Back shows the same view; the other
 * flags (presentation, locale) stay on the links. The deck loads on its
 * own the first time it opens.
 */
import { Suspense, lazy } from "react";
import { LoaderCircle } from "lucide-react";
import { useT } from "../i18n";
import {
  serializeRoute,
  useHashRoute,
  type RouteFlags,
} from "../navigation/route";
import type { Repo } from "../types";

export const learningViews = ["notes", "practice"] as const;
export type LearningView = (typeof learningViews)[number];

const PracticeDeck = lazy(() =>
  import("./PracticeDeck").then((module) => ({ default: module.PracticeDeck })),
);

/** The view a `view=` value names; anything else is the notes. */
export function parseLearningView(value: string | undefined): LearningView {
  return learningViews.find((view) => view === value) ?? "notes";
}

/** The address of a view, keeping the other flags; the notes need no `view=`. */
export function learningViewHref(view: LearningView, flags: RouteFlags = {}) {
  const { view: _shown, ...kept } = flags;
  return serializeRoute({
    name: "learning",
    flags: view === "notes" ? kept : { ...kept, view },
  });
}

/** The view the address shows, and its flags for the view links. */
export function useLearningView(): { view: LearningView; flags?: RouteFlags } {
  const route = useHashRoute();
  const flags = route?.name === "learning" ? route.flags : undefined;
  return { view: parseLearningView(flags?.view), flags };
}

/** Links to the views; the one shown is the current page. */
export function LearningViewNav({
  view,
  flags,
}: {
  view: LearningView;
  flags?: RouteFlags;
}) {
  const t = useT("learning").views;
  return (
    <nav className="learning-views" aria-label={t.label}>
      {learningViews.map((id) => (
        <a
          key={id}
          href={learningViewHref(id, flags)}
          aria-current={id === view ? "page" : undefined}
          data-view={id}
        >
          {t[id]}
        </a>
      ))}
    </nav>
  );
}

/** What a view shows while its code loads. */
function ViewLoading() {
  const t = useT("learning");
  return (
    <div className="learning-empty" role="status" aria-busy="true">
      <LoaderCircle className="spin" size={24} aria-hidden="true" />
      <p>{t.views.loading}</p>
    </div>
  );
}

/** The practice deck, loaded when first shown. */
export function LearningViewContent({
  view,
  repos,
  onOpen,
}: {
  view: Exclude<LearningView, "notes">;
  repos: Repo[];
  onOpen: (runId: string, path: string) => void;
}) {
  return (
    <Suspense fallback={<ViewLoading />}>
      {view === "practice" && <PracticeDeck repos={repos} onOpen={onOpen} />}
    </Suspense>
  );
}
