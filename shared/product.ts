/**
 * Product identity: the one place that names the product, its npm package,
 * its commands and its public links.
 *
 * Values the owner has not decided yet stay "" (an empty string). Every
 * consumer (UI, CLI, site, docs, package metadata) must hide the link or
 * degrade gracefully while a value is empty; read links through
 * `productLink` and `productEmail`, which return undefined for "". Never
 * invent a domain, URL or email address here or anywhere else.
 */

export interface ProductInfo {
  /** Display name; never translated. */
  name: string;
  npmPackage: string;
  /** Commands the package installs. */
  binNames: readonly string[];
  homepageUrl: string;
  docsUrl: string;
  pricingUrl: string;
  /** Where to buy a Pro license. */
  purchaseUrl: string;
  supportEmail: string;
  /** Where to report security issues privately. */
  securityEmail: string;
  /** The public source or issue-tracker repository. */
  publicRepoUrl: string;
}

export const product: ProductInfo = {
  name: "BELL PR",
  npmPackage: "bell-pr",
  binNames: ["bell-pr", "bellpr"],
  homepageUrl: "",
  docsUrl: "",
  pricingUrl: "",
  purchaseUrl: "",
  supportEmail: "",
  securityEmail: "",
  publicRepoUrl: "",
};

export type ProductLinkKey =
  | "homepageUrl"
  | "docsUrl"
  | "pricingUrl"
  | "purchaseUrl"
  | "publicRepoUrl";

/** The URL, or undefined while it is undecided; hide the link then. */
export function productLink(key: ProductLinkKey): string | undefined {
  return product[key] || undefined;
}

/** The address, or undefined while it is undecided; hide the contact then. */
export function productEmail(
  key: "supportEmail" | "securityEmail",
): string | undefined {
  return product[key] || undefined;
}

/**
 * Version of the license terms (EULA) in LICENSE.md, which carries the same
 * string. Accepting the terms records it as `eulaAcceptedVersion` in the app
 * settings; a new version asks again. Bump it whenever the terms change.
 */
export const eulaVersion = "draft-1";
