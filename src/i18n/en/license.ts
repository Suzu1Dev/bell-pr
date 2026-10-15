/** Plans, the license, the trial and upgrading to Pro. */
import { formatters } from "../../../shared/i18n/locale";
import plans from "../../../shared/i18n/plans.en";
import type { ProFeature } from "../../../shared/plans";
import { product } from "../../../shared/product";

const fmt = formatters("en");
const days = (n: number) =>
  `${fmt.number(n)} ${fmt.plural(n) === "one" ? "day" : "days"}`;

export default {
  /** The Free/Pro table copy (shared with the site and the READMEs). */
  plans,
  /** The chip on a Pro-only control. */
  badge: { text: "PRO", label: "Pro feature" },
  /** The plan chip: short marks and what they mean for screen readers. */
  chip: {
    free: "FREE",
    pro: "PRO",
    trial: ({ days }: { days: number }) => `TRIAL · ${days}d`,
    beta: "BETA",
  },
  chipLabel: {
    free: "Free plan",
    pro: "Pro plan",
    trial: ({ days: left }: { days: number }) =>
      `Pro trial, ${days(left)} left`,
    beta: "Beta build",
  },
  upgrade: {
    title: "Upgrade to Pro",
    /** When the dialog opens for a feature without a message from the server. */
    featureNeedsPro: {
      teamSize: "Teams of 3 or 4 teammates need a Pro license.",
      parallelRuns:
        "Running more than one contribution at a time needs a Pro license.",
      discovery:
        "Finding projects to contribute to across GitHub needs a Pro license.",
      moreRecommendations: "Generating more recommendations needs a Pro license.",
      learningExport: "Exporting the learning record needs a Pro license.",
      prFeedback:
        "AI follow-up rounds on maintainer feedback need a Pro license.",
      webAccess: "Web access for agents needs a Pro license.",
      deepReasoning:
        "The xhigh, max and ultra reasoning efforts need a Pro license.",
      coachDebrief: "The coach debrief needs a Pro license.",
    } satisfies Record<ProFeature, string>,
    /** What Pro allows on the rows that Free has with a smaller limit. */
    proLimits: {
      teamSize: "Pro: 3 or 4 teammates",
      parallelRuns: "Pro: up to 8 runs at once",
    } satisfies Partial<Record<ProFeature, string>>,
    general: "Pro goes deeper: a coach debrief, the complete learning record, AI follow-up rounds, bigger teams and discovery.",
    proList: "What Pro adds",
    thisFeature: "The feature you tried",
    startTrial: "Start 14-day trial",
    trialHint:
      "The trial is free and starts only when you choose. Each data directory gets one.",
    enterKey: "Enter license key",
    buy: "Buy Pro",
    purchasingSoon: "Purchasing opens soon.",
    seePricing: "See pricing",
    useFreeSettings: "Use Free settings",
    freeSettingsHint:
      "Turns web access off and changes an xhigh, max or ultra effort to Default.",
    freeSettingsApplied:
      "Free settings saved. Try again; nothing else changed.",
    trialStarted: ({ days: left }: { days: number }) =>
      `Your Pro trial has started, with ${days(left)} left. Try again.`,
    activated: "Pro is active. Try again.",
    notNow: "Not now",
    close: "Close",
    envLocked:
      "The license key is set with the BELLPR_LICENSE_KEY environment variable, so it can only be changed there.",
  },
  key: {
    label: "License key",
    placeholder: "BELLPR1.…",
    help: "Paste the whole key from your purchase e-mail. Line breaks do not matter.",
    activate: "Activate",
    activating: "Activating…",
  },
  card: {
    title: "Your plan",
    checking: "Checking the license…",
    /** One line about the plan in effect. */
    status: {
      pro: "Pro is active.",
      grace: ({ date }: { date: string }) =>
        `The license has expired; Pro stays on until ${date}. Renew it to keep Pro.`,
      trial: ({ days: left }: { days: number }) =>
        `Pro trial: ${days(left)} left.`,
    },
    /** Why the plan is Free. */
    reasons: {
      no_license: "Free plan. No license key is active.",
      expired: "Free plan. The license key has expired.",
      trial_ended: "Free plan. Your 14-day Pro trial has ended.",
      updates_expired: `Free plan. The license key does not cover this build of ${product.name}: use an earlier build, or renew the license.`,
      invalid: "Free plan. The license key is not valid for this build.",
    },
    licenseId: "License ID",
    licensee: "Licensed to",
    expires: "Expires",
    never: "Never",
    updatesUntil: "Updates until",
    updatesHint: "Builds released until this date accept the key.",
    setByEnvironment: "Set by environment",
    envHint: `The key comes from the BELLPR_LICENSE_KEY environment variable. Change it there, then restart ${product.name}.`,
    remove: "Remove license key",
    removeConfirm:
      "Remove the key from this data directory? You can enter it again later.",
    removeYes: "Remove",
    cancel: "Cancel",
    startTrial: "Start 14-day trial",
    buy: "Buy Pro",
  },
};
