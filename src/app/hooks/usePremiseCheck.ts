import { useRef, useState } from "react";
import type { PremiseCheck } from "../../../shared/team";
import { api, send } from "../../api";
import { useT } from "../../i18n";
import { knownVerdict } from "../../team/PremiseNotice";
import type { DiffFile, Run } from "../../types";
import type { RunActions } from "./useRunActions";

/** Statuses whose work is finished enough to check its premise. */
const finished: Run["status"][] = ["review", "approved", "published", "failed", "cancelled"];

// i18n-allow: parser
const assumptionWords = /假設|未驗證|hypothes|assum|unverified/i;

/**
 * Whether the person can check a run's premise now: a finished real run
 * with a team and its working directory, that has a check already or whose
 * request states an assumption (in either language), and not while the
 * person writes a Learn-by-hand change (nothing is checked before Ready).
 */
export function premiseCheckable(run: Run, demo: boolean, active: boolean, writing = false) {
  return (
    !demo &&
    !writing &&
    !active &&
    !!run.team &&
    !run.publishing &&
    !run.workspaceRemovedAt &&
    finished.includes(run.status) &&
    (!!run.team.premise || assumptionWords.test(run.prompt))
  );
}

/**
 * Checks the open run's premise against its code and reports, again or for
 * the first time (POST /api/runs/:id/premise), and shows the run and the
 * diff that come back: a changed verdict has the explanations and
 * walkthroughs made again.
 */
export function usePremiseCheck(
  run: Run,
  { setRun, setFiles, notify }: Pick<RunActions, "setRun" | "setFiles" | "notify">,
) {
  const t = useT("workspace").notices;
  const verdicts = useT("team").premise.verdicts;
  const [checkingPremise, setChecking] = useState(false);
  const openRun = useRef(run.id);
  openRun.current = run.id;
  async function checkPremise() {
    const id = run.id;
    setChecking(true);
    try {
      const result = await api<{
        run: Run;
        premise: PremiseCheck | null;
        files: DiffFile[];
      }>(`/runs/${encodeURIComponent(id)}/premise`, send("POST", {}));
      if (openRun.current !== id) return;
      setRun(result.run);
      setFiles(result.files);
      notify(
        result.premise
          ? t.premiseChecked({ verdict: verdicts[knownVerdict(result.premise.verdict)] })
          : t.premiseNone,
      );
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setChecking(false);
    }
  }
  return { checkingPremise, checkPremise };
}
