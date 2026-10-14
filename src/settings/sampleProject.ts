/**
 * The sample project's progress kept in this browser: the demo run (review
 * progress, draft, notes) and its direction settings, one copy per locale
 * (see src/app/hooks/demoStorage.ts).
 */
const samplePrefixes = ["bellpr-demo-run:", "bellpr-demo-settings:"];

/**
 * Removes every locale's copy of the sample project's progress from
 * `storage`. Returns false when the browser does not allow it (storage
 * blocked or unavailable); nothing is thrown.
 */
export function clearSampleProgress(
  given?: Pick<Storage, "length" | "key" | "removeItem">,
): boolean {
  try {
    // Reading localStorage itself throws where the browser blocks it.
    const storage = given ?? globalThis.localStorage;
    if (!storage) return false;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key && samplePrefixes.some((prefix) => key.startsWith(prefix)))
        keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
