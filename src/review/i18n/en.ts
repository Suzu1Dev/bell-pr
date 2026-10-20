/**
 * The review panel's v1.2 strings (English): "How a reader sees your
 * change" and the walkthrough's answer-first card. Module-local, so they
 * load with the panel's lazy chunk and not at startup; the zh-TW twin in
 * ./zh-TW is typed against this one.
 */
const messages = {
  reader: {
    title: "How a reader sees your change",
    intro:
      "An AI-written explanation and walkthrough of your change to this file, to compare with what you meant. It takes up to two agent turns.",
    show: "Show how a reader sees it",
    answerFirst:
      "Answer this file's question in Explain it back first, so your own answer comes before the AI's reading.",
    answerAll:
      "This file has no question of its own: answer the questions in Explain it back first.",
  },
  /** The title of a walkthrough unit's answer-first card (try first, D1). */
  checkYourself: "Check yourself",
};

export default messages;
