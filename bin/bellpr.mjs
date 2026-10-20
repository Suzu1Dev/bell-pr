#!/usr/bin/env node
// The bell-pr and bellpr commands. Everything up to the version check uses
// syntax that old Node.js versions can parse, so they print the message
// below instead of a syntax error.
var major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(
    "BELL PR needs Node.js 22 or later; this is Node.js " +
      process.versions.node +
      ". Install the current Node.js LTS from https://nodejs.org and try again.",
  );
  process.exit(1);
}
// Stack traces point at the TypeScript sources through build/cli.mjs.map.
process.setSourceMapsEnabled(true);
import("../build/cli.mjs").then(
  function (cli) {
    cli.run(process.argv.slice(2));
  },
  function (error) {
    // A source checkout has no build/ until `npm run build`; the published
    // package always ships it.
    if (error && error.code === "ERR_MODULE_NOT_FOUND" && /build[\\/]cli\.mjs/.test(String(error.message))) {
      console.error(
        "BELL PR is not built yet. In a source checkout, run `npm ci` and `npm run build` first " +
          "(see docs/development.md). The package from npm ships the built program.",
      );
      process.exit(1);
    }
    throw error;
  },
);
