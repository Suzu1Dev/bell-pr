import { useId, useState } from "react";
import { ArrowUpRight, Telescope } from "lucide-react";
import type { PrFeedback, PrFeedbackItem } from "../../shared/pr-feedback";
import {
  tasteDimensions,
  understandingLimits,
  type FeedbackTag,
  type MaintainerForecast,
} from "../../shared/understanding";
import { useT, type Messages } from "../i18n";
import { ProBadge } from "../license/ProBadge";
import { requestUpgrade } from "../license/useEntitlements";
import "./drafts.css";

/**
 * Forecast against reality (DESIGN F11): "Your forecast" beside what the
 * maintainers said (OWNER, MEMBER and COLLABORATOR items only), with a
 * taste dimension and "Saw it coming / Surprised me" per item, and an
 * outcome line that states facts only.
 */
export interface ForecastCompareProps {
  forecast?: MaintainerForecast;
  feedback?: PrFeedback;
  /** The person's tags, by feedback item URL. */
  tags?: Record<string, FeedbackTag>;
  onTag?(url: string, tag: Omit<FeedbackTag, "at">): void;
  locked?: boolean;
  demo?: boolean;
}

/** GitHub's author associations that speak for the project. */
const maintainers = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/** The maintainers' items, the ones the comparison is about. */
export function maintainerItems(feedback?: PrFeedback) {
  return (feedback?.items ?? []).filter((item) =>
    maintainers.has(item.authorAssociation.toUpperCase()),
  );
}

const dayMs = 24 * 60 * 60 * 1000;

export type Outcome =
  | { id: "merged" | "changes" | "closed" | "approved" | "commented" }
  | { id: "waiting"; days?: number };

/**
 * What happened to the pull request, from the facts GitHub reported when
 * the feedback was read: merged, changes requested, closed without
 * merging, approved, commented, or no response yet. Silence is never shown
 * as a rejection. Without the date the pull request opened, "no response
 * yet" counts the days since the oldest item on it, a lower bound, and
 * leaves the number out when there is none.
 */
export function feedbackOutcome(feedback: PrFeedback): Outcome {
  const state = feedback.prState?.toUpperCase();
  if (feedback.merged || state === "MERGED") return { id: "merged" };
  if (state === "CLOSED") return { id: "closed" };
  const decision = feedback.reviewDecision?.toUpperCase();
  if (decision === "CHANGES_REQUESTED") return { id: "changes" };
  if (decision === "APPROVED") return { id: "approved" };
  if (maintainerItems(feedback).length) return { id: "commented" };
  const times = feedback.items
    .map((item) => Date.parse(item.createdAt))
    .filter((time) => !Number.isNaN(time));
  const read = Date.parse(feedback.fetchedAt);
  if (!times.length || Number.isNaN(read)) return { id: "waiting" };
  return {
    id: "waiting",
    days: Math.max(0, Math.floor((read - Math.min(...times)) / dayMs)),
  };
}

function webLink(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

type ForecastMessages = Messages["draft"]["forecast"];

function outcomeText(t: ForecastMessages, outcome: Outcome) {
  return outcome.id === "waiting" ? t.waiting({ days: outcome.days }) : t.outcomes[outcome.id];
}

function ItemTags({
  item,
  tag,
  onTag,
  demo,
}: {
  item: PrFeedbackItem;
  tag: Omit<FeedbackTag, "at">;
  onTag?(tag: Omit<FeedbackTag, "at">): void;
  demo: boolean;
}) {
  const t = useT("draft").forecast;
  const id = useId().replaceAll(":", "");
  const [lesson, setLesson] = useState(tag.lesson ?? "");
  const readOnly = !onTag;
  const change = (next: Partial<Omit<FeedbackTag, "at">>) => {
    const merged = { ...tag, ...next };
    // A lesson belongs to a surprise only.
    if (merged.predicted !== false) delete merged.lesson;
    onTag?.(merged);
  };
  const link = demo ? undefined : webLink(item.url);
  return (
    <li className="forecast-item">
      <div className="forecast-item-head">
        <strong>@{item.author}</strong>
        <span>{item.authorAssociation}</span>
        {item.path && <code>{t.line({ path: item.path, line: item.line })}</code>}
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer">
            {t.open} <ArrowUpRight size={12} aria-hidden="true" />
          </a>
        )}
      </div>
      {item.body.trim() && <p className="forecast-item-body">{item.body}</p>}
      <div
        className="forecast-chips"
        role="group"
        aria-label={t.dimension({ author: item.author })}
      >
        {tasteDimensions.map((dimension) => (
          <button
            key={dimension}
            type="button"
            className="forecast-chip"
            aria-pressed={tag.dimension === dimension}
            disabled={readOnly}
            onClick={() =>
              change({ dimension: tag.dimension === dimension ? undefined : dimension })
            }
          >
            {t.dimensions[dimension]}
          </button>
        ))}
      </div>
      <div
        className="forecast-chips forecast-predicted"
        role="group"
        aria-label={t.predicted({ author: item.author })}
      >
        {([true, false] as const).map((value) => (
          <button
            key={String(value)}
            type="button"
            className="forecast-chip"
            aria-pressed={tag.predicted === value}
            disabled={readOnly}
            onClick={() =>
              change({ predicted: tag.predicted === value ? undefined : value })
            }
          >
            {value ? t.sawIt : t.surprised}
          </button>
        ))}
      </div>
      {tag.predicted === false && (
        <div className="forecast-lesson">
          <label htmlFor={`forecast-lesson-${id}`}>{t.lesson}</label>
          <input
            id={`forecast-lesson-${id}`}
            type="text"
            value={lesson}
            maxLength={understandingLimits.lessonChars}
            disabled={readOnly}
            aria-describedby={`forecast-lesson-${id}-hint`}
            onChange={(event) => setLesson(event.target.value)}
          />
          <small id={`forecast-lesson-${id}-hint`}>
            {t.lessonHint({ max: understandingLimits.lessonChars })}
          </small>
          {!readOnly && (
            <button
              type="button"
              className="button secondary"
              disabled={lesson.trim() === (tag.lesson ?? "").trim()}
              onClick={() => change({ lesson: lesson.trim() || undefined })}
            >
              {t.saveLesson}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default function ForecastCompare({
  forecast,
  feedback,
  tags = {},
  onTag,
  locked = false,
  demo = false,
}: ForecastCompareProps) {
  const t = useT("draft").forecast;
  const id = useId().replaceAll(":", "");
  // Tags chosen here show at once, until the parent saves a newer one.
  const [chosen, setChosen] = useState<
    Record<string, { tag: Omit<FeedbackTag, "at">; savedAt?: string }>
  >({});
  const items = maintainerItems(feedback);
  const outcome = feedback && feedbackOutcome(feedback);
  const yours = (
    <div className="forecast-yours">
      <h4>{t.yours}</h4>
      {forecast && (forecast.dimension || forecast.question?.trim()) ? (
        <>
          {forecast.dimension && (
            <span className="forecast-chip is-static">{t.dimensions[forecast.dimension]}</span>
          )}
          {forecast.question?.trim() && <p>{forecast.question.trim()}</p>}
        </>
      ) : (
        <p className="forecast-none">{t.none}</p>
      )}
    </div>
  );
  return (
    <section className="forecast" aria-labelledby={`forecast-${id}`}>
      <h3 id={`forecast-${id}`}>
        <Telescope size={16} aria-hidden="true" /> {t.title}
      </h3>
      {outcome && (
        <p className="forecast-outcome">
          <strong>{t.outcome}</strong> {outcomeText(t, outcome)}
        </p>
      )}
      <div className="forecast-columns">
        {yours}
        {locked ? (
          <div className="forecast-locked">
            <ProBadge />
            <p>{t.locked}</p>
            <button
              type="button"
              className="button secondary"
              onClick={() => requestUpgrade("prFeedback")}
            >
              {t.seePro}
            </button>
          </div>
        ) : (
          <div className="forecast-theirs">
            <h4>{t.theirs}</h4>
            {!feedback ? (
              <p className="forecast-none">{t.readFirst}</p>
            ) : items.length ? (
              <ul>
                {items.map((item) => {
                  const saved = tags[item.url];
                  const local = chosen[item.url];
                  const tag =
                    local && local.savedAt === saved?.at
                      ? local.tag
                      : {
                          dimension: saved?.dimension,
                          predicted: saved?.predicted,
                          lesson: saved?.lesson,
                        };
                  return (
                    <ItemTags
                      key={`${item.url}:${saved?.at ?? ""}`}
                      item={item}
                      tag={tag}
                      demo={demo}
                      onTag={
                        onTag &&
                        ((next) => {
                          setChosen((previous) => ({
                            ...previous,
                            [item.url]: { tag: next, savedAt: saved?.at },
                          }));
                          onTag(item.url, next);
                        })
                      }
                    />
                  );
                })}
              </ul>
            ) : (
              <p className="forecast-none">{t.noFeedback}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
