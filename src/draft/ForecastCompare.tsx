import type { PrFeedback } from "../../shared/pr-feedback";
import type { FeedbackTag, MaintainerForecast } from "../../shared/understanding";

/**
 * Forecast against reality (DESIGN F11): "Your forecast" beside what the
 * maintainers said (OWNER, MEMBER and COLLABORATOR items only), with a
 * taste dimension and "Saw it coming / Surprised me" per item, and an
 * outcome line that states facts only.
 *
 * L1 stub with the final props; L2F fills it in.
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

export default function ForecastCompare(_props: ForecastCompareProps) {
  return null;
}
