// Run and file status labels live in the `common` dictionary
// (t.common.runStatus and t.common.fileStatus).
import type { Messages } from "../i18n";

type FileStatusLabels = Messages["common"]["fileStatus"];

/**
 * The badge and tooltip of a diff file's status. The status is a plain
 * string from Git, so an unknown one reads as modified.
 */
export function fileStatusLabel(labels: FileStatusLabels, status: string) {
  return Object.hasOwn(labels, status)
    ? labels[status as keyof FileStatusLabels]
    : labels.modified;
}
