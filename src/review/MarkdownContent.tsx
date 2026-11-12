import type { ComponentProps } from "react";
import { useT } from "../i18n";
import { Markdown } from "./markdown/render";

export function safeLink(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  // Reject anything that does not clearly begin with http(s): before URL parses
  // (blocks javascript:, data:, protocol-relative //, and whitespace tricks).
  if (!/^https?:\/\//i.test(trimmed)) return "";
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

/** Keep rejected external URLs readable without creating a link. */
export function WebLink({ href, children, className, ...props }: ComponentProps<"a">) {
  // In-page hash targets are not external; everything else must pass safeLink.
  const safe =
    typeof href === "string" && href.startsWith("#")
      ? href
      : typeof href === "string"
        ? safeLink(href)
        : "";
  return safe
    ? <a className={className} href={safe} {...props}>{children}</a>
    : <span className={className} title={props.title}>{children}</span>;
}

/**
 * The code of a fenced `diff` block, each line marked by its first
 * character as added (`+`) or removed (`-`); the line breaks stay in the
 * text, so copying the block copies the diff.
 */
function DiffLines({ text }: { text: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return lines.map((line, index) => (
    <span
      key={index}
      className={
        line.startsWith("+")
          ? "markdown-diff-added"
          : line.startsWith("-")
            ? "markdown-diff-removed"
            : undefined
      }
    >
      {index < lines.length - 1 ? `${line}\n` : line}
    </span>
  ));
}

/**
 * GitHub Flavored Markdown (tables, task lists, strikethrough, autolinks
 * and footnotes) for reading. Raw HTML never renders, links open web pages
 * only, and images show as a note.
 */
export function MarkdownContent({ children }: { children: string }) {
  const t = useT("review");
  return (
    <div className="markdown-content">
      <Markdown
        urlTransform={safeLink}
        footnoteLabel={t.markdown.footnotes}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => (
            <span className="markdown-image-note">
              {alt
                ? t.markdown.imageOmittedWithAlt({ alt })
                : t.markdown.imageOmitted}
            </span>
          ),
          code: ({ className, children }) =>
            /(?:^|\s)language-diff(?:\s|$)/.test(className ?? "") &&
            typeof children === "string" ? (
              <code className={className}>
                <DiffLines text={children} />
              </code>
            ) : (
              <code className={className}>{children}</code>
            ),
          h1: ({ children }) => <h4>{children}</h4>,
          h2: ({ children }) => <h4>{children}</h4>,
          h3: ({ children }) => <h4>{children}</h4>,
          h4: ({ children }) => <h4>{children}</h4>,
          h5: ({ children }) => <h5>{children}</h5>,
          h6: ({ children }) => <h5>{children}</h5>,
          table: ({ children }) => (
            <div
              className="markdown-table-scroll"
              tabIndex={0}
              role="region"
              aria-label={t.markdown.tableLabel}
            >
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
