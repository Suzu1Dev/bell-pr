import { useEffect, useId, useState } from "react";
import { Bot, Loader2, Wrench } from "lucide-react";
import { setupTurnLimit, usesSudo, type MergedSetupNeed } from "../../shared/setup-needs";
import type { SudoStatus } from "../../shared/sudo";
import { api } from "../api";
import { useT } from "../i18n";
import { Modal } from "../modals/Modal";
import "./team.css";

/**
 * Hands the setup checklist of a Full access run to one collaboration
 * turn. The commands are earlier agents' suggestions, so the dialog lists
 * each one word for word for the person to tick, says whether sudo needs a
 * password here (the agent only ever runs `sudo -n`), and starts nothing
 * until they confirm. `block` is why a turn cannot start now.
 */
export function SetupHandOff({
  needs,
  block,
  onStart,
}: {
  needs: readonly MergedSetupNeed[];
  block?: string;
  onStart: (commands: string[]) => Promise<void>;
}) {
  const t = useT("team").setupNeeds;
  const blockId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="setup-handoff">
      <p className="field-help">{t.handOffNote}</p>
      <button
        type="button"
        className="button secondary"
        disabled={!!block}
        aria-describedby={block ? blockId : undefined}
        onClick={() => setOpen(true)}
      >
        <Bot size={15} aria-hidden="true" />
        {t.handOffAction}
      </button>
      {block && (
        <p id={blockId} className="field-help">
          {block}
        </p>
      )}
      {open && <SetupHandOffDialog needs={needs} onStart={onStart} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** What the dialog says about sudo: unknown until read, and when it cannot be read. */
type SudoLine = SudoStatus | "unknown" | undefined;

function SetupHandOffDialog({
  needs,
  onStart,
  onClose,
}: {
  needs: readonly MergedSetupNeed[];
  onStart: (commands: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT("team").setupNeeds;
  const cancel = useT("common").actions.cancel;
  const [ticked, setTicked] = useState(() => needs.slice(0, setupTurnLimit).map((need) => need.command));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sudo, setSudo] = useState<SudoLine>();
  const sudoNeeded = needs.some((need) => usesSudo(need.command));
  useEffect(() => {
    if (!sudoNeeded) return;
    let current = true;
    // The route exists on Linux only; anything else reads as unknown.
    api<{ sudo: SudoStatus }>("/system/sudo")
      .then((result) => current && setSudo(result.sudo))
      .catch(() => current && setSudo("unknown"));
    return () => {
      current = false;
    };
  }, [sudoNeeded]);
  // What is sent: the ticked commands still listed, in the list's order (a poll may have closed one).
  const chosen = needs.filter((need) => ticked.includes(need.command)).map((need) => need.command.trim());
  const chosenSudo = chosen.some(usesSudo);
  // About the commands that will run: none, once every ticked one goes without sudo.
  const sudoLine =
    sudo === undefined || !chosenSudo
      ? undefined
      : sudo === "unknown"
        ? t.dialog.sudoUnknown
        : !sudo.available
          ? t.dialog.sudoMissing
          : sudo.passwordless
            ? t.dialog.sudoPasswordless({ user: sudo.user })
            : t.dialog.sudoPassword({ user: sudo.user });
  const full = chosen.length >= setupTurnLimit;
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      await onStart(chosen);
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={t.dialog.title} mark={<Wrench size={22} aria-hidden="true" />} onClose={() => !busy && onClose()}>
      <p className="settings-dialog-text">{t.dialog.intro}</p>
      <fieldset className="setup-handoff-choices">
        <legend>{t.dialog.choose}</legend>
        {needs.map((need) => {
          const checked = ticked.includes(need.command);
          return (
            <label key={need.command}>
              <input
                type="checkbox"
                checked={checked}
                disabled={busy || (!checked && full)}
                onChange={(event) =>
                  setTicked((list) =>
                    event.target.checked ? [...list, need.command] : list.filter((command) => command !== need.command),
                  )
                }
              />
              <span>
                <strong>{need.need}</strong> <code>{need.command}</code>
                {usesSudo(need.command) && <small className="setup-sudo-tag">{t.dialog.sudoTag}</small>}
                {need.reason && <small>{need.reason}</small>}
              </span>
            </label>
          );
        })}
      </fieldset>
      {needs.length > setupTurnLimit && <p className="field-help">{t.dialog.limit({ limit: setupTurnLimit })}</p>}
      {sudoLine && <p className="field-help">{sudoLine}</p>}
      <ul className="setup-handoff-facts">
        <li>{t.dialog.runs}</li>
        <li>{t.dialog.review}</li>
        <li>{t.dialog.stop}</li>
      </ul>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
          {cancel}
        </button>
        <button
          type="button"
          className="button primary settings-danger-button"
          disabled={busy || !chosen.length}
          onClick={() => void start()}
        >
          {busy ? (
            <>
              <Loader2 size={15} className="spin" aria-hidden="true" />
              {t.dialog.starting}
            </>
          ) : (
            t.dialog.confirm({ count: chosen.length })
          )}
        </button>
      </div>
    </Modal>
  );
}
