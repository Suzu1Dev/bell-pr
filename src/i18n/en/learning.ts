/** The learning notes page: explanations kept from every review (English). */
import { formatters } from "../../../shared/i18n/locale";

const fmt = formatters("en");

const learning = {
  eyebrow: "LEARN BY CONTRIBUTING",
  title: "Turn the code you understood into experience.",
  intro:
    "Every explanation generated while you review a contribution stays here, so you can revisit a concept across contributions.",
  keyword: "Keyword",
  keywordPlaceholder: "Search concepts, tips, files or contributions",
  run: "Contribution",
  allRuns: "All contributions",
  /** How many of the person's own notes the filters show. */
  noteCount: ({ visible, total }: { visible: number; total: number }) =>
    `Showing ${fmt.number(visible)} of ${fmt.number(total)} ${fmt.plural(total) === "one" ? "note" : "notes"}`,
  noRealNotes: "No notes from your own contributions yet",
  emptyTitle: "You have no learning notes yet",
  emptyBody:
    "Import a repository on the Repositories page and start a contribution. Once it reaches review, the explanation of each file is collected here automatically.",
  noMatches: "No notes match the filters.",
  demoTitle: "Sample notes",
  /** Marks a note or section that comes from the built-in sample. */
  demoTag: "Sample",
  demoIntro:
    "Explanations from the built-in sample contribution, so you can preview what your own notes will look like.",
  tip: "Tip",
  noteRun: "Contribution",
  generatedAt: "Generated",
  sampleContent: "Sample content",
  notRecorded: "Not recorded",
  openInCode: "Study it in the code",
};

export default learning;
