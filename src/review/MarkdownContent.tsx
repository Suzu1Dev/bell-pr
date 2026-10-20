import { Component, type ReactNode } from "react";
import { markdownTooHeavy } from "../../shared/markdown-guard";
import { useT } from "../i18n";
import { usePanelStrings } from "./i18n";
import { Markdown } from "./markdown/render";

function safeLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : "";
  } catch {
    return "";
  }
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

/** The text as it is, with a note: for Markdown the parser doesn't read, or that failed to render. */
function PlainText({ text }: { text: string }) {
  return (
    <div className="markdown-content">
      <p className="markdown-plain-note">{usePanelStrings().plainText}</p>
      <pre className="markdown-plain">{text}</pre>
    </div>
  );
}

/**
 * Each surface's own boundary: a render error shows the text as it is and
 * never takes down the view around it. Keyed by the text, so a new text
 * renders as Markdown again.
 */
export class MarkdownBoundary extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <PlainText text={this.props.text} /> : this.props.children;
  }
}

/**
 * GitHub Flavored Markdown (tables, task lists, strikethrough, autolinks
 * and footnotes) for reading. Raw HTML never renders, links open web pages
 * only, and images show as a note. Text too long or too deeply nested to
 * parse quickly (shared/markdown-guard.ts) shows as plain text, with a note.
 */
export function MarkdownContent({ children }: { children: string }) {
  const text = typeof children === "string" ? children : "";
  if (markdownTooHeavy(text)) return <PlainText text={text} />;
  return (
    <MarkdownBoundary key={text} text={text}>
      <MarkdownView>{children}</MarkdownView>
    </MarkdownBoundary>
  );
}

function MarkdownView({ children }: { children: string }) {
  const t = useT("review");
  return (
    <div className="markdown-content">
      <Markdown
        urlTransform={safeLink}
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
