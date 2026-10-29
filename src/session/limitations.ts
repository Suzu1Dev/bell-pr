import { getCurrentMessages } from "../i18n";
import { sessionInputLimit } from "../../shared/session";

/** The composer text that hands a draft's limitations to the agent, kept within one message. */
export function limitationsRequest(section: string, requestIntro = getCurrentMessages().session.limitationsIntro): string {
  const room = sessionInputLimit - requestIntro.length;
  const text = section.length > room ? `${section.slice(0, room - 1)}…` : section;
  return `${requestIntro}${text}`;
}
