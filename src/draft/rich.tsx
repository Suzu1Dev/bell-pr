import {
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

// Private-use characters mark where an element goes; dictionary text never
// contains them.
const slot = (index: number) => `${index}`;
const slots = /(\d+)/;

/**
 * Renders a dictionary message with React elements in some of its
 * parameters, such as a `<code>` branch name or a link inside a translated
 * sentence. The message stays one whole sentence that each locale orders
 * freely. String and number parameters are passed through unchanged; an
 * element whose parameter a translation leaves out is not shown.
 */
export function rich<P extends object>(
  message: (params: P) => string,
  params: { [K in keyof P]: P[K] | ReactElement },
): ReactNode {
  const elements: ReactElement[] = [];
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (isValidElement(value)) {
      values[key] = slot(elements.length);
      elements.push(value);
    } else values[key] = value;
  }
  return message(values as P)
    .split(slots)
    .map((part, index) =>
      index % 2 ? (
        <Fragment key={index}>{elements[Number(part)]}</Fragment>
      ) : (
        part
      ),
    );
}
