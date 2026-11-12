import { useEffect, useState } from "react";
import type {
  CollabAuthStatus,
  CollabInviteInfoResponse,
  CollabJoinResponse,
} from "../shared/collab";
import { api, ApiError, deviceInfoStorageKey, deviceTokenStorageKey, send } from "./api";
import { keepParticipantToken } from "./collab/participant";
import { useT } from "./i18n";

export type PairMode = "device" | "login" | "register" | "tailscale";

/** Extracts a `bpi_…` invite token from a bare token or a `/pair#invite=…` URL. */
export function parseInviteInput(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (/^bpi_[A-Za-z0-9_-]{43}$/.test(trimmed)) return trimmed;
  const idx = trimmed.indexOf("#");
  if (idx >= 0) {
    const token = new URLSearchParams(trimmed.slice(idx + 1)).get("invite")?.trim() ?? "";
    if (/^bpi_[A-Za-z0-9_-]{43}$/.test(token)) return token;
  }
  return undefined;
}

/** Consume QR / invite hash data before any asynchronous bootstrap work. */
export function takePairHash(win: Pick<Window, "location" | "history">): {
  code: string;
  invite: string;
} {
  const params = new URLSearchParams(win.location.hash.replace(/^#/, ""));
  const code = params.get("code") ?? "";
  const invite = params.get("invite") ?? "";
  win.history.replaceState(win.history.state, "", win.location.pathname);
  return { code, invite };
}

/** Consume QR hash data before any asynchronous bootstrap work. */
export function takePairCode(win: Pick<Window, "location" | "history">): string {
  return takePairHash(win).code;
}

export function PairPage({
  initialCode = "",
  initialInvite = "",
  initialMode = "device",
  tailscaleLogin: presetTailscaleLogin,
}: {
  initialCode?: string;
  initialInvite?: string;
  initialMode?: PairMode;
  tailscaleLogin?: string;
}) {
  const t = useT("common").pair;
  const [mode, setMode] = useState<PairMode>(initialInvite ? "register" : initialMode);
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [emailLocked, setEmailLocked] = useState(false);
  const [memberName, setMemberName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInvite);
  const [detectedTailscale, setDetectedTailscale] = useState(presetTailscaleLogin ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const linkToken = parseInviteInput(inviteCode);

  useEffect(() => {
    if (mode !== "register" || !linkToken) {
      setEmailLocked(false);
      return;
    }
    let cancelled = false;
    void api<CollabInviteInfoResponse>("/collab/auth/invite-info", {
      ...send("POST", { code: linkToken }),
      browserSessionOnly: true,
      credentials: "omit",
    })
      .then((info) => {
        if (cancelled) return;
        if (!info.valid) {
          setEmailLocked(false);
          setError(t.team.inviteInvalid);
          return;
        }
        setError("");
        if (info.email) {
          setEmail(info.email);
          setEmailLocked(true);
        } else {
          setEmailLocked(false);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode, linkToken, t.team.inviteInvalid]);

  const chooseMode = (next: PairMode) => {
    setMode(next);
    setError("");
    if (next === "tailscale" && !detectedTailscale) {
      void api<CollabAuthStatus>("/collab/auth/status", {
        browserSessionOnly: true,
        credentials: "omit",
      })
        .then((status) => {
          if (status.tailscaleLogin) setDetectedTailscale(status.tailscaleLogin);
        })
        .catch(() => {});
    }
  };

  const finishTeamAuth = (result: CollabJoinResponse) => {
    keepParticipantToken(result.token);
    if (result.deviceToken) {
      localStorage.setItem(
        deviceInfoStorageKey,
        JSON.stringify({ id: result.deviceId ?? result.id, name: result.name }),
      );
      localStorage.setItem(deviceTokenStorageKey, result.deviceToken);
    }
    window.location.replace("/#/group");
  };

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

  const submitTeam = async () => {
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
    setBusy(true);
    setError("");
    try {
      const trimmedDevice = name.trim() ? { deviceName: name.trim() } : {};
      const path =
        mode === "login"
          ? "/collab/auth/login"
          : mode === "register"
            ? "/collab/auth/register"
            : "/collab/auth/tailscale";
      const payload =
        mode === "login"
          ? { username: username.trim(), password, ...trimmedDevice }
          : mode === "register"
            ? {
                code: linkToken ?? inviteCode.trim(),
                ...(email.trim() ? { email: email.trim() } : {}),
                ...(memberName.trim() ? { name: memberName.trim() } : {}),
                ...(username.trim() ? { username: username.trim() } : {}),
                password,
                ...trimmedDevice,
              }
            : {
                ...(inviteCode.trim() ? { code: linkToken ?? inviteCode.trim() } : {}),
                ...trimmedDevice,
              };
      const result = await api<CollabJoinResponse>(path, {
        ...send("POST", payload),
        browserSessionOnly: true,
        credentials: "omit",
      });
      finishTeamAuth(result);
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.status === 429
            ? t.rateLimited
            : failure.message
          : t.failed,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="empty-state pair-page">
      <h1>{t.title}</h1>
      <div className="view-toggle" role="group" aria-label={t.modes.label}>
        {(["device", "login", "register", "tailscale"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={mode === item ? "selected" : ""}
            aria-pressed={mode === item}
            onClick={() => chooseMode(item)}
          >
            {t.modes[item]}
          </button>
        ))}
      </div>
      {mode === "device" ? (
        <>
          <p>{t.explainer}</p>
          <form className="settings-field" onSubmit={(event) => { event.preventDefault(); void pair(); }} aria-busy={busy}>
            <label htmlFor="pair-code">{t.code}</label>
            <input id="pair-code" value={code} onChange={(event) => setCode(event.target.value)} required autoComplete="off" autoCapitalize="characters" />
            <label htmlFor="pair-name">{t.name}</label>
            <input id="pair-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
            <button className="button primary" disabled={busy}>{busy ? t.pairing : t.submit}</button>
            {error && <p role="alert">{error}</p>}
          </form>
        </>
      ) : (
        <>
          <p>
            {mode === "login"
              ? t.team.loginExplainer
              : mode === "register"
                ? t.team.registerExplainer
                : t.team.tailscaleExplainer}
          </p>
          {mode === "tailscale" && detectedTailscale && (
            <p role="status">{t.team.tailscaleDetected({ login: detectedTailscale })}</p>
          )}
          <form className="settings-field" onSubmit={(event) => { event.preventDefault(); void submitTeam(); }} aria-busy={busy}>
            {(mode === "register" || mode === "tailscale") && (
              <>
                <label htmlFor="pair-invite-code">
                  {mode === "register" ? t.team.inviteCode : t.team.inviteCodeOptional}
                </label>
                <input
                  id="pair-invite-code"
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value)}
                  required={mode === "register"}
                  autoComplete="off"
                  autoCapitalize="off"
                />
              </>
            )}
            {mode === "register" && (
              <>
                <label htmlFor="pair-email">{t.team.email}</label>
                <input
                  id="pair-email"
                  type="email"
                  value={email}
                  readOnly={emailLocked}
                  required={Boolean(linkToken) || !username.trim()}
                  maxLength={160}
                  placeholder={t.team.emailHint}
                  autoComplete="email"
                  autoCapitalize="off"
                  onChange={(event) => setEmail(event.target.value)}
                />
                <label htmlFor="pair-member-name">{t.team.displayName}</label>
                <input
                  id="pair-member-name"
                  value={memberName}
                  maxLength={40}
                  autoComplete="name"
                  onChange={(event) => setMemberName(event.target.value)}
                />
              </>
            )}
            {(mode === "login" || mode === "register") && (
              <>
                <label htmlFor="pair-username">
                  {mode === "register" ? t.team.usernameOptional : t.team.username}
                </label>
                <input
                  id="pair-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required={mode === "login"}
                  minLength={mode === "login" ? 2 : undefined}
                  maxLength={mode === "login" ? 160 : 32}
                  placeholder={t.team.usernameHint}
                  autoComplete="username"
                  autoCapitalize="off"
                />
                <label htmlFor="pair-password">{t.team.password}</label>
                <input
                  id="pair-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={8}
                  maxLength={128}
                  placeholder={t.team.passwordHint}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </>
            )}
            <label htmlFor="pair-name">{t.name}</label>
            <input id="pair-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
            <button className="button primary" disabled={busy}>
              {mode === "login"
                ? busy ? t.team.signingIn : t.team.signIn
                : mode === "register"
                  ? busy ? t.team.registering : t.team.registerSubmit
                  : busy ? t.team.signingIn : t.team.tailscaleSubmit}
            </button>
            {error && <p role="alert">{error}</p>}
          </form>
        </>
      )}
    </main>
  );
}
