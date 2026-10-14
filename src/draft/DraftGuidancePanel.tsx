import { useId, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Bot,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  FileText,
  GitCommitHorizontal,
  Info,
  LoaderCircle,
  MessagesSquare,
  OctagonX,
  Quote,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { issueRule, type DraftCheck } from "../../shared/draft-checks";
import {
  aiDisclosureLine,
  linuxContributionUrl,
  withAiDisclosure,
  withoutAiDisclosure,
  type DraftPreparation,
  type DraftProposal,
} from "../../shared/drafts";
import { useFormat, useT } from "../i18n";
import { MarkdownContent } from "../review/MarkdownContent";
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
   * Saves the choice through the draft PATCH (`aiDisclosure`); the server
   * then adds or removes the line in the saved description. Without it the
   * choice is local: it shapes the preview and what "Apply" puts in the
   * editor, which the draft's own save keeps.
   */
  onAiDisclosureChange?: (on: boolean) => void;
  /**
   * The publish preflight for the saved draft (draftPreflight plus the
   * server's GET /api/runs/:id/preflight). Not shown when absent.
   */
  checks?: DraftCheck[];
  /** The run is published: the guidance stays for reference, without actions. */
  readOnly?: boolean;
}

/**
 * Community etiquette the person confirms for themselves, in display order;
 * the text is in `draft.guidance.etiquette.reminders`. The checkboxes are
 * local UI state only: nothing is saved and publishing is never blocked.
 */
const etiquetteReminders = ["claimed", "discussed"] as const;

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
  onAiDisclosureChange,
  checks,
  readOnly = false,
}: Props) {
  const t = useT("draft").guidance;
  const fmt = useFormat();
  const prefix = useId().replaceAll(":", "");
  const [confirmed, setConfirmed] = useState<string[]>([]);
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
  // Off unless the person's setting or the project's rules ask for it.
  const savedDisclosure =
    aiDisclosure ?? (settingOn || !!disclosureRequirement);
  const disclose = onAiDisclosureChange
    ? savedDisclosure
    : (localDisclosure ?? savedDisclosure);
  const disclosureReason =
    aiDisclosure !== undefined || localDisclosure !== undefined
      ? undefined
      : settingOn
        ? t.disclosure.setting
        : undefined;
  const proposalBody = proposal
    ? disclose
      ? withAiDisclosure(proposal.body)
      : withoutAiDisclosure(proposal.body)
    : "";
  const blocking = checks?.filter((check) => check.kind === "block") ?? [];
  const confirming = checks?.filter((check) => check.kind === "confirm") ?? [];
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
          {checks.length ? (
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
              <CircleCheck size={15} aria-hidden="true" /> {t.preflight.clear}
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
        className="draft-guidance-etiquette"
        aria-labelledby={`draft-etiquette-${prefix}`}
      >
        <h3 id={`draft-etiquette-${prefix}`}>
          <MessagesSquare size={16} /> {t.etiquette.title}
        </h3>
        <p>{t.etiquette.intro}</p>
        <ul>
          {etiquetteReminders.map((id) => {
            const inputId = `draft-etiquette-${prefix}-${id}`;
            const reminder = t.etiquette.reminders[id];
            return (
              <li key={id}>
                <input
                  id={inputId}
                  type="checkbox"
                  disabled={readOnly}
                  checked={confirmed.includes(id)}
                  onChange={(event) =>
                    setConfirmed((previous) =>
                      event.target.checked
                        ? [...previous, id]
                        : previous.filter((entry) => entry !== id),
                    )
                  }
                />
                <label htmlFor={inputId}>
                  <strong>{reminder.text}</strong>
                  <small>{reminder.why}</small>
                </label>
              </li>
            );
          })}
        </ul>
        {issueRequirement && (
          <p className="draft-guidance-issue-rule" role="note">
            <strong>{t.etiquette.rule}</strong>
            {t.etiquette.quote({ quote: issueRequirement.quote })}
            <small>
              {t.etiquette.ruleSource({ source: issueRequirement.label })}
            </small>
          </p>
        )}
        {issueLink && (
          <a href={issueLink} target="_blank" rel="noopener noreferrer">
            {t.etiquette.openIssue} <ArrowUpRight size={12} />
          </a>
        )}
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

export { demoDraftPreparation } from "../demo";
