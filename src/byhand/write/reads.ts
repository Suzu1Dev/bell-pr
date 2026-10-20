import { useEffect, useState } from "react";
import type { TestCommandView } from "../../../shared/by-hand";
import type { ContributionRules } from "../../../shared/contribution";
import { api } from "../../api";
import { rulesFrom } from "../../mission/respect";

/** One GET when `path` changes; an answer that comes after the next change (or the unmount) is dropped. */
function useRead<T>(path: string, read: (body: unknown) => T) {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let live = true;
    api<unknown>(path).then((body) => live && setValue(read(body)), () => undefined);
    return () => void (live = false);
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps -- `read` only parses the answer
  return [value, setValue] as const;
}

/** The project's stored rules (GET /api/repos/:id/contribution-rules), for the case of a run that won't publish there. */
export const useStoredRules = (repoId: string) =>
  useRead(`/repos/${encodeURIComponent(repoId)}/contribution-rules`, (body): ContributionRules | undefined => rulesFrom(body))[0];

/**
 * The Tests card's command (DESIGN v1.2 F9), for the guide's panel and the
 * Ready dialog alike: the suggestion and the command confirmed last, read
 * once (GET …/by-hand/test-command); a confirmation made here shows at once.
 */
export function useTestCommand(runId: string, onConfirm?: (command: string) => Promise<void>) {
  const [view, setView] = useRead(`/runs/${encodeURIComponent(runId)}/by-hand/test-command`, (body) => body as TestCommandView);
  return {
    testCommand: view,
    onConfirmTestCommand: (command: string) =>
      (onConfirm?.(command) ?? Promise.resolve()).then(() =>
        setView((current) => ({ suggestion: current?.suggestion ?? "", confirmed: { command, confirmedAt: new Date().toISOString() } })),
      ),
  };
}
