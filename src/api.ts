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
    typeof text === "string" && text.trim()
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
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (!headers.has("X-Bell-Locale"))
    headers.set("X-Bell-Locale", getCurrentLocale());
  let response: Response;
  let text: string;
  try {
    response = await fetch(`/api${path}`, { ...options, headers });
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
  if (!response.ok) throw errorFromBody(response.status, body);
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
