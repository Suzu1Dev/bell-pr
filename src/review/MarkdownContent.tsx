import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import ReactMarkdown from "react-markdown";
import { useT } from "../i18n";

/**
 * GitHub Flavored Markdown (tables, task lists, strikethrough, autolinks
 * and footnotes) for reading. remark-gfm also adds a Markdown writer, which
 * react-markdown never calls; this plugin adds only the two parsing
 * extensions, the ones shared/draft-checks.ts already uses.
 */
function remarkGfm(this: { data(): object }) {
  // The two lists remark-parse reads from the processor's data.
  const data = this.data() as {
    micromarkExtensions?: unknown[];
    fromMarkdownExtensions?: unknown[];
  };
  (data.micromarkExtensions ??= []).push(gfm());
  (data.fromMarkdownExtensions ??= []).push(gfmFromMarkdown());
}

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

export function MarkdownContent({ children }: { children: string }) {
  const t = useT("review");
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
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
      </ReactMarkdown>
    </div>
  );
}
