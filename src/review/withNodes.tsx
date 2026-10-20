import { Fragment, type ReactNode } from "react";

// Private-use code points around a node's index; dictionary text never
// contains them.
const marker = /(\d+)/;

/**
 * Renders a dictionary message with elements inside the sentence, such as a
 * `<code>` path or a `<kbd>` key. The message stays a function of strings, so
 * each locale writes the whole sentence and decides where the elements go:
 * string values are passed through as they are, and every other value is
 * passed as a marker that is then replaced by the value itself.
 */
export function withNodes<K extends string>(
  message: (params: Record<K, string>) => string,
  values: Record<K, ReactNode>,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const params = {} as Record<K, string>;
  for (const key of Object.keys(values) as K[]) {
    const value = values[key];
    if (typeof value === "string") params[key] = value;
    else {
      params[key] = `${nodes.length}`;
      nodes.push(value);
    }
  }
  // Splitting on a pattern with a group keeps the captured indexes at the odd
  // positions, between the text around them.
  return message(params)
    .split(marker)
    .map((part, index) =>
      index % 2 === 0 ? (
        part
      ) : (
        <Fragment key={index}>{nodes[Number(part)]}</Fragment>
      ),
    );
}
