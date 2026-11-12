import type { Dispatch, SetStateAction } from "react";
import { getDemo } from "../demo";
import { useLocale } from "../i18n";
import type { Repo } from "../types";
import { LearningNotes } from "../learning/LearningNotes";
import type { Tab } from "../app/AppShell";
import { ErrorBoundary } from "../app/ErrorBoundary";

interface LearningPageProps {
  repos: Repo[];
  chooseRun: (id: string) => Promise<boolean>;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  setTab: Dispatch<SetStateAction<Tab>>;
}

/** The learning notes kept from every contribution's explanations. */
export function LearningPage({
  repos,
  chooseRun,
  setSelectedPath,
  setTab,
}: LearningPageProps) {
  const [locale] = useLocale();
  return (
    <section className="page-content">
      <ErrorBoundary>
        <LearningNotes
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
    </section>
  );
}
