import test from "node:test";
import assert from "node:assert/strict";
import {
  eulaVersion,
  product,
  productEmail,
  productLink,
  type ProductLinkKey,
} from "./product.js";

const linkKeys: ProductLinkKey[] = [
  "homepageUrl",
  "docsUrl",
  "pricingUrl",
  "purchaseUrl",
  "publicRepoUrl",
];
const emailKeys = ["supportEmail", "securityEmail"] as const;

test("the product is BELL PR, installed as bell-pr with two commands", () => {
  assert.equal(product.name, "BELL PR");
  assert.equal(product.npmPackage, "bell-pr");
  assert.deepEqual([...product.binNames], ["bell-pr", "bellpr"]);
});

test("every URL and email is a string, and undecided ones stay empty", () => {
  for (const key of [...linkKeys, ...emailKeys]) {
    assert.equal(typeof product[key], "string", key);
    // Nothing is invented: values stay "" until the owner decides them.
    // Update this expectation together with the value when that happens.
    assert.equal(product[key], "", key);
  }
});

test("productLink and productEmail return undefined for empty values", () => {
  for (const key of linkKeys) assert.equal(productLink(key), undefined, key);
  for (const key of emailKeys) assert.equal(productEmail(key), undefined, key);
});

test("productLink and productEmail return a value once it is set", () => {
  const saved = { ...product };
  try {
    product.purchaseUrl = "https://shop.example.test/bell-pr";
    product.supportEmail = "support@example.test";
    assert.equal(productLink("purchaseUrl"), "https://shop.example.test/bell-pr");
    assert.equal(productEmail("supportEmail"), "support@example.test");
  } finally {
    Object.assign(product, saved);
  }
  assert.equal(productLink("purchaseUrl"), undefined);
});

test("the EULA version is a non-empty string", () => {
  assert.equal(typeof eulaVersion, "string");
  assert.ok(eulaVersion.trim().length > 0);
});
