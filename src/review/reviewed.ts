import type { DiffFile, Run } from "../types";

/** A path's old tick does not review a new patch or another round's patch. */
export function isFileReviewed(run: Run, file: DiffFile, demo = false) {
  if (demo && !file.fingerprint) return run.reviewedFiles.includes(file.path);
  return !!file.fingerprint && run.reviewedFingerprints?.[file.path] === file.fingerprint;
}
