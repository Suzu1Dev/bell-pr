import type { Dispatch, SetStateAction } from "react";
import { MessageSquare } from "lucide-react";
import { demoFiles } from "../demo";
import type { Repo, RunSummary } from "../types";
import { LearningNotes } from "../learning/LearningNotes";
import type { Tab } from "../app/AppShell";

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
  return (
    <section className="page-content">
      <LearningNotes
        runs={runs}
        repos={repos}
        demoFiles={demoFiles}
        onOpen={(id, path) => {
          chooseRun(id).then((opened) => {
            if (!opened) return;
            setSelectedPath(path);
            setTab("changes");
          });
        }}
      />
      <div className="team-note">
        <MessageSquare size={25} />
        <div>
          <strong>你的下一個問題，就是下一個進步。</strong>
          <p>
            在工作台選取程式碼並提問。對話依檔案保留於目前工作階段，讓每個問題都有上下文。
          </p>
        </div>
      </div>
    </section>
  );
}
