/**
 * Bidirectional BELL Suite handoffs for BELL PR (contract v1 rev. f):
 * - Outgoing handoff links to Explain, Personal, Web Reader, and Campaign
 * - Incoming zero-write task draft capture on `#/discover?draft=…&title=…&from=…&back=…`
 *   (or `#/home?draft=…`), stored in sessionStorage and stripped from the URL immediately.
 */
import {
  SUITE_ROUTES,
  suiteLimits,
  type SuiteAppId,
  type SuiteLinks,
  type SuiteSiblingId,
} from "../../shared/suite";
import type { DiffLine } from "../review/diff";
import type { PanelTab } from "../review/ExplanationPanel";
import type { ChatMessage, DiffFile, Run } from "../types";

const OBJECT_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const HREF = /^#\/[A-Za-z0-9/_\-.~%:]*(?:\?[A-Za-z0-9_\-.~%=&+]*)?$/;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const UNSAFE_HANDOFF = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

export const HANDOFF_PARAMS = ["text", "title", "draft", "from", "back"] as const;
export const PR_HANDOFF_KEY = "bell.suite.handoff.pr";

const SIBLINGS: readonly SuiteSiblingId[] = ["explain", "personal", "reader", "campaign"];

const codePoints = (value: string) => [...value];
const clip = (value: string, max: number) => codePoints(value).slice(0, max).join("");

export function validSuiteHref(value: unknown, max: number = suiteLimits.back): value is string {
  if (typeof value !== "string" || value.length > max || !HREF.test(value)) return false;
  if (value.includes("//")) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return false;
  }
  return !UNSAFE_TEXT.test(decoded) && !decoded.includes("\\") && !decoded.slice(2).startsWith("/");
}

export function allowedSuiteRoute(app: SuiteAppId, value: unknown, max: number = suiteLimits.back): value is string {
  if (!validSuiteHref(value, max)) return false;
  return SUITE_ROUTES[app].some((route) => {
    const at = route.indexOf("{id}");
    if (at < 0) return value === route;
    const id = value.slice(at);
    return value.startsWith(route.slice(0, at)) && OBJECT_ID.test(id) && id !== "." && id !== "..";
  });
}

/** Normalizes BELL PR's current hash into a valid `back` route for sibling apps. */
export function prBackRoute(hash: string | undefined): string | undefined {
  if (!hash) return undefined;
  const [rawPath = ""] = hash.replace(/^#/, "").split("?", 2);
  const full = `#${rawPath}`;
  if (allowedSuiteRoute("pr", full)) return full;
  // `#/runs/run-1/changes` -> `#/runs/run-1`
  const runMatch = /^#\/runs\/([^/?#]+)(?:\/[a-z]+)?$/.exec(full);
  if (runMatch) {
    const candidate = `#/runs/${runMatch[1]}`;
    if (allowedSuiteRoute("pr", candidate)) return candidate;
  }
  return "#/home";
}

const OUTGOING_SPECS: Record<
  SuiteSiblingId,
  { route: string; textKey: "text" | "draft"; allowTitle: boolean }
> = {
  explain: { route: "/explain", textKey: "text", allowTitle: true },
  personal: { route: "/tasks", textKey: "draft", allowTitle: false },
  reader: { route: "/read", textKey: "text", allowTitle: true },
  campaign: { route: "/tasks", textKey: "draft", allowTitle: true },
};

/** Builds a contract-compliant outgoing handoff URL to a linked BELL sibling. */
export function buildPrOutgoingHandoff({
  target,
  origin,
  text,
  title,
  back,
}: {
  target: SuiteSiblingId;
  origin: string;
  text: string;
  title?: string;
  back?: string;
}): string {
  const spec = OUTGOING_SPECS[target];
  const params = new URLSearchParams();
  const body = !spec.allowTitle && title ? `${title.trim()} — ${text.trim()}` : text.trim();
  params.set(spec.textKey, clip(body, suiteLimits.handoffText));
  if (spec.allowTitle && title?.trim()) {
    params.set("title", clip(title.trim(), suiteLimits.handoffTitle));
  }
  params.set("from", "pr");
  const validBack = prBackRoute(back);
  if (validBack && allowedSuiteRoute("pr", validBack)) {
    params.set("back", validBack);
  }
  return `${origin.replace(/\/$/, "")}/#${spec.route}?${params.toString()}`;
}

export interface PrHandoffDraft {
  from: SuiteSiblingId;
  text: string;
  title?: string;
  truncated: boolean;
  backUrl?: string;
}

export type PrHandoffRejection = "duplicate" | "missing" | "from" | "empty";
export type PrHandoffParse = undefined | { rejected: PrHandoffRejection } | PrHandoffDraft;

function splitHash(hash: string): [string, string] {
  const [path = "", query = ""] = String(hash).replace(/^#/, "").split("?", 2);
  return [path, query];
}

const ENTRY_PATHS = new Set(["/discover", "/home", "/"]);

export function hasPrHandoffParams(hash: string): boolean {
  const [path, query] = splitHash(hash);
  if (!ENTRY_PATHS.has(path) || !query) return false;
  const params = new URLSearchParams(query);
  return HANDOFF_PARAMS.some((key) => params.has(key));
}

export function cleanHandoffText(
  value: string,
  max: number = suiteLimits.handoffText,
): { text: string; truncated: boolean } {
  const cleaned = value.replace(/\r\n?/g, "\n").replace(UNSAFE_HANDOFF, "").trim();
  const chars = codePoints(cleaned);
  return { text: chars.slice(0, max).join(""), truncated: chars.length > max };
}

/** Parses a handoff sent to BELL PR on `#/discover?...` or `#/home?...`. */
export function parsePrHandoff(hash: string, links: SuiteLinks): PrHandoffParse {
  if (!hasPrHandoffParams(hash)) return undefined;
  const [, query] = splitHash(hash);
  const params = new URLSearchParams(query);
  if (HANDOFF_PARAMS.some((key) => params.getAll(key).length > 1)) {
    return { rejected: "duplicate" };
  }
  const rawBody = params.has("draft") ? params.get("draft") : params.has("text") ? params.get("text") : null;
  if (rawBody === null) return { rejected: "missing" };
  const from = params.get("from") as SuiteSiblingId | null;
  if (!from || !SIBLINGS.includes(from)) return { rejected: "from" };
  const origin = links[from];
  if (!origin) return { rejected: "from" };
  const body = cleanHandoffText(rawBody, suiteLimits.handoffText);
  if (!body.text) return { rejected: "empty" };
  const rawTitle = params.get("title");
  const cleanedTitle = rawTitle
    ? rawTitle.replace(UNSAFE_HANDOFF, "").replace(/\s+/g, " ").trim()
    : "";
  const title = cleanedTitle ? clip(cleanedTitle, suiteLimits.handoffTitle) : undefined;
  const back = params.get("back");
  const draft: PrHandoffDraft = {
    from,
    text: body.text,
    ...(title ? { title } : {}),
    truncated: body.truncated,
  };
  if (back && allowedSuiteRoute(from, back)) {
    draft.backUrl = `${origin.replace(/\/$/, "")}/${back}`;
  }
  return draft;
}

/** Strips reserved handoff keys from a hash while preserving non-handoff flags like `suite=1`. */
export function stripPrHandoffHash(hash: string): string {
  const [path, query] = splitHash(hash);
  if (!query) return `#${path || "/discover"}`;
  const params = new URLSearchParams(query);
  for (const key of HANDOFF_PARAMS) params.delete(key);
  const rest = params.toString();
  const cleanPath = path === "/" || !path ? "/discover" : path;
  return rest ? `#${cleanPath}?${rest}` : `#${cleanPath}`;
}

export interface StoredPrHandoff extends PrHandoffDraft {
  v: 1;
  receivedAt: string;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function writePrHandoff(storage: StorageLike | undefined, draft: PrHandoffDraft): StoredPrHandoff {
  const stored: StoredPrHandoff = {
    v: 1,
    ...draft,
    receivedAt: new Date().toISOString(),
  };
  try {
    storage?.setItem(PR_HANDOFF_KEY, JSON.stringify(stored));
  } catch {
    // Private browsing or quota limit: caller keeps in-memory state.
  }
  return stored;
}

export function readPrHandoff(storage: StorageLike | undefined): StoredPrHandoff | undefined {
  try {
    const raw = storage?.getItem(PR_HANDOFF_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredPrHandoff>;
    if (
      parsed?.v !== 1 ||
      typeof parsed.text !== "string" ||
      !parsed.from ||
      !SIBLINGS.includes(parsed.from)
    ) {
      return undefined;
    }
    const body = cleanHandoffText(parsed.text, suiteLimits.handoffText);
    if (!body.text) return undefined;
    return {
      v: 1,
      from: parsed.from,
      text: body.text,
      ...(typeof parsed.title === "string" && parsed.title.trim() ? { title: clip(parsed.title.trim(), suiteLimits.handoffTitle) } : {}),
      truncated: Boolean(parsed.truncated || body.truncated),
      ...(typeof parsed.backUrl === "string" && /^https?:\/\//.test(parsed.backUrl) ? { backUrl: parsed.backUrl } : {}),
      receivedAt: typeof parsed.receivedAt === "string" ? parsed.receivedAt : new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

export function clearPrHandoff(storage: StorageLike | undefined) {
  try {
    storage?.removeItem(PR_HANDOFF_KEY);
  } catch {
    // Ignore storage errors.
  }
}

/** Formats a diff file (or selected diff lines) into contextual Suite handoff text. */
export function diffHandoffText(
  file: DiffFile,
  selectedLines?: readonly DiffLine[],
): { title: string; text: string } {
  if (file.blocked) return { title: "", text: "" };
  if (selectedLines?.length) {
    const lineNumbers = selectedLines
      .map((line) => line.newLine ?? line.oldLine)
      .filter((num): num is number => num !== null);
    const range = lineNumbers.length
      ? (() => {
          const start = Math.min(...lineNumbers);
          const end = Math.max(...lineNumbers);
          return start === end ? `L${start}` : `L${start}-L${end}`;
        })()
      : "";
    const title = range ? `${file.path}:${range}` : file.path;
    const excerpt = selectedLines
      .map((line) => {
        const prefix = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
        return `${prefix}${line.text}`;
      })
      .join("\n");
    return { title, text: `${file.path}\n\n${excerpt}` };
  }
  const header = `${file.path} (+${file.additions} −${file.deletions})`;
  const patch = file.patch.trim();
  return {
    title: file.path,
    text: patch ? `${header}\n\n${patch}` : header,
  };
}

/** Builds contextual Suite handoff content for the active ExplanationPanel tab, falling back to diff context. */
export function panelHandoffContext(
  file: DiffFile,
  tab: PanelTab,
  extras?: { reports?: Run["reports"]; messages?: readonly ChatMessage[] },
): { title: string; text: string } {
  if (file.blocked) return { title: "", text: "" };
  if (tab === "explain" && file.explanation) {
    const [conceptHeading = ""] = (file.explanation.concept || "").split("\n");
    const trimmedHeading = conceptHeading.trim();
    const title =
      trimmedHeading.length > 0 && trimmedHeading.length <= 100
        ? trimmedHeading
        : file.path;
    const parts = [
      file.path,
      file.explanation.summary,
      file.explanation.reason,
      file.explanation.concept,
    ]
      .map((part) => part?.trim())
      .filter(Boolean);
    if (parts.length > 1) return { title, text: parts.join("\n\n") };
  }
  if (tab === "walkthrough" && file.walkthrough?.functions?.length) {
    const sections = file.walkthrough.functions.map((fn) =>
      [
        `${fn.name} (${fn.startLine}–${fn.endLine})`,
        fn.summary,
        fn.change,
        fn.analogy,
      ]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join("\n"),
    );
    return { title: file.path, text: [file.path, ...sections].join("\n\n") };
  }
  if (tab === "reports" && extras?.reports) {
    const sections = (["implementer", "reviewer", "tester"] as const)
      .map((key) => extras.reports?.[key]?.trim())
      .filter((value): value is string => Boolean(value));
    if (sections.length) {
      return { title: file.path, text: [file.path, ...sections].join("\n\n") };
    }
  }
  if (tab === "chat" && extras?.messages?.length) {
    const lastAssistant = [...extras.messages]
      .reverse()
      .find((msg) => msg.role === "assistant" && !msg.failed && msg.content.trim());
    if (lastAssistant) {
      return {
        title: file.path,
        text: `${file.path}\n\n${lastAssistant.content.trim()}`,
      };
    }
  }
  return diffHandoffText(file);
}
