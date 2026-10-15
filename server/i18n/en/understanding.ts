/**
 * The Explain-it-back check (server/understanding.ts) and its routes. The
 * questions are saved with the run, in the run's language.
 */
const understanding = {
  /** The setting's name in "comes from the … environment variable" messages. */
  settingName: "Ask me to explain each change back before approval",
  /** The question for a file without a ready explanation. */
  fallbackQuestion: ({ path }: { path: string }) =>
    `In one sentence, what does the change to ${path} do, and why?`,
  untestedQuestion: "What did you not test, and why?",
  notOpen:
    "The understanding check can be taken while the run waits for your review or approval, not while it runs or publishes.",
  changed:
    "The changes moved since you opened the check. Reload it to see the questions for the latest version.",
  unknownQuestion:
    "One of the answers is not for a question of the current check. Reload the check and answer again.",
  alreadyLocked:
    "Your answers are already locked. Start the check over to answer again.",
  answerAll: "Answer every question before you lock your answers.",
  summaryRequired: "Explain the change in your own words first.",
  summaryLocked:
    "Your explanation is already saved. Confirm it, or edit it, instead.",
  summaryShort: ({ min }: { min: number }) =>
    `Explain the change in at least ${min} words: what problem it solves, what it does and what could break.`,
  summaryCopied:
    "Your explanation repeats an AI-written explanation word for word. Write it in your own words.",
  answerShort: ({ min }: { min: number }) =>
    `Each answer needs at least ${min} words, or "I don't know".`,
  answerCopied:
    "An answer repeats the AI-written reference word for word. Write it in your own words.",
  dontKnow: '"I don\'t know" leaves the answer empty and goes with the confidence Guessing.',
  notAnswered: "Lock your answers before you grade them.",
  notGradable: "The not-tested question is not graded.",
  dontKnowMissed: 'An "I don\'t know" answer counts as Missed.',
  correctionShort: ({ min }: { min: number }) =>
    `Write what you had wrong in at least ${min} words.`,
  alreadyPassed:
    "You already explained this version of the change back. Start the check over to change your answers.",
  noSummary:
    "There is no explanation to confirm yet. Lock your answers first.",
  attemptLocked:
    "This attempt is already graded or skipped, and it stays as you answered it.",
  attemptSkipped: "A skipped attempt has no answer.",
  attemptEmpty: "Send a quiz answer or a road choice.",
  /** A learning-loop feature this build does not have yet. */
  notImplemented: "This part of BELL PR is not available in this build yet.",
  feedbackTagUnpublished:
    "Maintainer feedback can be tagged once the pull request is sent and its feedback is read.",
  feedbackTagEmpty:
    "Send a taste dimension, Saw it coming or Surprised me, or a lesson.",
  feedbackTagUnknown:
    "This comment is not in the latest feedback read. Read the feedback again, then tag it.",
  practiceKeyUnknown:
    "This practice item is no longer part of this run. Reload the practice deck.",
  /** A practice question about a maintainer comment on a file that surprised the person. */
  practiceFeedbackFileQuestion: ({ path, title }: { path: string; title: string }) =>
    `A maintainer commented on ${path} in "${title}". What did they ask for, and what will you do differently next time?`,
  /** A practice question about a maintainer comment on the whole pull request. */
  practiceFeedbackQuestion: ({ title }: { title: string }) =>
    `A maintainer commented on "${title}". What did they ask for, and what will you do differently next time?`,
  /** A coach debrief drill as a practice question: the two versions, then the question. */
  practiceDrillQuestion: ({
    context,
    optionA,
    optionB,
    question,
  }: {
    context: string;
    optionA: string;
    optionB: string;
    question: string;
  }) => `${context}\n\nA: ${optionA}\n\nB: ${optionB}\n\n${question}`,
};

export default understanding;
