import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  CircleCheck,
  CircleHelp,
  FileText,
  GitPullRequest,
  Loader2,
  OctagonX,
  RefreshCw,
  Scale,
} from "lucide-react";
import {
  policyKinds,
  type ContributionRules,
  type PolicyFinding,
} from "../../shared/contribution";
import { api, send } from "../api";
import { getDemo } from "../demo";
import { useFormat, useLocale, useT, type Messages } from "../i18n";
import { doorState, rulesFrom, sampleRules, unknownParts } from "./respect";
import "./mission.css";

export interface ContributionRulesCardProps {
  repoId: string;
  /** The stored rules (`Repository.contributionRules`); read from the server when absent. */
  rules?: ContributionRules;
  /** The sample project: its fictional CONTRIBUTING.md, classified here, and no request. */
  demo: boolean;
  /** "Check again" through the parent, which then passes the new rules. */
  onRefresh?(): Promise<void>;
}

type Effect = "block" | "confirm" | "info";

/** What publishing does about a finding (shared/contribution.ts respectChecks). */
export function findingEffect(finding: PolicyFinding): Effect {
  switch (finding.kind) {
    case "ban":
      return finding.contribution ? "block" : "confirm";
    case "disclose":
    case "area":
    case "own-words":
      return "block";
    case "agent":
    case "issue-first":
      return "confirm";
    case "understand":
      return "info";
  }
}

const effectIcons = { block: OctagonX, confirm: CircleHelp, info: CircleCheck };

/**
 * A part of the rules that could not be read ("<part>: <reason>" in
 * `ContributionRules.unknown`, besides the door) by what it is, never by
 * its id: the rule files, or the account's default files.
 */
function unreadPart(entry: string): { part: "rules" | "orgDefaults" | "other"; reason?: string } {
  const [head, ...rest] = entry.split(":");
  const id = head.trim();
  const reason = rest.join(":").trim();
  return {
    part: id === "rules" || id === "orgDefaults" ? id : "other",
    ...(reason ? { reason } : {}),
  };
}

function effectText(t: Messages["mission"]["rules"], finding: PolicyFinding) {
  return finding.kind === "ban" && !finding.contribution
    ? t.effect.banAmbiguous
    : t.effect[finding.kind];
}

/**
 * "Before you contribute" (DESIGN F7), at the top of the project overview:
 * whether pull requests are open to the person, then the project's rules
 * quoted with `path:line` and what publishing does about each, in one of
 * three explicit states: found, not found in the files read, or couldn't
 * check. It never says that a project has no rules.
 */
export default function ContributionRulesCard({
  repoId,
  rules: storedRules,
  demo,
  onRefresh,
}: ContributionRulesCardProps) {
  const t = useT("mission").rules;
  const { errors } = useT("common");
  const fmt = useFormat();
  const [locale] = useLocale();
  const demoRules = useMemo(
    () => (demo ? sampleRules(getDemo(locale)) : undefined),
    [demo, locale],
  );
  // Rules read here, by GET when none came with the repository or by
  // "Check again"; newer stored ones from the parent replace them.
  const [loaded, setLoaded] = useState<{ repoId: string; rules?: ContributionRules; error?: string }>();
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    setLoaded(undefined);
    if (demo || storedRules) return;
    const controller = new AbortController();
    api<unknown>(`/repos/${encodeURIComponent(repoId)}/contribution-rules`, {
      signal: controller.signal,
    })
      .then((body) => {
        if (!controller.signal.aborted) setLoaded({ repoId, rules: rulesFrom(body) });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({ repoId, error: error instanceof Error ? error.message : "" });
      });
    return () => controller.abort();
  }, [demo, repoId, storedRules]);
  const mine = loaded?.repoId === repoId ? loaded : undefined;
  const rules = demoRules ?? mine?.rules ?? storedRules;
  const error = mine?.error;
  const loading = !demo && !storedRules && !mine;

  const checkAgain = async () => {
    setChecking(true);
    try {
      if (onRefresh) await onRefresh();
      else {
        const body = await api<unknown>(
          `/repos/${encodeURIComponent(repoId)}/contribution-rules/refresh`,
          send("POST"),
        );
        setLoaded({ repoId, rules: rulesFrom(body) });
      }
    } catch (cause) {
      setLoaded({ repoId, error: cause instanceof Error ? cause.message : "" });
    } finally {
      setChecking(false);
    }
  };

  const doorReason = unknownParts(rules?.unknown).find((entry) => entry.part === "door");
  const unread = (rules?.unknown ?? [])
    .filter((entry) => unknownParts([entry])[0].part !== "door")
    .map(unreadPart);
  const door = rules?.door ? doorState(rules.door) : undefined;
  const findings = rules?.findings ?? [];
  const groups = policyKinds
    .map((kind) => ({ kind, items: findings.filter((finding) => finding.kind === kind) }))
    .filter((group) => group.items.length > 0);
  const checkedAt = rules?.checkedAt ? new Date(rules.checkedAt) : undefined;
  const filesRead = rules?.filesRead ?? [];

  return (
    <section className="rules-card" aria-labelledby="rules-card-title">
      <div className="rules-card-head">
        <div>
          <span className="mission-kicker">
            <Scale size={14} aria-hidden="true" />
            {t.kicker}
          </span>
          <h2 id="rules-card-title">{t.title}</h2>
          <p>{t.lead}</p>
        </div>
        {!demo && (
          <button
            type="button"
            className="mission-button mission-button-secondary"
            onClick={() => void checkAgain()}
            disabled={checking}
          >
            {checking ? (
              <Loader2 className="mission-spin" size={15} aria-hidden="true" />
            ) : (
              <RefreshCw size={15} aria-hidden="true" />
            )}
            {checking ? t.checking : t.checkAgain}
          </button>
        )}
      </div>
      {demo && <p className="rules-card-sample">{t.sample}</p>}

      {rules && (
        <p
          className={`rules-card-door is-${door === "open" ? "ok" : door ? "bad" : "unknown"}`}
        >
          <GitPullRequest size={15} aria-hidden="true" />
          {door ? t.door[door] : t.door.unknown({ reason: doorReason?.reason })}
        </p>
      )}

      {error !== undefined && (
        <p className="rules-card-state is-unknown" role="status">
          {t.couldntCheck({ reason: error || errors.generic })}
        </p>
      )}
      {!rules ? (
        loading ? (
          <p className="rules-card-state" role="status">
            {t.checking}
          </p>
        ) : (
          error === undefined && (
            <p className="rules-card-state is-unknown">
              {t.couldntCheck({ reason: t.notRead })}
            </p>
          )
        )
      ) : groups.length ? (
        <>
          <p className="rules-card-state">
            {t.found({ count: findings.length, files: filesRead.length })}
          </p>
          {groups.map((group) => (
            <section key={group.kind} className="rules-card-group">
              <h3>{t.kinds[group.kind]}</h3>
              {group.items.map((finding, index) => {
                const effect = findingEffect(finding);
                const Icon = effectIcons[effect];
                return (
                  <figure key={`${finding.path}:${finding.line}:${index}`}>
                    <blockquote>{finding.quote}</blockquote>
                    <figcaption>
                      <code>{`${finding.path}:${finding.line}`}</code>
                      <span className={`rules-card-effect is-${effect}`}>
                        <Icon size={13} aria-hidden="true" />
                        {t.effects[effect]}
                      </span>
                      <span>{effectText(t, finding)}</span>
                    </figcaption>
                  </figure>
                );
              })}
            </section>
          ))}
        </>
      ) : (
        <p className="rules-card-state">
          {filesRead.length ? t.notFound({ files: filesRead.length }) : t.noFiles}
        </p>
      )}

      {rules && (
        <div className="rules-card-meta">
          {filesRead.length > 0 && (
            <details>
              <summary>
                <FileText size={14} aria-hidden="true" />
                {t.filesRead({ count: filesRead.length })}
                <ChevronRight size={14} aria-hidden="true" />
              </summary>
              <ul>
                {filesRead.map((file) => (
                  <li key={file}>
                    <code>{file}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {rules.orgDefaults && <p>{t.orgDefaults({ repository: rules.orgDefaults })}</p>}
          {unread.map((entry, index) => (
            <p key={index}>{t.unread(entry)}</p>
          ))}
          {!demo && checkedAt && !Number.isNaN(checkedAt.getTime()) && (
            <p>
              {t.checkedAt({ date: fmt.dateTime(checkedAt) })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
