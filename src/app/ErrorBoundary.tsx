import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { product } from "../../shared/product";
import { api, sessionEnded } from "../api";
import { useT } from "../i18n";
import { appVersion } from "../version";

/**
 * What "Copy diagnostics" puts on the clipboard: the build, the browser and
 * the error message. The stack is left out because it can hold local paths.
 */
export function diagnosticsText(
  error: Error,
  userAgent: string = navigator.userAgent,
) {
  return [`${product.name} ${appVersion}`, userAgent, error.message].join("\n");
}

const reloadPage = () => window.location.reload();

/** Shown in place of a part of the interface that failed to render. */
export function ErrorFallback({
  error,
  onReload = reloadPage,
}: {
  error: Error;
  onReload?: () => void;
}) {
  const t = useT("app").errorBoundary;
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(diagnosticsText(error));
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }
  return (
    <div className="empty-state" role="alert">
      <div className="empty-icon">
        <AlertCircle />
      </div>
      <h3>{t.title}</h3>
      <p>{t.body}</p>
      <div>
        <button type="button" className="button primary" onClick={onReload}>
          {t.reload}
        </button>{" "}
        <button
          type="button"
          className="button secondary"
          onClick={() => void copyDiagnostics()}
        >
          {t.copyDiagnostics}
        </button>
      </div>
      {copy === "copied" && <p role="status">{t.copied}</p>}
      {copy === "failed" && (
        <>
          <p role="status">{t.copyFailed}</p>
          <pre>{diagnosticsText(error)}</pre>
        </>
      )}
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /** A caught error is cleared when this value changes, such as the open file. */
  resetKey?: unknown;
  onReload?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Keeps a render error in one part of the interface from blanking the page. */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[BELL-PR] Interface error", error, info.componentStack);
  }

  override componentDidUpdate(
    previousProps: ErrorBoundaryProps,
    previousState: ErrorBoundaryState,
  ) {
    // Only an error that was already showing is cleared, so a part that
    // fails again right away is not retried in a loop.
    if (
      previousState.error &&
      this.state.error &&
      !Object.is(previousProps.resetKey, this.props.resetKey)
    )
      this.setState({ error: null });
  }

  override render() {
    if (this.state.error)
      return (
        <ErrorFallback error={this.state.error} onReload={this.props.onReload} />
      );
    return this.props.children;
  }
}

const preloadReloadKey = "bellpr-preload-reload";

/**
 * Whether the server still accepts this tab's session. A 401 answer also
 * makes the API client report the ended session, which the app shows.
 */
async function sessionValid() {
  try {
    await api("/app-settings");
    return true;
  } catch {
    return false;
  }
}

/**
 * Handles Vite's `vite:preloadError`, fired when a lazy chunk fails to load,
 * usually because the server now serves a newer build. The first time in a
 * tab session the page reloads to fetch that build, once the server has
 * answered for this session. After that, or when session storage is
 * unavailable, the error reaches the error boundary instead, so a missing
 * chunk never reloads in a loop.
 *
 * An ended session never reloads: the chunk came back as the sign-in page,
 * and a reload would replace the page, and what the person typed, with it.
 * The error reaches the error boundary and the app says how to sign in
 * again. Returns whether it took the error over to reload.
 */
export function reloadOnPreloadError(
  event: Pick<Event, "preventDefault">,
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> = () =>
    window.sessionStorage,
  reload: () => void = reloadPage,
  checkSession: () => Promise<boolean> = sessionValid,
  ended: () => boolean = sessionEnded,
) {
  if (ended()) return false;
  let session: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  try {
    session = storage();
    if (session.getItem(preloadReloadKey) !== null) return false;
    session.setItem(preloadReloadKey, new Date().toISOString());
  } catch {
    return false;
  }
  event.preventDefault();
  void checkSession().then((valid) => {
    if (valid) {
      reload();
      return;
    }
    // Not reloaded, so a later failure may still reload once.
    try {
      session.removeItem(preloadReloadKey);
    } catch {
      // The next failure then reaches the error boundary.
    }
  });
  return true;
}

let listening = false;

/** Registers reloadOnPreloadError once; call it before the first render. */
export function listenForPreloadErrors() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("vite:preloadError", (event) => {
    reloadOnPreloadError(event);
  });
}
