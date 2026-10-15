import { useEffect, useId, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Bot,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  ClipboardList,
  FileText,
  GitCommitHorizontal,
  Info,
  ListChecks,
  LoaderCircle,
  OctagonX,
  Quote,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { issueRule, type DraftCheck } from "../../shared/draft-checks";
import {
  respectChecks,
  type ContributionFacts,
  type ContributionRules,
} from "../../shared/contribution";
import type { ReviewabilitySnapshot } from "../../shared/reviewability";
import {
  aiDisclosureLine,
  linuxContributionUrl,
  withAiDisclosure,
  withoutAiDisclosure,
  type DraftPreparation,
  type DraftProposal,
} from "../../shared/drafts";
import { useFormat, useLocale, useT } from "../i18n";
import { MarkdownContent } from "../review/MarkdownContent";
import {
  checklistCheck,
  checklistRowIds,
  checklistRows,
  withFactChecks,
  type ChecklistStatus,
} from "./checklist";
import { disclosureRule } from "./disclosure";
import { rich } from "./rich";
import "./drafts.css";

interface Props {
  preparation?: DraftPreparation;
  busy: boolean;
  disabled?: boolean;
  demo?: boolean;
  /** The issue the user linked in the contribution settings, if any. */
  issueUrl?: string;
  onGenerate: () => void;
  onApply: (proposal: DraftProposal) => void;
  /** True while the editor holds this proposal's title and body unchanged. */
  applied?: boolean;
  /**
   * The saved AI-assistance choice, `run.draft.aiDisclosure`; undefined
   * means the person has not chosen yet.
   */
  aiDisclosure?: boolean;
  /** The app setting that turns the disclosure on for every new draft. */
  alwaysDiscloseAi?: boolean;
  /**
   * The description in the editor. While no choice is saved, the switch
   * then shows whether it holds the AI-assistance line, so it never reads
   * On for a description without it.
   */
  draftBody?: string;
  /**
   * Saves the choice through the draft PATCH (`aiDisclosure`); the server
   * then adds or removes the line in the saved description. Without it the
   * choice is local: it shapes the preview and what "Apply" puts in the
   * editor, which the draft's own save keeps.
   */
  onAiDisclosureChange?: (on: boolean) => void;
  /**
   * The publish preflight for the saved draft (draftPreflight plus the
   * server's GET /api/runs/:id/preflight). Not shown when absent. The
   * respect checks among them (computed with the same rules, facts and
   * changes as the props below) and the issue-link and brevity checks set
   * the maintainer checklist's rows, which add the fact checks they lack
   * from those props; the list shows the others.
   */
  checks?: DraftCheck[];
  /** The run is published: the guidance stays for reference, without actions. */
  readOnly?: boolean;
  /** The project's quoted rules, for the live maintainer checklist. */
  rules?: ContributionRules;
  /** The GitHub facts last read for this run. */
  facts?: ContributionFacts;
  /** The understanding check's state: required, passed, or turned off. */
  understanding?: { required: boolean; passed: boolean; off: boolean };
  changes?: ReviewabilitySnapshot;
}

const statusIcons: Record<ChecklistStatus, typeof CircleCheck> = {
  ok: CircleCheck,
  confirm: CircleAlert,
  block: OctagonX,
  unknown: CircleHelp,
  off: CircleMinus,
};

/**
 * How many times this browser showed each checklist row's "why
 * maintainers care" sentence. After `whyShownTimes` it folds away. Storage
 * can be blocked or full: the sentence then simply stays open.
 */
const whySeenKey = "bellpr-checklist-why-seen";
export const whyShownTimes = 3;

function readWhySeen(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(
      globalThis.localStorage?.getItem(whySeenKey) || "{}",
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

function countWhySeen() {
  try {
    const seen = readWhySeen();
    for (const id of checklistRowIds)
      seen[id] = Math.min(99, (Number(seen[id]) || 0) + 1);
    globalThis.localStorage?.setItem(whySeenKey, JSON.stringify(seen));
  } catch {
    // Not remembered; the sentences stay open next time.
  }
}

function webLink(value?: string) {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function DraftGuidancePanel({
  preparation,
  busy,
  disabled = false,
  demo = false,
  issueUrl,
  onGenerate,
  onApply,
  applied = false,
  aiDisclosure,
  alwaysDiscloseAi,
  draftBody,
  onAiDisclosureChange,
  checks,
  readOnly = false,
  rules,
  facts,
  understanding,
  changes,
}: Props) {
  const draftMessages = useT("draft");
  const t = draftMessages.guidance;
  const fmt = useFormat();
  const [locale] = useLocale();
  const prefix = useId().replaceAll(":", "");
  // Read once per visit, then counted, so the sentences fold on a later one.
  const [whySeen] = useState(readWhySeen);
  useEffect(countWhySeen, []);
  // The choice made here while nothing saves it (no onAiDisclosureChange).
  const [localDisclosure, setLocalDisclosure] = useState<boolean>();
  const issueLink = webLink(issueUrl);
  const proposal = preparation?.proposal;
  const sources = preparation?.context?.sources ?? [];
  const template = sources.find(
    (source) => source.id === proposal?.templateSourceId,
  );
  const issueRequirement = issueRule(sources);
  const disclosureRequirement = disclosureRule(sources);
  // The server adds the line to new suggestions while the setting is on.
  const settingOn =
    alwaysDiscloseAi ?? !!proposal?.body.includes(aiDisclosureLine);
  // Without a saved choice, off unless the person's setting or the
  // project's rules ask for it.
  const suggestedDisclosure =
    aiDisclosure ?? (settingOn || !!disclosureRequirement);
  // The switch shows what the description holds while no choice is saved.
  const savedDisclosure =
    aiDisclosure === undefined && draftBody !== undefined
      ? draftBody.includes(aiDisclosureLine)
      : suggestedDisclosure;
  const disclose = onAiDisclosureChange
    ? savedDisclosure
    : (localDisclosure ?? savedDisclosure);
  // The suggestion keeps the line the setting or the rules ask for, so
  // "Apply" adds it even to a description that lacks it.
  const proposalDisclosure = localDisclosure ?? suggestedDisclosure;
  const disclosureReason =
    aiDisclosure !== undefined || localDisclosure !== undefined || !disclose
      ? undefined
      : settingOn
        ? t.disclosure.setting
        : undefined;
  const proposalBody = proposal
    ? proposalDisclosure
      ? withAiDisclosure(proposal.body)
      : withoutAiDisclosure(proposal.body)
    : "";
  // The maintainer checklist shows the respect checks; the list keeps the
  // other checks on the text.
  const textChecks = checks?.filter((check) => !checklistCheck(check)) ?? [];
  const blocking = textChecks.filter((check) => check.kind === "block");
  const confirming = textChecks.filter((check) => check.kind === "confirm");
  // Without the saved draft's checks (the sample, a published run), the
  // rows follow the editor's text and the facts passed in. With them, the
  // facts passed in still fill the fact checks they lack (checks computed
  // without those facts, such as the editor's before the server's arrive).
  const local =
    rules || facts || changes
      ? respectChecks(
          {
            body: draftBody ?? "",
            proposalBody: proposal?.body,
            sources,
            rules,
            facts,
            changes,
            issueUrl,
            // The check is not required only while the person turned it
            // off, and a pass counts whatever the setting says.
            understandingOff:
              understanding &&
              !understanding.passed &&
              (understanding.off || !understanding.required),
          },
          locale,
        )
      : undefined;
  const respect = checks
    ? withFactChecks(
        checks,
        // Without the editor's text, the disclosure is the saved draft's to say.
        draftBody === undefined
          ? local?.filter((check) => check.id !== "ai-disclosure")
          : local,
      )
    : local;
  const rows = checklistRows(
    {
      checks: respect,
      rules,
      facts,
      changes,
      understanding,
      issueUrl,
      disclosureRule: disclosureRequirement,
      suggestion: !!proposal?.body.trim(),
    },
    t.checklist,
    fmt,
    draftMessages.reviewability.bands,
  );
  const readAt = (value?: string) => {
    const date = value ? new Date(value) : undefined;
    return date && !Number.isNaN(date.getTime()) ? fmt.dateTime(date) : undefined;
  };
  const rulesRead = readAt(rules?.checkedAt);
  const factsRead = readAt(facts?.checkedAt);
  const checkedAt = preparation?.context?.checkedAt;
  const checkedDate = checkedAt ? new Date(checkedAt) : undefined;
  const generating = busy || preparation?.status === "generating";
  const ready = preparation?.status === "ready" && !!proposal;
  const sourceAnchor = (index: number) => `draft-source-${prefix}-${index}`;
  const statusMessage = generating
    ? t.status.generating
    : preparation?.status === "failed"
      ? preparation.error || t.status.failed
      : preparation?.status === "stale"
        ? t.status.stale
        : undefined;
  const generateLabel = generating
    ? t.generate.generating
    : preparation?.status === "failed"
      ? t.generate.retry
      : preparation
        ? t.generate.refresh
        : demo
          ? t.generate.demo
          : t.generate.first;

  const disclosure = (
    <section
      className="draft-guidance-disclosure"
      aria-labelledby={`draft-disclosure-${prefix}`}
    >
      <div className="draft-guidance-disclosure-head">
        <h3 id={`draft-disclosure-${prefix}`}>
          <Bot size={16} aria-hidden="true" /> {t.disclosure.title}
        </h3>
        <label className="draft-guidance-switch">
          <input
            type="checkbox"
            role="switch"
            checked={disclose}
            disabled={readOnly || disabled}
            aria-describedby={`draft-disclosure-help-${prefix}`}
            onChange={(event) => {
              const on = event.target.checked;
              if (onAiDisclosureChange) onAiDisclosureChange(on);
              else setLocalDisclosure(on);
            }}
          />
          <span>{t.disclosure.label}</span>
          <b aria-hidden="true">{disclose ? t.disclosure.on : t.disclosure.off}</b>
        </label>
      </div>
      <p id={`draft-disclosure-help-${prefix}`}>
        {disclose
          ? t.disclosure.lineOn({ line: aiDisclosureLine })
          : t.disclosure.lineOff}
        {disclosureReason && ` ${disclosureReason}`}
      </p>
      {disclosureRequirement && (
        <p className="draft-guidance-disclosure-rule" role="note">
          <strong>{t.disclosure.rule}</strong>
          {t.disclosure.quote({ quote: disclosureRequirement.quote })}
          <small>
            {t.disclosure.ruleSource({ source: disclosureRequirement.label })}
          </small>
        </p>
      )}
      {!onAiDisclosureChange && proposal && !readOnly && (
        <p className="draft-guidance-disclosure-hint">
          {t.disclosure.applyHint}
        </p>
      )}
    </section>
  );

  return (
    <section
      className="draft-guidance-panel"
      aria-labelledby={`draft-guidance-${prefix}`}
    >
      <header className="draft-guidance-header">
        <span className="draft-guidance-icon" aria-hidden="true">
          <BookOpen size={21} />
        </span>
        <div className="draft-guidance-heading">
          <div className="draft-guidance-eyebrow">{t.eyebrow}</div>
          <h2 id={`draft-guidance-${prefix}`}>{t.title}</h2>
          <p>{t.intro}</p>
        </div>
        <div className="draft-guidance-actions">
          {demo && (
            <span className="draft-guidance-badge is-demo">{t.demoBadge}</span>
          )}
          {proposal && (
            <span
              className={`draft-guidance-badge ${proposal.policy === "linux" ? "is-fallback" : ""}`}
            >
              {proposal.policy === "repository"
                ? t.policy.repository
                : t.policy.linux}
            </span>
          )}
          {!readOnly && (
            <button
              type="button"
              className="button secondary draft-guidance-generate"
              onClick={onGenerate}
              disabled={disabled || generating}
            >
              {generating ? (
                <LoaderCircle className="spin" size={15} />
              ) : preparation ? (
                <RefreshCw size={15} />
              ) : (
                <Sparkles size={15} />
              )}
              {generateLabel}
            </button>
          )}
        </div>
      </header>

      {readOnly && (
        <p className="draft-guidance-readonly" role="note">
          <Info size={16} aria-hidden="true" />
          {t.readOnly}
        </p>
      )}

      {statusMessage && (
        <div
          className={`draft-guidance-notice ${preparation?.status === "failed" ? "is-error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {generating ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Info size={17} />
          )}
          <p>{statusMessage}</p>
        </div>
      )}

      {!preparation && !readOnly && (
        <div className="draft-guidance-empty">
          <span>
            <FileText size={16} /> {t.empty.rules}
          </span>
          <span>
            <Quote size={16} /> {t.empty.sources}
          </span>
          <span>
            <ArrowDownToLine size={16} /> {t.empty.choice}
          </span>
          <p>{demo ? t.empty.demo : t.empty.real}</p>
        </div>
      )}

      {!!preparation?.context?.warnings.length && (
        <div className="draft-guidance-warnings">
          <div>
            <Info size={16} />
            <strong>{t.warnings}</strong>
          </div>
          <ul>
            {preparation.context.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {proposal && (
        <>
          <p className="draft-guidance-summary">{proposal.summary}</p>
          <div className="draft-guidance-columns">
            <div className="draft-guidance-rules">
              <h3>
                <Quote size={16} />{" "}
                {proposal.policy === "linux" && !proposal.rules.length
                  ? t.rules.defaultTitle
                  : t.rules.title}
              </h3>
              {proposal.rules.length ? (
                <ol>
                  {proposal.rules.map((rule, index) => {
                    const sourceIndex = sources.findIndex(
                      (source) => source.id === rule.sourceId,
                    );
                    const source = sources[sourceIndex];
                    const url = webLink(source?.url);
                    return (
                      <li key={`${rule.sourceId}-${index}`}>
                        <span
                          className="draft-guidance-number"
                          aria-hidden="true"
                        >
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <p>{rule.text}</p>
                          {source ? (
                            <a
                              className="draft-guidance-source-link"
                              href={url ?? `#${sourceAnchor(sourceIndex)}`}
                              {...(url
                                ? {
                                    target: "_blank",
                                    rel: "noopener noreferrer",
                                  }
                                : {})}
                            >
                              <FileText size={12} />
                              {source.label}
                              {url && <ArrowUpRight size={12} />}
                            </a>
                          ) : (
                            <span className="draft-guidance-source-missing">
                              {t.rules.noSource}
                            </span>
                          )}
                          <details className="draft-guidance-quote">
                            <summary>
                              <ChevronDown size={13} /> {t.rules.quote}
                            </summary>
                            <blockquote>{rule.quote}</blockquote>
                          </details>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : proposal.policy === "linux" ? (
                <ol>
                  {t.rules.linuxPrinciples.map((principle, index) => (
                    <li key={principle}>
                      <span
                        className="draft-guidance-number"
                        aria-hidden="true"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <p>{principle}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="draft-guidance-template-note">
                  {template
                    ? rich(t.rules.template, {
                        template: <strong>{template.label}</strong>,
                      })
                    : t.rules.noRules}
                </p>
              )}
            </div>
            <div className="draft-guidance-checks">
              <h3>
                <ClipboardList size={16} /> {t.checks.title}
              </h3>
              <p>{t.checks.intro}</p>
              <ul>
                {proposal.checklist.map((item, index) => (
                  <li key={index}>
                    <Circle size={14} aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {disclosure}
          <details className="draft-guidance-proposal">
            <summary>
              <span className="draft-guidance-proposal-label">
                <FileText size={17} />
                <span>
                  <strong>{t.preview}</strong>
                  <small>{proposal.title}</small>
                </span>
              </span>
              <ChevronDown size={17} />
            </summary>
            <div className="draft-guidance-proposal-content">
              <h3>{proposal.title}</h3>
              <MarkdownContent>{proposalBody}</MarkdownContent>
            </div>
          </details>
          {!readOnly && (
            <div className="draft-guidance-apply">
              <p>
                {applied ? t.apply.appliedNote : t.apply.note}
              </p>
              <button
                type="button"
                className="button primary"
                onClick={() => onApply({ ...proposal, body: proposalBody })}
                disabled={disabled || generating || !ready || applied}
              >
                <ArrowDownToLine size={15} /> {applied ? t.apply.applied : t.apply.apply}
              </button>
            </div>
          )}

          {proposal.commitMessageSuggestion && (
            <div className="draft-guidance-commit">
              <h3>
                <GitCommitHorizontal size={16} /> {t.commit.title}
              </h3>
              <pre>{proposal.commitMessageSuggestion.message}</pre>
              <p>{proposal.commitMessageSuggestion.rationale}</p>
              {proposal.commitMessageSuggestion.sources.length > 0 && (
                <p className="draft-guidance-commit-sources">
                  {t.commit.sources}
                  {proposal.commitMessageSuggestion.sources.map((id) => {
                    const sourceIndex = sources.findIndex(
                      (source) => source.id === id,
                    );
                    const source = sources[sourceIndex];
                    const url = webLink(source?.url);
                    return source ? (
                      <a
                        key={id}
                        className="draft-guidance-source-link"
                        href={url ?? `#${sourceAnchor(sourceIndex)}`}
                        {...(url
                          ? { target: "_blank", rel: "noopener noreferrer" }
                          : {})}
                      >
                        <FileText size={12} />
                        {source.label}
                        {url && <ArrowUpRight size={12} />}
                      </a>
                    ) : (
                      <span key={id} className="draft-guidance-source-missing">
                        {t.rules.noSource}
                      </span>
                    );
                  })}
                </p>
              )}
              <p className="draft-guidance-commit-why">
                {rich(t.commit.why, {
                  typeScope: <code>{t.commit.code.typeScope}</code>,
                  subject: <code>{t.commit.code.subject}</code>,
                  signOff: <code>{t.commit.code.signOff}</code>,
                })}
              </p>
            </div>
          )}
        </>
      )}

      {!proposal && onAiDisclosureChange && disclosure}

      {checks && (
        <section
          className="draft-guidance-preflight"
          aria-labelledby={`draft-preflight-${prefix}`}
        >
          <h3 id={`draft-preflight-${prefix}`}>
            <ShieldCheck size={16} aria-hidden="true" /> {t.preflight.title}
          </h3>
          <p>{t.preflight.intro}</p>
          {textChecks.length ? (
            <ul>
              {[...blocking, ...confirming].map((check) => (
                <li key={check.id} className={`is-${check.kind}`}>
                  <span className="draft-guidance-preflight-kind">
                    {check.kind === "block" ? (
                      <OctagonX size={14} aria-hidden="true" />
                    ) : (
                      <CircleAlert size={14} aria-hidden="true" />
                    )}
                    {check.kind === "block"
                      ? t.preflight.block
                      : t.preflight.confirm}
                  </span>
                  <strong>{check.message}</strong>
                  {check.details.length > 0 && (
                    <ul>
                      {check.details.map((detail, index) => (
                        <li key={index}>{detail}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="draft-guidance-preflight-clear">
              <CircleCheck size={15} aria-hidden="true" />{" "}
              {checks.length ? t.preflight.textClear : t.preflight.clear}
            </p>
          )}
        </section>
      )}

      {!demo && preparation?.context && (
        <div className="draft-guidance-source-meta">
          <span>
            {rich(t.meta.base, {
              commit: <code>{preparation.context.baseSha.slice(0, 7)}</code>,
            })}
          </span>
          {checkedDate && !Number.isNaN(checkedDate.getTime()) && (
            <span>
              {rich(t.meta.checked, {
                time: (
                  <time dateTime={checkedAt}>{fmt.dateTime(checkedDate)}</time>
                ),
              })}
            </span>
          )}
        </div>
      )}

      {!!sources.length && (
        <details className="draft-guidance-sources">
          <summary>
            <FileText size={15} />
            <span>
              {t.sources.title}{" "}
              <small>{t.sources.count({ count: sources.length })}</small>
            </span>
            <ChevronDown size={15} />
          </summary>
          <div className="draft-guidance-source-list">
            {sources.map((source, index) => {
              const url = webLink(source.url);
              return (
                <details key={source.id} id={sourceAnchor(index)}>
                  <summary>
                    <span>
                      {source.label}
                      <small>{source.path ?? t.sources.kinds[source.kind]}</small>
                    </span>
                    <span className="draft-guidance-source-kind">
                      {source.id === proposal?.templateSourceId
                        ? t.sources.usedTemplate
                        : t.sources.kinds[source.kind]}
                    </span>
                    <ChevronDown size={14} />
                  </summary>
                  <div className="draft-guidance-source-content">
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        {t.sources.open} <ArrowUpRight size={13} />
                      </a>
                    )}
                    <pre
                      tabIndex={0}
                      aria-label={t.sources.textLabel({ label: source.label })}
                    >
                      {source.content}
                    </pre>
                  </div>
                </details>
              );
            })}
          </div>
        </details>
      )}

      <section
        className="draft-checklist"
        aria-labelledby={`draft-checklist-${prefix}`}
      >
        <h3 id={`draft-checklist-${prefix}`}>
          <ListChecks size={16} aria-hidden="true" /> {t.checklist.title}
        </h3>
        <p>{t.checklist.intro}</p>
        {(rulesRead || factsRead) && (
          <p className="draft-checklist-meta">
            {rulesRead && <span>{t.checklist.rulesRead({ date: rulesRead })}</span>}
            {factsRead && <span>{t.checklist.factsRead({ date: factsRead })}</span>}
          </p>
        )}
        <ul>
          {rows.map((row) => {
            const Icon = statusIcons[row.status];
            const why = t.checklist.why[row.id];
            return (
              <li
                key={row.id}
                className={`draft-checklist-row is-${row.status}`}
                data-row={row.id}
              >
                <span className="draft-checklist-status">
                  <Icon size={14} aria-hidden="true" />
                  {t.checklist.status[row.status]}
                </span>
                <div className="draft-checklist-body">
                  <strong>{t.checklist.rows[row.id]}</strong>
                  {row.lines.map((line, index) => (
                    <p key={index}>{line}</p>
                  ))}
                  {row.sources.length > 0 && (
                    <ul className="draft-checklist-sources">
                      {row.sources.map((source, index) => (
                        <li key={index}>{source}</li>
                      ))}
                    </ul>
                  )}
                  {/* The issue-link check, when it fires, quotes the same rule. */}
                  {row.id === "issue" &&
                    issueRequirement &&
                    !respect?.some((check) => check.id === "issue") && (
                    <p className="draft-guidance-issue-rule" role="note">
                      <strong>{t.checklist.rule}</strong>
                      {t.checklist.ruleQuote({ quote: issueRequirement.quote })}
                      <small>
                        {t.checklist.ruleSource({ source: issueRequirement.label })}
                      </small>
                    </p>
                  )}
                  {row.id === "issue" && issueLink && (
                    <a href={issueLink} target="_blank" rel="noopener noreferrer">
                      {t.checklist.openIssue} <ArrowUpRight size={12} aria-hidden="true" />
                    </a>
                  )}
                  {(whySeen[row.id] ?? 0) >= whyShownTimes ? (
                    <details className="draft-checklist-why">
                      <summary>{t.checklist.whySummary}</summary>
                      <p>{why}</p>
                    </details>
                  ) : (
                    <p className="draft-checklist-why">{why}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {proposal?.policy === "linux" && (
        <p className="draft-guidance-linux">
          {rich(t.linux.note, {
            guide: (
              <a
                href={linuxContributionUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.linux.guide} <ArrowUpRight size={12} />
              </a>
            ),
          })}
        </p>
      )}
    </section>
  );
}
