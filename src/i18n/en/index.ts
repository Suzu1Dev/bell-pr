/**
 * Every client namespace (English). The English dictionary defines the
 * message types; zh-TW is checked against it. Each namespace is registered
 * once, in core.ts (the startup chunk's) or deferred.ts (loaded with the
 * first lazily loaded view that needs it), so later work only fills the
 * namespace files.
 */
import core from "./core";
import deferred from "./deferred";

const messages = { ...core, ...deferred };

export default messages;
