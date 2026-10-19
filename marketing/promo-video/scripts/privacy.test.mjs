import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { allowedPlaceholders, privacyFindings, privacyPattern } from "./lib/privacy.mjs";

const join = (...parts) => parts.join("");

test("clean page text passes", () => {
  assert.deepEqual(privacyFindings("Smart GET retries · openfetch-sample/open-fetch · fix/smart-retry"), []);
});

test("owner identifiers, home and temp paths and e-mail addresses fail, by rule name", () => {
  assert.deepEqual(privacyFindings(`${join("ubuntu", "2604")} was here`), ["owner user name"]);
  assert.deepEqual(privacyFindings(`host.${join("tail", "1efcdf")}.ts.net`), ["owner tailnet name"]);
  assert.deepEqual(privacyFindings(`@${join("Suzu", "1Dev")}`), ["owner handle"]);
  assert.deepEqual(privacyFindings("/home/alice/repo"), ["Linux home path"]);
  assert.deepEqual(privacyFindings("/Users/alice/repo"), ["macOS home path"]);
  assert.deepEqual(privacyFindings("cloned into /tmp/x"), ["temporary path"]);
  assert.deepEqual(privacyFindings("Mail me: someone@example.org"), ["e-mail address"]);
});

test("the rule has no exemption, not even the product's own example path", () => {
  assert.deepEqual(allowedPlaceholders, []);
  assert.deepEqual(privacyFindings("such as /home/you/projects/repository"), ["Linux home path"]);
  assert.ok(privacyPattern.test("/home/you/projects/repository"));
});

test("the rule file never contains the identifiers it looks for", () => {
  const source = readFileSync(new URL("./lib/privacy.mjs", import.meta.url), "utf8");
  for (const identifier of [join("ubuntu", "2604"), join("tail", "1efcdf"), join("suzu", "1dev")])
    assert.ok(!source.toLowerCase().includes(identifier));
});
