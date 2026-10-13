/**
 * The app version from package.json. Vite replaces `__APP_VERSION__` at build
 * time; under node tests (tsx) nothing defines it, so the fallback applies.
 */
export const appVersion =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";
