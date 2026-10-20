import { useEffect, useState } from "react";
import type { TestCommandView } from "../../../shared/by-hand";
import { api } from "../../api";

/**
 * The Tests card's command (DESIGN v1.2 F9), for the guide's panel and the
 * Ready dialog alike: the suggestion and the command confirmed last, read
 * once (GET …/by-hand/test-command); a confirmation made here shows at once.
 */
export function useTestCommand(runId: string, onConfirm?: (command: string) => Promise<void>) {
  const [view, setView] = useState<TestCommandView>();
  useEffect(() => {
    let live = true;
    api<TestCommandView>(`/runs/${encodeURIComponent(runId)}/by-hand/test-command`).then((value) => live && setView(value), () => undefined);
    return () => void (live = false);
  }, [runId]);
  return {
    testCommand: view,
    onConfirmTestCommand: (command: string) =>
      (onConfirm?.(command) ?? Promise.resolve()).then(() =>
        setView((current) => ({ suggestion: current?.suggestion ?? "", confirmed: { command, confirmedAt: new Date().toISOString() } })),
      ),
  };
}
