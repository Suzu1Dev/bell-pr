import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useT } from "../i18n";
import "./setup.css";

/**
 * A command to run in a terminal, with a button that copies it. Where the
 * clipboard is not available (a page served over plain HTTP to another
 * host, a denied permission), the command is selected instead and the
 * person is told to press Ctrl+C.
 */
export function CopyCommand({
  command,
  label,
  copyLabel,
}: {
  command: string;
  /** What the command does, shown above it. */
  label?: string;
  /** The copy button's name for screen readers; "Copy the command: …" by default. */
  copyLabel?: string;
}) {
  const t = useT("setup").copy;
  const code = useRef<HTMLElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  const selectCommand = () => {
    const node = code.current;
    const selection = window.getSelection?.();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("No clipboard");
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      selectCommand();
      setState("selected");
    }
  };

  return (
    <div className="copy-command">
      {label && <span className="copy-command-label">{label}</span>}
      <div className="copy-command-row">
        <code ref={code}>{command}</code>
        <button
          type="button"
          className="button secondary copy-command-button"
          aria-label={copyLabel ?? t.copyCommand({ command })}
          onClick={() => void copy()}
        >
          {state === "copied" ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <Copy size={15} aria-hidden="true" />
          )}
          <span>{t.copy}</span>
        </button>
      </div>
      <span className="copy-command-status" role="status" aria-live="polite">
        {state === "copied" ? t.copied : state === "selected" ? t.selected : ""}
      </span>
    </div>
  );
}
