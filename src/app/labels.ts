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

/**
 * Up to two capital letters for an avatar: the first letters of the first
 * two words of a login such as `octo-cat` ("OC"), or the first letter of a
 * single word ("O" for `octocat`). Empty when the name has no letter or digit.
 */
export function initialsOf(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toLocaleUpperCase();
}
