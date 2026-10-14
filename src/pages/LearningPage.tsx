import type { Dispatch, SetStateAction } from "react";
import { MessageSquare } from "lucide-react";
import { getDemo } from "../demo";
import { useLocale, useT } from "../i18n";
import type { Repo, RunSummary } from "../types";
import { LearningNotes } from "../learning/LearningNotes";
import type { Tab } from "../app/AppShell";
import { ErrorBoundary } from "../app/ErrorBoundary";

interface LearningPageProps {
  runs: RunSummary[];
  repos: Repo[];
  chooseRun: (id: string) => Promise<boolean>;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  setTab: Dispatch<SetStateAction<Tab>>;
}

/** The learning notes kept from every contribution's explanations. */
export function LearningPage({
  runs,
  repos,
  chooseRun,
  setSelectedPath,
  setTab,
}: LearningPageProps) {
  const t = useT("pages").learning;
  const [locale] = useLocale();
  return (
    <section className="page-content">
      <ErrorBoundary>
        <LearningNotes
          runs={runs}
          repos={repos}
          demoFiles={getDemo(locale).files}
          onOpen={(id, path) => {
            chooseRun(id).then((opened) => {
              if (!opened) return;
              setSelectedPath(path);
              setTab("changes");
            });
          }}
        />
      </ErrorBoundary>
      <div className="team-note">
        <MessageSquare size={25} />
        <div>
          <strong>{t.noteTitle}</strong>
          <p>{t.noteText}</p>
        </div>
      </div>
    </section>
  );
}
