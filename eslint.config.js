// ESLint flat config: recommended JavaScript and TypeScript rules plus the
// React hooks rules. There is no formatter; match the surrounding style by
// hand.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "dist/",
    "build/",
    "vendor/",
    // The rendered promo video and its poster; the site's own scripts are
    // linted below.
    "site/media/",
    "marketing/",
    "e2e/output/",
    "test-results/",
    "playwright-report/",
    ".vite-cache/",
    "coverage/",
    "node_modules/",
    // Gitignored local output. .bellpr/ is the default data directory and
    // holds clones of other projects.
    ".bellpr/",
    "output/",
    ".playwright-cli/",
  ]),
  {
    files: ["**/*.{ts,tsx,mjs,js}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // `interface Run extends RunCore {}` names a side's own view of a
      // shared type and leaves room for side-only fields.
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "with-single-extends" },
      ],
    },
  },
  {
    // Node: the server, scripts, test helpers, root config files and the
    // command, e2e and tooling folders later work adds.
    files: [
      "server/**",
      "scripts/**",
      "test/**",
      "bin/**",
      "e2e/**",
      "tools/**",
      "*.{ts,mjs,js}",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // The landing site's script runs in the browser; its checker in Node.
    files: ["site/**/*.js"],
    languageOptions: { globals: globals.browser, sourceType: "script" },
  },
  {
    // The checker runs in Node; its page.evaluate() callbacks in Chromium.
    files: ["site/**/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // shared/ runs in both the server and the browser bundle.
    files: ["shared/**"],
    languageOptions: { globals: globals["shared-node-browser"] },
  },
  {
    files: ["src/**"],
    languageOptions: { globals: globals.browser },
    rules: {
      // zod stays out of the UI bundle: the client imports these as types.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^zod(/.*)?$|(^|/)shared/app-settings(\\.js)?$",
              allowTypeImports: true,
              message: "Use `import type`; zod must not enter the UI bundle.",
            },
          ],
        },
      ],
    },
  },
  {
    // UI tests run under node:test and are not bundled.
    files: ["src/**/*.test.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { "@typescript-eslint/no-restricted-imports": "off" },
  },
  {
    // Existing violations; do not mass-fix. These recommended rules already
    // reported errors when lint was introduced, so they only warn. Fix a site
    // when you change that code anyway. Every other recommended rule stays an
    // error and guards new code.
    files: ["**/*.{ts,tsx,mjs,js}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      // A leading underscore marks a value that is unused on purpose, such as
      // a field left out of a rest copy.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "no-control-regex": "warn",
      "no-unexpected-multiline": "warn",
      "prefer-const": "warn",
    },
  },
);
