import type { Dispatch, SetStateAction } from "react";
import { AlertCircle, CircleCheck, X } from "lucide-react";
import { useT } from "../i18n";

export type Toast = {
  message: string;
  tone: "success" | "error";
};

/**
 * The current notice; success notices fade out, errors wait to be closed.
 *
 * Screen readers hear it through two live regions that stay in the page
 * whether or not a notice shows: a region added together with its text is
 * often not announced. Errors go to the assertive region (read at once),
 * other notices to the polite one (read after the current sentence).
 */
export function Toasts({
  toast,
  setToast,
}: {
  toast: Toast | null;
  setToast: Dispatch<SetStateAction<Toast | null>>;
}) {
  const t = useT("app");
  const error = toast?.tone === "error";
  return (
    <>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {toast && !error ? toast.message : ""}
      </div>
      <div className="visually-hidden" aria-live="assertive" aria-atomic="true">
        {toast && error ? toast.message : ""}
      </div>
      {toast && (
        <div className={`toast ${error ? "toast-error" : ""}`}>
          {error ? (
            <AlertCircle size={18} aria-hidden="true" />
          ) : (
            <CircleCheck size={18} aria-hidden="true" />
          )}
          {toast.message}
          <button aria-label={t.dismissNotice} onClick={() => setToast(null)}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
