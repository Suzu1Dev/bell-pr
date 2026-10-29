import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { maskPath } from "../app/presentation";
import { product } from "../../shared/product";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { appVersion } from "../version";
import { AboutDialog, aboutLinks, aboutSafeHref } from "./AboutDialog";

type Props = Parameters<typeof AboutDialog>[0];

const element = (props: Partial<Props> = {}) =>
  createElement(AboutDialog, {
    onClose() {},
    dataDir: "/home/real-person/.bellpr",
    presenting: false,
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
  assert.match(html, /<code>\/home\/real-person\/\.bellpr<\/code><button type="button" class="button secondary about-copy" aria-label="Copy the data directory&#x27;s path"/);
  assert.match(html, />Copy diagnostics<\/button>/);
  assert.match(html, /community-maintained open-source software, licensed under the Apache License 2\.0 and provided &quot;as is&quot;, without warranty\./);
  assert.match(html, /name and logo are marks of the project and are not covered by that license\./);
  assert.match(html, /is an independent product and is not affiliated with, endorsed by, or sponsored by GitHub, Inc\., OpenAI, or Anthropic PBC\./);
  assert.match(html, /Efficiency mode is based on Ponytail by DietrichGebert \(MIT\)\./);
  assertNoHan(html);
  assert.match(renderZh(element()), /<h2 id="modal-title">關於 BELL PR<\/h2>/);
});

test("About links the license, the notice, the security policy and the third-party licenses", () => {
  const html = renderEn(element());
  assert.match(html, /<h3 id="about-documents">License and notices<\/h3>/);
  for (const [href, name] of [
    ["/legal/LICENSE.txt", "Apache License 2.0"],
    ["/legal/NOTICE.txt", "Notice"],
    ["/THIRD_PARTY_NOTICES.txt", "Third-party licenses"],
    ["/legal/SECURITY.txt", "Security policy"],
  ])
    assert.ok(
      html.includes(`<a href="${href}" target="_blank" rel="noreferrer">${name}`),
      href,
    );
  assert.doesNotMatch(html, /EULA|PRIVACY|TERMS|REFUND|End User License|Refund|Terms of sale/);
  assert.ok(
    renderZh(element()).includes(
      '<a href="/legal/LICENSE.txt" target="_blank" rel="noreferrer">Apache License 2.0',
    ),
  );
  assert.match(renderZh(element()), /授權與聲明/);
});

test("with every product URL and address empty, About offers no help link and no empty href", () => {
  assert.deepEqual(aboutLinks(() => undefined, () => undefined), []);
  assert.doesNotMatch(renderEn(element()), /href=""/);
});

test("with only the public repository decided, About offers the changelog and the issue tracker", () => {
  const html = renderEn(element());
  const repository = product.publicRepoUrl.replace(/\/+$/, "");
  assert.deepEqual(aboutLinks(), [
    { id: "changelog", href: `${repository}/blob/HEAD/CHANGELOG.md` },
    { id: "issue", href: `${repository}/issues` },
  ]);
  assert.ok(html.includes(`href="${repository}/issues"`));
  assert.match(html, /Help and updates/);
  assert.doesNotMatch(html, /Documentation|Report a security issue/);
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

test("presenting masks the data directory, with nothing to copy", () => {
  const html = renderEn(
    element({
      presenting: true,
      maskPath: (value) => maskPath(value, undefined, true),
    }),
  );
  assert.match(html, /<code>…\/\.bellpr<\/code>/);
  assert.doesNotMatch(html, /real-person|\/home\/|about-copy/);
});

test("with securityEmail set, About shows a clickable mailto with the address", () => {
  const html = renderEn(
    element({
      link: () => undefined,
      email: (key) => (key === "securityEmail" ? "security@example.test" : undefined),
    }),
  );
  assert.ok(
    html.includes('href="mailto:security@example.test"'),
    html,
  );
  assert.ok(html.includes("security@example.test"), html);
  assert.match(html, /Report a security issue/);
  assert.doesNotMatch(html, /<span>[^<]*security@example\.test/);
});

test("without publicRepoUrl, the Issue support mailto shows the address", () => {
  const html = renderEn(
    element({
      link: () => undefined,
      email: (key) => (key === "supportEmail" ? "help@example.test" : undefined),
    }),
  );
  assert.deepEqual(aboutLinks(() => undefined, (key) => (key === "supportEmail" ? "help@example.test" : undefined)), [
    { id: "issue", href: "mailto:help@example.test" },
  ]);
  assert.ok(html.includes('href="mailto:help@example.test"'), html);
  assert.ok(html.includes("help@example.test"), html);
  assert.match(html, /Report an issue/);
});

test("aboutSafeHref allows only exact mailto:local@domain values", () => {
  assert.equal(aboutSafeHref("mailto:security@example.test"), "mailto:security@example.test");
  assert.equal(aboutSafeHref("mailto:help@example.test"), "mailto:help@example.test");
  for (const value of [
    "mailto:not-an-email",
    "mailto:spaces @example.test",
    "mailto:user@exam ple.test",
    "mailto:user@",
    "mailto:@example.test",
    "MAILTO:security@example.test",
    " mailto:security@example.test",
    "javascript:alert(1)",
    "https://example.com",
  ]) {
    if (value === "https://example.com") {
      assert.equal(aboutSafeHref(value), "https://example.com/");
      continue;
    }
    assert.equal(aboutSafeHref(value), "", value);
  }
});

test("a malformed mailto from product config is not linked in About", () => {
  const html = renderEn(
    element({
      link: () => undefined,
      email: (key) => (key === "securityEmail" ? "not an address" : undefined),
    }),
  );
  // aboutLinks still builds mailto:not an address; aboutSafeHref rejects it.
  assert.deepEqual(
    aboutLinks(() => undefined, (key) => (key === "securityEmail" ? "not an address" : undefined)),
    [{ id: "security", href: "mailto:not an address" }],
  );
  assert.doesNotMatch(html, /href="mailto:/);
  assert.match(html, /Report a security issue/);
});
