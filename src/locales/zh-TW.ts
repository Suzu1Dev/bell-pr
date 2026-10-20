/**
 * What the app loads on demand for zh-TW, as one file: the dictionary
 * (src/i18n) and the sample project's text (src/demo). Both load when zh-TW
 * is about to show, so one request serves both, and the Chinese text of the
 * two compresses together.
 */
export { default as messages } from "../i18n/zh-TW";
export { default as demo } from "../demo/zh-TW";
