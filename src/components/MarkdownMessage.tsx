import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

export function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="prose-gd">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
