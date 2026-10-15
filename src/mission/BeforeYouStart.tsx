import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  LoaderCircle,
  OctagonX,
  Quote,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import {
  learningLabel,
  openPrBudget,
  pacingExempt,
  type ContributionFacts,
  type ContributionRules,
} from "../../shared/contribution";
import { api } from "../api";
import { getDemo } from "../demo";
import { useFormat, useLocale, useT } from "../i18n";
import {
  doorClosed,
  factsFrom,
  issueNumber,
  rulesFrom,
  sampleRules,
  startReasons,
  unknownParts,
} from "./respect";
import type { StartCheck } from "./StartConfirm";
import "./mission.css";

export interface BeforeYouStartProps {
  repoId: string;
  /** The task's issue link, as typed. */
  issueUrl?: string;
  /** The sample project: its sample facts, and nothing is read. */
  demo: boolean;
  /** The facts read for the link and whether Start should ask once. */
  onFacts?(check: StartCheck): void;
}

/** How long the issue link must stay unchanged before GitHub is read. */
export const issueCheckDelayMs = 600;

/** `info` is a quote: BELL does not judge whether it says go ahead or wait. */
type Tone = "ok" | "warn" | "bad" | "unknown" | "info";
const toneIcons: Record<Tone, LucideIcon> = {
  ok: CircleCheck,
  warn: CircleAlert,
  bad: OctagonX,
  unknown: CircleHelp,
  info: Quote,
};

const sameLogin = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * The task dialog's facts under the issue field (DESIGN F8 and F10): the
 * issue's state, who is on it, other pull requests, the latest maintainer
 * word, newcomer labels and the person's open pull requests here. GitHub is
 * read once per issue link, after the link stops changing; the project's
 * stored rules add the door and an explicit ban. Nothing here stops the run
 * from starting: `onFacts` tells the dialog whether Start asks once.
 */
export default function BeforeYouStart({
  repoId,
  issueUrl,
  demo,
  onFacts,
}: BeforeYouStartProps) {
  const t = useT("mission").start;
  const fmt = useFormat();
  const [locale] = useLocale();
  const id = useId().replaceAll(":", "");
  const sample = demo ? getDemo(locale) : undefined;
  const demoRules = useMemo(
    () => (sample ? sampleRules(sample) : undefined),
    [sample],
  );
  // The project's stored rules: local, never a GitHub read.
  const [storedRules, setStoredRules] = useState<ContributionRules>();
  useEffect(() => {
    setStoredRules(undefined);
    if (demo) return;
    const controller = new AbortController();
    api<unknown>(`/repos/${encodeURIComponent(repoId)}/contribution-rules`, {
      signal: controller.signal,
    })
      .then((body) => {
        if (!controller.signal.aborted) setStoredRules(rulesFrom(body));
      })
      // Without them the chips show the issue's facts only; the overview's
      // card says what could not be read.
      .catch(() => undefined);
    return () => controller.abort();
  }, [demo, repoId]);
  const rules = demoRules ?? storedRules;

  const url = issueUrl?.trim() ?? "";
  const number = issueNumber(url);
  const key = `${repoId}\n${url}`;
  // One read per issue link while the dialog is open; "Check again" reads again.
  const cache = useRef(new Map<string, { facts?: ContributionFacts; error?: string }>());
  const [result, setResult] = useState<{ key: string; facts?: ContributionFacts; error?: string }>();
  const [pending, setPending] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (demo || number === undefined) return;
    const cached = cache.current.get(key);
    if (cached) {
      setResult({ key, ...cached });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setPending(key);
      api<unknown>(
        `/repos/${encodeURIComponent(repoId)}/contribution-check?issue=${encodeURIComponent(url)}`,
        { signal: controller.signal },
      )
        .then((body) => {
          const facts = factsFrom(body);
          return facts ? { facts } : { error: "" };
        })
        .catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "",
        }))
        .then((entry) => {
          if (controller.signal.aborted) return;
          cache.current.set(key, entry);
          setResult({ key, ...entry });
          setPending("");
        });
    }, issueCheckDelayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [demo, key, number, repoId, url, attempt]);
  const current = result?.key === key ? result : undefined;
  const facts = sample
    ? sample.contributionFacts
    : number !== undefined
      ? current?.facts
      : undefined;
  const loading = !demo && pending === key && !current;

  // Tell the dialog what Start should ask, whenever it changes.
  const report = useRef(onFacts);
  report.current = onFacts;
  const reasons = startReasons(facts, rules);
  const reasonsKey = JSON.stringify(reasons);
  useEffect(() => {
    report.current?.({ facts, reasons: JSON.parse(reasonsKey) });
  }, [facts, reasonsKey]);
  useEffect(() => () => report.current?.({ reasons: [] }), []);

  const chips: { key: string; tone: Tone; text: string; title?: string }[] = [];
  const door = facts?.door ?? rules?.door;
  if (door && doorClosed(door)) chips.push({ key: "door", tone: "bad", text: t.doorClosed });
  if (rules?.findings.some((finding) => finding.kind === "ban" && finding.contribution))
    chips.push({ key: "ban", tone: "bad", text: t.ban });
  const issue = facts?.issue;
  const login = door?.login;
  if (issue) {
    const state = issue.state?.toUpperCase();
    if (state === "OPEN") chips.push({ key: "state", tone: "ok", text: t.open });
    else if (state === "CLOSED")
      chips.push({
        key: "state",
        tone: "bad",
        text: t.closed({
          reason: issue.stateReason
            ? (t.closedReasons[issue.stateReason.toUpperCase()] ?? issue.stateReason)
            : undefined,
        }),
      });
    const assignees = issue.assignees ?? [];
    chips.push(
      assignees.length
        ? {
            key: "assigned",
            tone: assignees.every((name) => sameLogin(name, login)) ? "ok" : "warn",
            text: t.assigned({ names: assignees }),
          }
        : { key: "assigned", tone: "ok", text: t.unassigned },
    );
    for (const [index, claim] of (issue.claims ?? []).entries())
      if (!sameLogin(claim.author, login))
        chips.push({
          key: `claim-${index}`,
          tone: "warn",
          text: t.claimed({ author: claim.author, date: fmt.date(claim.at), bot: !!claim.bot }),
        });
    const others = (issue.otherPrs ?? []).filter((pr) => !sameLogin(pr.author, login));
    const open = others.filter((pr) => pr.state.toUpperCase() === "OPEN" && pr.willClose !== false);
    if (open.length)
      for (const pr of open)
        chips.push({
          key: `pr-${pr.number}`,
          tone: "bad",
          text: t.otherPr({ author: pr.author ?? "?", number: pr.number }),
        });
    else chips.push({ key: "pr", tone: "ok", text: t.noOtherPr });
    for (const pr of others.filter((pr) => pr.state.toUpperCase() === "CLOSED"))
      chips.push({
        key: `closed-${pr.number}`,
        tone: "warn",
        text: t.closedPr({ author: pr.author ?? "?", number: pr.number }),
      });
    if (issue.maintainerQuote)
      chips.push({
        key: "maintainer",
        tone: "info",
        text: t.maintainer({
          quote: issue.maintainerQuote.quote,
          date: fmt.date(issue.maintainerQuote.at),
        }),
      });
    const learning = (issue.labels ?? []).filter(learningLabel);
    if (learning.length)
      chips.push({ key: "learning", tone: "warn", text: t.learning({ labels: learning }) });
  }
  const pacing = facts?.pacing;
  if (pacing && typeof pacing.openPrs === "number") {
    if (pacingExempt(pacing.viewerPermission ?? door?.viewerPermission))
      chips.push({ key: "pacing", tone: "ok", text: t.pacingExempt });
    else {
      const budget = openPrBudget(pacing.mergedPrs ?? 0);
      chips.push({
        key: "pacing",
        tone: pacing.openPrs >= 2 * budget ? "bad" : pacing.openPrs >= budget ? "warn" : "ok",
        text: t.pacing({ open: pacing.openPrs, budget }),
        title: t.pacingHelp,
      });
    }
  }
  for (const [index, part] of unknownParts(facts?.unknown).entries())
    chips.push({ key: `unknown-${index}`, tone: "unknown", text: t.unknown(part) });

  const issueLabel = sample
    ? t.sampleIssue({ number: sample.contributionFacts?.issue?.number ?? 0 })
    : number !== undefined
      ? t.issue({ number })
      : undefined;
  return (
    <section className="before-start" aria-labelledby={`before-start-${id}`}>
      <h4 id={`before-start-${id}`}>
        {t.title}
        {issueLabel &&
          (sample ? (
            <span className="before-start-issue">{issueLabel}</span>
          ) : (
            <a className="before-start-issue" href={url} target="_blank" rel="noopener noreferrer">
              {issueLabel}
            </a>
          ))}
      </h4>
      {sample ? (
        <p className="mission-field-note">{t.sample}</p>
      ) : !url ? (
        <p className="mission-field-note">{t.noIssue}</p>
      ) : number === undefined ? (
        <p className="mission-field-note">{t.notGitHub}</p>
      ) : (
        <p className="mission-field-note">{t.lead}</p>
      )}
      <div aria-live="polite">
        {loading && (
          <p className="before-start-status">
            <LoaderCircle className="mission-spin" size={14} aria-hidden="true" />
            {t.checking}
          </p>
        )}
        {current?.error !== undefined && (
          <p className="before-start-status is-unknown">
            <CircleHelp size={14} aria-hidden="true" />
            {current.error ? t.couldntCheck({ reason: current.error }) : t.unknown({ part: "issue" })}
            <button
              type="button"
              className="mission-text-button"
              onClick={() => {
                cache.current.delete(key);
                setResult(undefined);
                setAttempt((value) => value + 1);
              }}
            >
              <RefreshCw size={13} aria-hidden="true" />
              {t.checkAgain}
            </button>
          </p>
        )}
      </div>
      {chips.length > 0 && (
        <ul className="before-start-chips">
          {chips.map((chip) => {
            const Icon = toneIcons[chip.tone];
            return (
              <li key={chip.key} className={`before-start-chip is-${chip.tone}`} title={chip.title}>
                <Icon size={13} aria-hidden="true" />
                <span>{chip.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
