/**
 * The sample in every locale at once, for code that reads it outside the
 * app, such as the tests (test/css-stub.mjs imports this module) and the
 * e2e specs. The app loads a locale's text only when it shows that locale
 * (src/locales).
 */
import { registerDemo } from "./index";
import zhTW from "./zh-TW";

registerDemo("zh-TW", zhTW);

export * from "./index";
