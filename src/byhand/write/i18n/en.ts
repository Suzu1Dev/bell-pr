/**
 * The Learn-by-hand writing views (English; DESIGN v1.2 F3-F6, F9), loaded only with the byhand
 * chunk; zh-TW/index.ts is typed against it. Gate refusals show the server's own message.
 */
import { formatters } from "../../../../shared/i18n/locale";
import { product } from "../../../../shared/product";

const { plural } = formatters("en");
const name = product.name;
const count = (n: number, noun: string) => (plural(n) === "one" ? `1 ${noun}` : `${n} ${noun}s`);

const en = {
  plan: {
    title: "Plan with the guide",
    intro: "Write your own steps first.",
    step: ({ number }: { number: number }) => `Step ${number}`,
    files: "Files (optional, comma-separated)",
    how: "What you'll do here (optional)",
    add: "Add a step",
    remove: "Remove this step",
    tests: "How will you test it?",
    unsure: "What are you unsure about?",
    prediction: 'Before you read: which function would you change, and why? "No idea yet" is a fine answer.',
    readFirst: "Read these first, in your editor",
    outline: "The guide's steps",
    folded: "Folded until you save a step of your own.",
    noIdea: "I don't know where to start",
    names: "Show the guide's step names",
    early: "Shown before your first draft, at your request.",
    closed: "The project's text this run is fitted to doesn't name planning help: the guide's outline stays closed.",
    confirm: "This is my plan",
  },
  questions: {
    title: "Questions on my plan",
    left: ({ left, max }: { left: number; max: number }) => `${left} of ${max} left`,
    reading: "The guide is reading your plan…",
  },
  turn: {
    title: "Your turn",
    open: "Open this folder in your editor, make your first step's change, save, and come back.",
    first: ({ step }: { step: string }) => `First step: ${step}`,
  },
  compare: {
    action: "Compare with the guide's steps",
    title: "Where your plan and the guide's differ",
  },
  guide: {
    title: "The guide",
    clean: `${name}'s agents can't edit files in this run.`,
    // The record's words (src/byhand/record/i18n), so a run says it one way everywhere.
    unclean: ({ reason }: { reason: string }) => `${name} makes no Learn-by-hand claim for this run: ${reason}.`,
    reasons: { "agent-writes": "an agent ran a shell command or changed a file", agents: "agents other than the guide, the reviewer and the test analyst joined it",
      tasks: "it was planned as team tasks", rounds: "an AI follow-up round ran on it", resolutions: "an agent resolved its merge conflicts" } as Record<string, string>,
    fitted: ({ kinds }: { kinds: string }) =>
      `This run is fitted to the project's rules: the guide offers only ${kinds}. Publishing asks you to confirm the project's quoted rule.`,
    blocked: ({ clause }: { clause: string }) => `${name} won't publish this run here: ${clause}. Practise freely.`,
    notOffered: ({ kinds }: { kinds: string }) => `Not offered in this run: the project's text it is fitted to doesn't name ${kinds}.`,
    wrong: "The guide can be wrong. Check its pointers against the code and your tests.",
    steps: "Your steps",
    done: "Done",
    park: "Park",
    why: "Why does your change for this step work?",
    ask: "Ask the guide",
    entries: { tooling: "Setup and tools", project: "This project", concept: "A concept", change: "My change" },
    question: "Your question",
    tried: "What I tried · what I expected · what happened",
    rungs: { 1: "Where to look", 2: "What applies", 3: "Options", 4: "An example in this project" } as Record<number, string>,
    next: ({ rung }: { rung: string }) => `Next hint: ${rung}`,
    tryFirst: "Try something first: change the code, run the tests, or say what you tried.",
    noRung: "No hint left on this step; the exits are below.",
    working: "The guide is answering…", answered: "The guide answered.",
    failed: ({ reason }: { reason: string }) => (reason ? `The guide couldn't answer: ${reason}` : "The guide couldn't answer. Try again."),
    reviewAsk: ({ at, observed }: { at: string; observed: string }) => `About the review's point at ${at}: "${observed}" `,
    aboutReview: "Ask the guide about the review",
  },
  thread: {
    title: "Answers",
    kinds: { ask: "Question", hint: "Hint", test: "A failure explained", plan: "Plan questions", chat: "Question" } as Record<string, string>,
    base: "From the repository",
    change: "From your change",
    removed: `${name} removed code from this answer.`,
    chooseWhy: "Why this option?",
    choose: "Choose",
    chosen: "Chosen by you",
  },
  exits: {
    stuck: "I'm stuck",
    title: "Stuck? Try one of these",
    checks: { tests: "You haven't run the tests since your last edit.", failing: "Read the first failing line of the last run.",
      small: "Is this step small enough for one sitting?" },
    human: "Ask a human",
    humanText: `Ask the project's people. Fill in the note yourself; ${name} writes none of it.`,
    note: "What I'm trying to do:\nWhat I tried:\nWhat I expected:\nWhat happened:\n",
    issue: "The issue",
    smaller: "Make this step smaller",
    openPlan: "Open your plan",
    park: "Park this step",
    leave: "Hand this task to the agent team",
    leaveText: `Your edits stay in this run's folder. The new run starts from the target branch, and ${name}'s agents write it.`,
    leaveGo: "Hand it to the agent team",
  },
  talk: {
    label: "Talk it through",
    trying: "What I'm trying to do",
    expect: "What I expect",
    see: "What I see",
    repeat: "The same failure, three runs in a row. Step back and try one of the exits below.",
  },
  tests: {
    title: "Tests",
    command: "Test command",
    none: "No suggestion; type the command you run in your terminal.",
    use: "Use this command",
    confirmed: ({ command }: { command: string }) => `Confirmed: ${command}`,
    edited: `${name} runs only the command you confirmed: choose Use this command first.`,
    honesty: `${name} runs the command you confirmed in the run's folder, as you, without ${name}'s or the AI providers' keys in its environment. Your tests can still read files in your home folder: read the command before you run it.`,
    predict: "Your prediction",
    predictions: { pass: "Pass", fail: "Fail", unsure: "Not sure" } as Record<string, string>,
    expect: "Which test do you expect to fail? (optional)",
    run: "Run the tests",
    running: "Running your tests…",
    stop: "Stop",
    outcomes: { passed: "passed", failed: "failed", timeout: "timed out", stopped: "was stopped", error: "did not finish" } as Record<string, string>,
    result: ({ predicted, outcome }: { predicted?: string; outcome: string }) =>
      predicted ? `You predicted ${predicted}; it ${outcome}.` : `It ${outcome}.`,
    reported: "reported by you",
    newFiles: ({ n, list }: { n: number; list: string }) => `${name} sees ${count(n, "new file")} your tests wrote: ${list}`,
    output: "Output",
    explain: "Explain this failure",
    error: `${name} stopped them for too much output, or the command could not start; the run log in Agent activity says which.`,
  },
  live: {
    tail: "Output so far",
    record: "Record my result",
    recordText: "For a run in your own terminal; it's marked as reported by you.",
    passed: "It passed",
    failed: "It failed",
    output: "The end of its output (optional)",
  },
  ready: {
    title: "Ready for review",
    facts: ({ n, additions, deletions }: { n: number; additions: number; deletions: number }) =>
      `${count(n, "file")} changed, +${additions} −${deletions}.`,
    tested: ({ outcome, when, predicted }: { outcome: string; when: string; predicted?: string }) =>
      `Your tests ${outcome} ${when}${predicted ? `; you predicted ${predicted}` : ""}.`,
    untested: "Not run since your last edit. It isn't required; the tests are the judge.",
    leastSure: "What are you least sure about? (optional)",
    review: "Ask the guide to review it",
    reviewText: "The guide reads your change and your last test run and points out up to three problems with evidence. It never writes the fix.",
    testFirst: "Run your tests on this version first; the tests are the judge.",
    aiRules: "This project has rules about AI use. Check them before asking for an AI review.",
    noReview: "The project's text this run is fitted to doesn't name AI review, so the guide doesn't review here; your tests are the judge.",
    cost: "The review takes about 2 agent turns.",
    quiet: "Your change isn't explained or reviewed until you say it's ready.",
    confirm: "Mark it ready",
  },
};

export default en;
