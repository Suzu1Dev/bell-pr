import test from "node:test";
import assert from "node:assert/strict";
import {
  product,
  productEmail,
  productLink,
  type ProductLinkKey,
} from "./product.js";

const linkKeys: ProductLinkKey[] = [
  "homepageUrl",
  "docsUrl",
  "publicRepoUrl",
];
const emailKeys = ["supportEmail", "securityEmail"] as const;

test("the product is BELL PR, installed as bell-pr with two commands", () => {
  assert.equal(product.name, "BELL PR");
  assert.equal(product.npmPackage, "bell-pr");
  assert.deepEqual([...product.binNames], ["bell-pr", "bellpr"]);
});

test("every URL and email is a string, the repository is decided and the rest stay empty", () => {
  for (const key of [...linkKeys, ...emailKeys]) {
    assert.equal(typeof product[key], "string", key);
    // Nothing is invented: a value stays "" until the project decides it.
    // Update this expectation together with the value when that happens.
    if (key === "publicRepoUrl") assert.equal(product[key], "https://github.com/Suzu1Dev/bell-pr", key);
    else assert.equal(product[key], "", key);
  }
});

test("productLink and productEmail return undefined for empty values and the value once decided", () => {
  for (const key of linkKeys)
    assert.equal(productLink(key), key === "publicRepoUrl" ? product.publicRepoUrl : undefined, key);
  for (const key of emailKeys) assert.equal(productEmail(key), undefined, key);
});

test("productLink and productEmail return a value once it is set", () => {
  const saved = { ...product };
  try {
    product.homepageUrl = "https://example.test/bell-pr";
    product.supportEmail = "support@example.test";
    assert.equal(productLink("homepageUrl"), "https://example.test/bell-pr");
    assert.equal(productEmail("supportEmail"), "support@example.test");
  } finally {
    Object.assign(product, saved);
  }
  assert.equal(productLink("homepageUrl"), undefined);
});
