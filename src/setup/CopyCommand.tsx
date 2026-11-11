import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  codeClassName,
  codeLabel,
}: {
  command: string;
  /** What the command does, shown above it. */
  label?: string;
  /** The copy button's name for screen readers; "Copy the command: …" by default. */
  copyLabel?: string;
  /** Extra class on the command itself. Welcome uses it for a one-line scroller. */
  codeClassName?: string;
  /** Accessible name when the command scrolls instead of wrapping. */
  codeLabel?: string;
}) {
  const t = useT("setup").copy;
  const code = useRef<HTMLElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  // A right-edge fade only while the command is wider than the box and not
  // scrolled to the end. Scroll-driven masks need newer browsers than this
  // app's floor (Chrome 111, Firefox 113, Safari 16.2).
  useLayoutEffect(() => {
    const node = code.current;
    const frame = node?.parentElement;
    if (!node || !codeLabel || !frame?.classList.contains("copy-command-scroller")) return;
    let live = true;
    const update = () => {
      if (!live) return;
      frame.toggleAttribute(
        "data-overflow",
        node.scrollWidth - node.clientWidth - node.scrollLeft > 1,
      );
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    observer.observe(frame);
    void document.fonts?.ready.then(update);
    return () => {
      live = false;
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [codeLabel, command]);

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
        {codeLabel ? (
          <span className="copy-command-scroller">
            <code
              ref={code}
              className={codeClassName}
              tabIndex={0}
              role="region"
              aria-label={codeLabel}
            >
              {command}
            </code>
          </span>
        ) : (
          <code ref={code} className={codeClassName}>
            {command}
          </code>
        )}
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
