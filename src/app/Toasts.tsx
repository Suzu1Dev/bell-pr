import type { Dispatch, SetStateAction } from "react";
import { AlertCircle, CircleCheck, X } from "lucide-react";
import { useT } from "../i18n";

export type Toast = {
  message: string;
  tone: "success" | "error";
};

/** The current notice; success notices fade out, errors wait to be closed. */
export function Toasts({
  toast,
  setToast,
}: {
  toast: Toast;
  setToast: Dispatch<SetStateAction<Toast | null>>;
}) {
  const t = useT("app");
  return (
    // role="alert" is announced immediately (assertive); role="status"
    // waits for the screen reader to finish what it is saying (polite).
    <div
      className={`toast ${toast.tone === "error" ? "toast-error" : ""}`}
      role={toast.tone === "error" ? "alert" : "status"}
    >
      {toast.tone === "error" ? (
        <AlertCircle size={18} />
      ) : (
        <CircleCheck size={18} />
      )}
      {toast.message}
      <button aria-label={t.dismissNotice} onClick={() => setToast(null)}>
        <X size={14} />
      </button>
    </div>
  );
}
