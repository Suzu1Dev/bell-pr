import { useState } from "react";

/** Longer than this, an error is a CLI's raw output rather than a sentence. */
const readableLength = 280;

/**
 * An error message kept to one line. A long one, usually the raw tail of a
 * CLI's output, shows only its leading label and opens to the full text, so
 * nothing is lost. Phrasing content only, so it fits inside a <p>.
 */
export function FailureText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (text.length <= readableLength) return <>{text}</>;
  const colon = text.indexOf("：");
  const label = colon > 0 && colon <= 40 ? text.slice(0, colon) : "執行失敗";
  return (
    <>
      {label}。
      <button
        type="button"
        className="failure-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "收起原始輸出" : `查看原始輸出（${text.length} 字）`}
      </button>
      {open && <span className="failure-raw">{text}</span>}
    </>
  );
}
