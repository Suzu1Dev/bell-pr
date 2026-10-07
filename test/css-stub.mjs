// Node test loader: components import their stylesheets at module level.
// Vite handles those imports in the app; under node they would fail with
// ERR_UNKNOWN_FILE_EXTENSION, so every *.css import resolves to an empty module.
import { register } from "node:module";

const hooks = `
export function resolve(specifier, context, next) {
  if (specifier.endsWith(".css")) {
    return { url: "css-stub:" + specifier, shortCircuit: true };
  }
  return next(specifier, context);
}
export function load(url, context, next) {
  if (url.startsWith("css-stub:")) {
    return { format: "module", source: "", shortCircuit: true };
  }
  return next(url, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(hooks)}`);
