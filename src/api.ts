import {
  isErrorCode,
  type ErrorCode,
  type Fix,
} from "../shared/errors";
import { getCurrentLocale, getCurrentMessages } from "./i18n";

interface ApiErrorInit {
  status: number;
  code?: ErrorCode;
  params?: Record<string, string | number>;
  fixes?: Fix[];
  details?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * A failed API call. `message` is ready to show in the UI language; branch on
 * `code`, never on the text. `status` is the HTTP status, or 0 when no
 * response arrived. `details` holds the other fields of the error body.
 */
export class ApiError extends Error {
  override name = "ApiError";
  readonly status: number;
  readonly code?: ErrorCode;
  readonly params?: Record<string, string | number>;
  readonly fixes?: Fix[];
  readonly details: Record<string, unknown>;

  constructor(message: string, init: ApiErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.code = init.code;
    this.params = init.params;
    this.fixes = init.fixes;
    this.details = init.details ?? {};
  }
}

function isAbort(error: unknown, signal: AbortSignal | null | undefined) {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function unreachable(status: number, cause?: unknown) {
  return new ApiError(getCurrentMessages().common.errors.serverUnreachable, {
    status,
    code: "server_unreachable",
    cause,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readParams(value: unknown) {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    ([, item]) => typeof item === "string" || typeof item === "number",
  );
  return Object.fromEntries(entries) as Record<string, string | number>;
}

function readFixes(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (fix): fix is Fix =>
      isRecord(fix) &&
      typeof fix.label === "string" &&
      typeof fix.command === "string",
  );
}

/** Builds the error for a non-OK response whose body was valid JSON. */
function errorFromBody(status: number, body: unknown) {
  const raw = isRecord(body) ? body : {};
  const {
    error: text,
    code: rawCode,
    params: rawParams,
    fixes: rawFixes,
    ...details
  } = raw;
  const message =
    status === 401
      ? getCurrentMessages().common.errors.apiTokenRequired
      : typeof text === "string" && text.trim()
        ? text
        : getCurrentMessages().common.errors.generic;
  const code = isErrorCode(rawCode) ? rawCode : undefined;
  const init: ApiErrorInit = {
    status,
    code,
    params: readParams(rawParams),
    fixes: readFixes(rawFixes),
    details,
  };
  return new ApiError(message, init);
}

const plainTextType = /^text\/(?!html\b)/i;
const apiTokenStorageKey = "bellpr-api-token";
// Raw paired-device credential; install credentials remain tab-scoped.
export const deviceTokenStorageKey = "bellpr-device-token";
export const deviceInfoStorageKey = "bellpr-device-info";
const apiTokenPattern = /^[0-9a-f]{64}$/i;

function decodePart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function browserSession(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

/** Install credentials take precedence over this browser's paired credential. */
export function currentApiToken(): string | undefined {
  try {
    const install = browserSession()?.getItem(apiTokenStorageKey);
    if (install) return install;
  } catch { /* Try device storage even if tab storage is blocked. */ }
  try {
    return localStorage.getItem(deviceTokenStorageKey) ?? undefined;
  } catch { return undefined; }
}

/** Remove the tab-scoped install credential. */
export function clearApiToken(): void {
  try {
    browserSession()?.removeItem(apiTokenStorageKey);
  } catch {
    // Storage may be unavailable; later requests simply omit the header.
  }
}


/**
 * Reads `#bell_token=` from the fragment into session storage and removes
 * that fragment. A `?bell_token=` query is ignored.
 */
export interface ApiTokenWindow {
  location: { hash: string; search: string; pathname: string };
  history: {
    state: unknown;
    replaceState(state: unknown, title: string, url?: string | URL | null): void;
  };
  sessionStorage: { setItem(key: string, value: string): void };
}

export function adoptApiToken(win: ApiTokenWindow): void {
  const hash = win.location.hash.startsWith("#")
    ? win.location.hash.slice(1)
    : win.location.hash;
  if (!hash.startsWith("bell_token=")) return;
  const token = decodePart(hash.slice("bell_token=".length));
  if (!apiTokenPattern.test(token)) return;
  try {
    win.sessionStorage.setItem(apiTokenStorageKey, token.toLowerCase());
  } catch {
    // Storage can refuse the write. The fragment is still removed below.
  }
  win.history.replaceState(
    win.history.state,
    "",
    `${win.location.pathname}${win.location.search}`,
  );
}

/**
 * Calls the BELL PR API at `/api${path}` with the UI locale in the
 * `X-Bell-Locale` header. Resolves with the parsed JSON body, with the text
 * of a plain-text answer (such as Markdown), or with undefined for an empty
 * answer.
 *
 * Failures throw `ApiError` with a message in the UI language:
 * - an error body from the server keeps its status, code, params and fixes;
 * - no response, or a body that is not the API's JSON (for example a proxy
 *   page while the service is down), gives code `server_unreachable`.
 * Aborting through `options.signal` rejects with the abort error unchanged.
 */
export async function api<T>(
  path: string,
  options?: RequestInit & { browserSessionOnly?: boolean },
): Promise<T> {
  const { browserSessionOnly, ...requestOptions } = options ?? {};
  const headers = new Headers(requestOptions.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (!headers.has("X-Bell-Locale"))
    headers.set("X-Bell-Locale", getCurrentLocale());
  // browserSessionOnly: omit stored credentials (pairing must not send an
  // existing install/device token). Name kept for callers; no cookie session.
  const token = browserSessionOnly ? undefined : currentApiToken();
  if (browserSessionOnly) {
    headers.delete("Authorization");
    headers.delete("X-Bell-Token");
  }
  if (token && !headers.has("Authorization") && !headers.has("X-Bell-Token"))
    headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  let text: string;
  try {
    response = await fetch(`/api${path}`, { ...requestOptions, headers });
    text = await response.text();
  } catch (error) {
    if (isAbort(error, options?.signal)) throw error;
    throw unreachable(0, error);
  }
  if (response.ok) {
    if (!text) return undefined as T;
    if (plainTextType.test(response.headers.get("Content-Type") ?? ""))
      return text as T;
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw unreachable(response.status, error);
  }
  if (!response.ok) {
    const presented = headers.get("Authorization")?.replace(/^Bearer /i, "") ?? headers.get("X-Bell-Token");
    if (response.status === 401 && token && presented === token) {
      if (token.startsWith("bpd_")) {
        try {
          if (localStorage.getItem(deviceTokenStorageKey) === token)
            localStorage.removeItem(deviceTokenStorageKey);
        } catch { /* Storage may be unavailable. */ }
        if (typeof window !== "undefined" && window.location.pathname !== "/pair")
          window.location.replace("/pair");
      } else clearApiToken();
    }
    throw errorFromBody(response.status, body);
  }
  return body as T;
}

export const send = (method: string, body?: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body ?? {}),
});

/**
 * The URL of an API route for a plain link or download, which cannot send
 * headers: `/api${path}` with `query` and the UI locale as `locale=` (unless
 * `query` sets its own).
 */
export function apiUrl(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {}))
    if (value !== undefined && value !== null) params.set(key, String(value));
  if (!params.has("locale")) params.set("locale", getCurrentLocale());
  return `/api${path}${path.includes("?") ? "&" : "?"}${params}`;
}
