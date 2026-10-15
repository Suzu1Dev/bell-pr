import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useT } from "../i18n";

/**
 * Copies `text` to the clipboard and says whether it worked. Where the
 * clipboard is not available (plain HTTP to another host, a denied
 * permission) it asks the person to select the text instead.
 */
export function CopyButton({
  text,
  label,
  ariaLabel,
  disabled = false,
}: {
  text: string;
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const t = useT("draft").yourWords;
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("No clipboard");
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  };
  return (
    <span className="draft-copy">
      <button
        type="button"
        className="button secondary"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => void copy()}
      >
        {state === "copied" ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
        {label}
      </button>
      <span className="draft-copy-status" role="status" aria-live="polite">
        {state === "copied" ? t.copied : state === "failed" ? t.copyFailed : ""}
      </span>
    </span>
  );
}
