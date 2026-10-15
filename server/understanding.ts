/**
 * The Explain-it-back check on the server: whether it is required, and
 * (from the gate on) the authority that approve() and publish() ask.
 */

let skipSource: (() => boolean | undefined) | undefined;
let testOverride: boolean | undefined;

/**
 * Sets where the "turn the understanding check off" choice comes from,
 * such as the app settings (activateAppSettings). Without a source, or
 * when it returns anything but true or throws, the check is required.
 * Call it without an argument to remove the source.
 */
export function setSkipUnderstandingCheckSource(fn?: () => boolean | undefined) {
  skipSource = fn;
}

/**
 * For tests of other behaviour only: true skips the check, false requires
 * it, no argument removes the override. It is read before the source, so
 * a Workbench created in the test (which activates its app settings) does
 * not undo it. No environment variable, setting or route reaches it, so
 * nothing in the product can turn the check off this way.
 */
export function skipUnderstandingCheckInTests(skip?: boolean) {
  testOverride = skip;
}

/** True unless the person turned the check off. */
export function understandingRequired() {
  if (testOverride !== undefined) return !testOverride;
  try {
    return skipSource?.() !== true;
  } catch {
    return true;
  }
}
