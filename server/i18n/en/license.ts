/** License, trial and Pro gating messages. */
import { formatters } from "../../../shared/i18n/locale.js";
import type { ProFeature } from "../../../shared/plans.js";
import { product } from "../../../shared/product.js";

const name = product.name;
const bin = product.binNames[0];
const fmt = formatters("en");
const days = (n: number) =>
  `${fmt.number(n)} ${fmt.plural(n) === "one" ? "day" : "days"}`;

export default {
  /** A Pro feature was used on a plan without it (402 pro_required). */
  featureNeedsPro: {
    teamSize: "Teams of 3 or 4 teammates need a Pro license.",
    parallelRuns:
      "Running more than one contribution at a time needs a Pro license.",
    discovery: "Finding projects to contribute to across GitHub needs a Pro license.",
    moreRecommendations: "Generating more recommendations needs a Pro license.",
    learningExport: "Exporting the learning record needs a Pro license.",
    prFeedback:
      "Maintainer feedback coaching and follow-up rounds need a Pro license.",
    webAccess:
      "Web access for agents needs a Pro license. Turn web access off to continue on Free.",
    deepReasoning:
      'The xhigh, max and ultra reasoning efforts need a Pro license. Choose another effort, or "Default", to continue on Free.',
  } satisfies Record<ProFeature, string>,
  /** A key that cannot unlock Pro (400 license_invalid), by what is wrong. */
  invalidKey: {
    malformed: `This is not a ${name} license key. Paste the whole key, starting with BELLPR1.`,
    badSignature:
      "This license key is not valid. Check that you pasted all of it, unchanged.",
    unknownKid: `This build of ${name} cannot check this license key. Update ${name} to the latest version.`,
    revoked: "This license key has been revoked.",
    expired: ({ date }: { date: string }) =>
      `This license key expired on ${date}.`,
    updatesExpired: ({ until, build }: { until: string; build: string }) =>
      `This license key covers ${name} builds released until ${until}, and this build is from ${build}. Use an earlier build, or renew the license.`,
  },
  /** Activate or remove while BELLPR_LICENSE_KEY is set (409 license_env_locked). */
  envLocked: `The license key is set with the BELLPR_LICENSE_KEY environment variable. Change or remove it there, then restart ${name}.`,
  /** The embedding code fixed the plan, so it cannot change (409 license_env_locked). */
  fixedPlan: `This ${name} was started with a fixed plan, so its license cannot be changed here.`,
  /** 409 trial_unavailable. */
  trialUsed: "This data directory has already used its 14-day Pro trial.",
  trialNotNeeded: "A Pro license is active, so there is no trial to start.",
  /** Plan names in sentences. */
  planNames: { free: "Free", trial: "Pro trial", pro: "Pro" },
  /** The line `bell-pr start` prints about the plan. */
  startup: {
    /** `reason` is one of cli.reasons, when there is more to say than "no key". */
    free: ({ reason, trial }: { reason?: string; trial: boolean }) =>
      [
        "Plan: Free.",
        reason,
        trial
          ? `Start the 14-day Pro trial in Settings or with \`${bin} license trial\`.`
          : undefined,
      ]
        .filter(Boolean)
        .join(" "),
    trial: ({ daysLeft }: { daysLeft: number }) =>
      `Plan: Pro trial, ${days(daysLeft)} left.`,
    pro: ({ licenseId }: { licenseId?: string }) =>
      licenseId ? `Plan: Pro (license ${licenseId}).` : "Plan: Pro.",
  },
  /** `bell-pr license`. */
  cli: {
    usage: `Usage: ${bin} license [status [--json] | activate <key> | deactivate | trial]. Pass - instead of the key to read it from standard input.`,
    unknownSubcommand: ({ command }: { command: string }) =>
      `Unknown license command "${command}".`,
    missingKey: `Give the license key: ${bin} license activate <key>, or ${bin} license activate - to read it from standard input.`,
    plan: ({ plan }: { plan: string }) => `Plan: ${plan}`,
    trialLeft: ({ daysLeft }: { daysLeft: number }) =>
      `Trial: ${days(daysLeft)} left`,
    licenseId: ({ id }: { id: string }) => `License: ${id}`,
    licensee: ({ who }: { who: string }) => `Licensed to: ${who}`,
    expires: ({ date }: { date: string }) => `Expires: ${date}`,
    expiresNever: "Expires: never",
    grace: ({ date }: { date: string }) =>
      `The license has expired; Pro stays on until ${date}. Renew it before then.`,
    updatesUntil: ({ date }: { date: string }) =>
      `Updates: builds released until ${date}`,
    source: {
      env: "Key from: the BELLPR_LICENSE_KEY environment variable",
      file: "Key from: license.json in the data directory",
    },
    envLocked:
      "The key is set with BELLPR_LICENSE_KEY, so it can only be changed there.",
    /** Why the plan is Free. */
    reasons: {
      no_license: "No license key is active.",
      expired: "The license key has expired.",
      trial_ended: "The 14-day Pro trial has ended.",
      updates_expired: `The license key does not cover this build of ${name}.`,
      invalid: "The license key is not valid.",
    },
    /** What to do next, each followed by its command. */
    fixes: {
      trial: "Start the 14-day Pro trial",
      activate: "Activate a license key",
    },
    activated: "License activated.",
    deactivated: "License key removed.",
    nothingToRemove: "No license key is saved in this data directory.",
    trialStarted: "Pro trial started.",
    running: `A running ${name} that uses this data directory picks up the change within a few seconds.`,
  },
};
