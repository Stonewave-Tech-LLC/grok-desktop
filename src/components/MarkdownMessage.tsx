import { memo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { readImageDataUrl } from "../lib/api";
import { GeneratedImage } from "./GeneratedImage";

// A whole markdown line that is *only* a single-backtick inline-code span,
// e.g. `    `├── Local forge (kleine Tasks)`` — the shape grok tends to use
// for file/dir trees and outline diagrams instead of a fenced ``` block.
// Rendered as-is, each such line becomes its own little bordered pill (our
// inline-`code` styling), which reads as a stack of disconnected chips
// rather than one diagram. Detect runs of 2+ consecutive such lines and
// promote them to a real fenced code block before ReactMarkdown ever sees
// them, so they render as one cohesive, properly-aligned block instead.
const WHOLE_LINE_INLINE_CODE = /^([ \t]*)`([^`\n]+)`[ \t]*$/;

function promoteTreeLikeCodeLines(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }
    if (!inFence) {
      const match = WHOLE_LINE_INLINE_CODE.exec(line);
      if (match) {
        const run: string[] = [];
        let j = i;
        while (j < lines.length) {
          const m = WHOLE_LINE_INLINE_CODE.exec(lines[j]);
          if (!m) break;
          run.push(m[1] + m[2]);
          j++;
        }
        if (run.length >= 2) {
          out.push("```", ...run, "```");
          i = j;
          continue;
        }
      }
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

// The model's own prose often references a generated/attached image by a
// relative "short path" — grok's TUI turns that into a clickable OSC-8
// terminal hyperlink, but a plain `<img src="images/8.jpg">` in a webview
// just 404s (native broken-image icon). Resolve it ourselves instead of
// rendering the raw src directly; see read_image_data_url's doc comment for
// the exact candidate-path resolution order.
function LocalImage({ src, alt, cwd, sessionId }: { src?: string; alt?: string; cwd?: string; sessionId?: string }) {
  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined);
  const [resolvedPath, setResolvedPath] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) {
      setFailed(true);
      return;
    }
    if (/^(https?:|data:)/.test(src)) {
      setDataUrl(src);
      setResolvedPath(undefined);
      return;
    }
    let cancelled = false;
    setDataUrl(undefined);
    setResolvedPath(undefined);
    setFailed(false);
    readImageDataUrl(src, cwd, sessionId)
      .then((result) => {
        if (!cancelled) {
          setDataUrl(result.dataUrl);
          setResolvedPath(result.path);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [src, cwd, sessionId]);

  if (failed) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] align-middle"
        style={{ background: "var(--gd-surface-raised)", color: "var(--gd-text-faint)", border: "1px solid var(--gd-border)" }}
      >
        <span aria-hidden>🖼</span>
        {alt || src}
      </span>
    );
  }

  if (!dataUrl) {
    return <span className="inline-block h-24 w-36 rounded-[var(--gd-radius-sm)] animate-pulse align-middle" style={{ background: "var(--gd-metal-1)" }} />;
  }

  return (
    <GeneratedImage
      src={dataUrl}
      path={resolvedPath}
      alt={alt}
      className="rounded-[var(--gd-radius-sm)] max-h-72 max-w-full border block my-1.5"
      style={{ borderColor: "var(--gd-border)" }}
    />
  );
}

// Memoized — without this, every historical message in a session re-runs its
// full react-markdown parse (and re-mounts CodeMirror for any code blocks)
// on *every* streamed token of the current response, since ChatPane's parent
// re-renders each token and React re-renders all children by default. That's
// an O(session length) cost per token instead of O(1), which is exactly what
// made long sessions grind the whole app to a halt while grok was working.
function MarkdownMessageImpl({ text, cwd, sessionId }: { text: string; cwd?: string; sessionId?: string }) {
  const normalized = promoteTreeLikeCodeLines(text);
  return (
    <div className="prose-gd">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img(props) {
            return <LocalImage src={props.src} alt={props.alt} cwd={cwd} sessionId={sessionId} />;
          },
          code(props) {
            const { children, className, ...rest } = props;
            const match = /language-(\w+)/.exec(className || "");
            const isBlock = Boolean(match);
            if (!isBlock) {
              return (
                <code
                  className="px-1 py-0.5 rounded text-[0.85em]"
                  style={{ background: "var(--gd-surface-raised)", border: "1px solid var(--gd-border)" }}
                  {...rest}
                >
                  {children}
                </code>
              );
            }
            const language = match?.[1];
            const code = textOf(children).replace(/\n$/, "");
            return (
              <div className="rounded-[var(--gd-radius-md)] overflow-hidden my-2 border" style={{ borderColor: "var(--gd-border)" }}>
                {language && (
                  <div
                    className="px-3 py-1 text-[10px] uppercase tracking-wide"
                    style={{ background: "var(--gd-surface-raised)", color: "var(--gd-text-faint)" }}
                  >
                    {language}
                  </div>
                )}
                <CodeBlock language={language} code={code} />
              </div>
            );
          },
          a(props) {
            return <a {...props} style={{ color: "var(--gd-accent)" }} target="_blank" rel="noreferrer" />;
          },
          table(props) {
            return (
              <div
                className="my-2.5 rounded-[var(--gd-radius-md)] border overflow-x-auto"
                style={{ borderColor: "var(--gd-border)" }}
              >
                <table className="w-full border-collapse text-[13px]" {...props} />
              </div>
            );
          },
          thead(props) {
            return <thead style={{ background: "var(--gd-surface-raised)" }} {...props} />;
          },
          th(props) {
            return (
              <th
                className="text-left font-medium px-3 py-1.5 border-b"
                style={{ color: "var(--gd-text)", borderColor: "var(--gd-border)" }}
                {...props}
              />
            );
          },
          td(props) {
            return (
              <td
                className="px-3 py-1.5 border-b align-top"
                style={{ borderColor: "var(--gd-border)", color: "var(--gd-text)" }}
                {...props}
              />
            );
          },
          tr(props) {
            return <tr className="last:[&>td]:border-b-0" {...props} />;
          },
          ul(props) {
            return <ul className="list-disc pl-5 my-1.5 space-y-0.5" {...props} />;
          },
          ol(props) {
            return <ol className="list-decimal pl-5 my-1.5 space-y-0.5" {...props} />;
          },
          li(props) {
            return <li className="pl-0.5" {...props} />;
          },
          blockquote(props) {
            return (
              <blockquote
                className="border-l-2 pl-3 my-2 italic"
                style={{ borderColor: "var(--gd-border-strong)", color: "var(--gd-text-muted)" }}
                {...props}
              />
            );
          },
          h1(props) {
            return <h1 className="text-[17px] font-semibold mt-3 mb-1.5" {...props} />;
          },
          h2(props) {
            return <h2 className="text-[15px] font-semibold mt-3 mb-1.5" {...props} />;
          },
          h3(props) {
            return <h3 className="text-[14px] font-semibold mt-2.5 mb-1" {...props} />;
          },
          p(props) {
            return <p className="my-1.5 first:mt-0 last:mb-0" {...props} />;
          },
          hr() {
            return <hr className="my-3" style={{ borderColor: "var(--gd-border)" }} />;
          },
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownMessage = memo(MarkdownMessageImpl);
