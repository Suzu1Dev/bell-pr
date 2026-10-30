import { useState } from "react";
import { api, ApiError, deviceInfoStorageKey, deviceTokenStorageKey, send } from "./api";
import { useT } from "./i18n";

/** Consume QR hash data before any asynchronous bootstrap work. */
export function takePairCode(win: Pick<Window, "location" | "history">): string {
  const code = new URLSearchParams(win.location.hash.replace(/^#/, "")).get("code") ?? "";
  win.history.replaceState(win.history.state, "", win.location.pathname);
  return code;
}

export function PairPage({ initialCode = "" }: { initialCode?: string }) {
  const t = useT("common").pair;
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pair = async () => {
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ deviceId: string; token: string; name: string }>("/pair", {
        ...send("POST", { code: code.trim(), ...(name.trim() ? { name: name.trim() } : {}) }),
        browserSessionOnly: true,
        credentials: "omit",
      });
      localStorage.setItem(deviceInfoStorageKey, JSON.stringify({ id: result.deviceId, name: result.name }));
      localStorage.setItem(deviceTokenStorageKey, result.token);
      window.location.replace("/");
    } catch (failure) {
      if (failure instanceof ApiError) {
        const until = failure.details.lockedUntil;
        const seconds = typeof until === "string" || typeof until === "number"
          ? Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000)) : NaN;
        setError(failure.status === 401 ? t.invalid : failure.status === 429 ? t.rateLimited
          : failure.status === 423 ? t.locked + (Number.isFinite(seconds) ? ` ${t.remaining({ seconds })}` : "")
          : failure.message);
      } else setError(t.failed);
    } finally {
      setBusy(false);
    }
  };
  return <main className="empty-state pair-page">
    <h1>{t.title}</h1>
    <p>{t.explainer}</p>
    <form className="settings-field" onSubmit={(event) => { event.preventDefault(); void pair(); }} aria-busy={busy}>
      <label htmlFor="pair-code">{t.code}</label>
      <input id="pair-code" value={code} onChange={(event) => setCode(event.target.value)} required autoComplete="off" autoCapitalize="characters" />
      <label htmlFor="pair-name">{t.name}</label>
      <input id="pair-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
      <button className="button primary" disabled={busy}>{busy ? t.pairing : t.submit}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </main>;
}
