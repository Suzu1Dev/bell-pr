import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { LicenseSummary } from "../../shared/plans";
import { maskPath, maskUser } from "../app/presentation";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { appVersion } from "../version";
import { AboutDialog, aboutLinks } from "./AboutDialog";

type Props = Parameters<typeof AboutDialog>[0];

const pro: LicenseSummary = {
  plan: "pro",
  source: "file",
  status: "active",
  name: "Real Person",
  email: "real-person@example.com",
};

const element = (props: Partial<Props> = {}) =>
  createElement(AboutDialog, {
    onClose() {},
    license: pro,
    dataDir: "/home/real-person/.bellpr",
    presenting: false,
    maskUser: (value) => value,
    maskPath: (value) => value,
    serverVersion: appVersion,
    ...props,
  });

test("About reads in English with no Chinese left", () => {
  const html = renderEn(element());
  assert.match(html, /<h2 id="modal-title">About BELL PR<\/h2>/);
  assert.match(html, /<div class="modal-mark"><svg[^>]*aria-hidden="true"/);
  assert.ok(html.includes(`<dt>App version</dt><dd><code>${appVersion}</code></dd>`));
  assert.ok(html.includes(`<dt>Server version</dt><dd><code>${appVersion}</code></dd>`));
  assert.match(html, /plan-chip-pro/);
  assert.match(html, /<span>Licensed to Real Person<\/span>/);
  assert.match(html, /<code>\/home\/real-person\/\.bellpr<\/code><button type="button" class="button secondary about-copy" aria-label="Copy the data directory&#x27;s path"/);
  assert.match(html, />Copy diagnostics<\/button>/);
  assert.match(html, /is an independent product and is not affiliated with, endorsed by, or sponsored by GitHub, Inc\., OpenAI, or Anthropic PBC\./);
  assert.match(html, /Efficiency mode is based on Ponytail by DietrichGebert \(MIT\)\./);
  assertNoHan(html);
  assert.match(renderZh(element()), /<h2 id="modal-title">關於 BELL PR<\/h2>/);
});

test("About links the local legal documents and the third-party licenses", () => {
  const html = renderEn(element());
  for (const [href, name] of [
    ["/legal/EULA.txt", "End User License Agreement"],
    ["/legal/PRIVACY.txt", "Privacy policy"],
    ["/legal/TERMS.txt", "Terms of sale and responsible use"],
    ["/legal/SECURITY.txt", "Security policy"],
    ["/THIRD_PARTY_NOTICES.txt", "Third-party licenses"],
  ])
    assert.ok(
      html.includes(`<a href="${href}" target="_blank" rel="noreferrer">${name}`),
      href,
    );
});

test("with every product URL and address empty, About offers no help link and no empty href", () => {
  const html = renderEn(element());
  assert.deepEqual(aboutLinks(), []);
  assert.doesNotMatch(html, /Help and updates|Documentation|Changelog|Report an issue|Report a security issue/);
  assert.doesNotMatch(html, /href=""/);
});

test("the help links come from the product values, each hidden while empty", () => {
  const links = (values: Record<string, string>) =>
    aboutLinks(
      (key) => values[key] || undefined,
      (key) => values[key] || undefined,
    );
  assert.deepEqual(
    links({
      docsUrl: "https://docs.example.test",
      publicRepoUrl: "https://code.example.test/bell-pr/",
      securityEmail: "security@example.test",
      supportEmail: "help@example.test",
    }),
    [
      { id: "docs", href: "https://docs.example.test" },
      { id: "changelog", href: "https://code.example.test/bell-pr/blob/HEAD/CHANGELOG.md" },
      { id: "security", href: "mailto:security@example.test" },
      { id: "issue", href: "https://code.example.test/bell-pr/issues" },
    ],
  );
  // Without a public repository an issue goes to the support address.
  assert.deepEqual(links({ supportEmail: "help@example.test" }), [
    { id: "issue", href: "mailto:help@example.test" },
  ]);
  assert.deepEqual(links({}), []);
});

test("a server of another version gets a warning", () => {
  const html = renderEn(element({ serverVersion: "9.9.9" }));
  assert.match(html, /<p class="about-warning" role="alert">/);
  assert.ok(html.includes(`This page is version ${appVersion}, but the server runs version 9.9.9.`));
  assert.doesNotMatch(renderEn(element()), /about-warning/);
  assert.match(renderEn(element({ serverVersion: undefined })), /<dt>Server version<\/dt><dd>Checking…<\/dd>/);
});

test("presenting masks the licensee and the data directory, with nothing to copy", () => {
  const html = renderEn(
    element({
      presenting: true,
      maskUser: (value) => maskUser(value, true, "you"),
      maskPath: (value) => maskPath(value, undefined, true),
    }),
  );
  assert.match(html, /<span>Licensed to you<\/span>/);
  assert.match(html, /<code>…\/\.bellpr<\/code>/);
  assert.doesNotMatch(html, /real-person|Real Person|\/home\/|about-copy/);
});
