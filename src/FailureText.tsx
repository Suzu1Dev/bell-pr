import { useState } from "react";
import { useFormat, useT } from "./i18n";

/** Longer than this, an error is a CLI's raw output rather than a sentence. */
const readableLength = 280;

/**
 * The short label an error opens with, such as "claude failed" in
 * "claude failed: …" (or the zh-TW full-width colon), or undefined.
 */
function leadingLabel(text: string) {
  // i18n-allow: parser
  const colons = [text.indexOf("："), text.indexOf(": ")].filter(
    (index) => index > 0,
  );
  const colon = colons.length ? Math.min(...colons) : -1;
  return colon > 0 && colon <= 40 ? text.slice(0, colon) : undefined;
}

/**
 * An error message kept to one line. A long one, usually the raw tail of a
 * CLI's output, shows only its leading label and opens to the full text, so
 * nothing is lost. Phrasing content only, so it fits inside a <p>.
 */
export function FailureText({ text }: { text: string }) {
  const t = useT("common").failureText;
  const format = useFormat();
  const [open, setOpen] = useState(false);
  if (text.length <= readableLength) return <>{text}</>;
  return (
    <>
      {t.label({ label: leadingLabel(text) ?? t.fallback })}
      <button
        type="button"
        className="failure-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? t.hideRaw : t.showRaw({ count: format.number(text.length) })}
      </button>
      {open && <span className="failure-raw">{text}</span>}
    </>
  );
}
