/**
 * A one-sentence note with its `code` spans shown as code, the way the
 * cards' Markdown shows them; phrasing content, so it fits a <summary> or a
 * heading.
 */
export function InlineCode({ text }: { text: string }) {
  return text
    .split(/(`[^`\n]+`)/)
    .map((part, index) =>
      index % 2 ? <code key={index}>{part.slice(1, -1)}</code> : part,
    );
}
