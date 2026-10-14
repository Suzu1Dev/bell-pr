/**
 * The last move of an unpublished run onto a newer commit of its target
 * branch. The contribution stays uncommitted on top of the new base, as
 * every unpublished run does, so the person reviews it before publishing.
 */
export interface BaseSync {
  at: string;
  /** The base before the sync and the target-branch commit it moved to. */
  from: string;
  to: string;
  /** A local commit of the checkout before the sync, so it can be undone. */
  snapshot: string;
  /** Files the merge could not combine; they hold conflict markers until resolved. */
  conflicts: string[];
  /** The conflicts still holding markers when the diff was last read. */
  unresolved?: string[];
  /** Review marks before the sync, restored on undo where the file is unchanged. */
  reviewedFingerprints?: Record<string, string>;
  /** How the agent resolved the conflicts, in Traditional Chinese. */
  report?: string;
  /** Per-file resolutions the agent described. */
  resolutions?: { path: string; resolution: string }[];
  /** True while an agent resolves the conflicts; a restart clears it. */
  resolving?: boolean;
}
