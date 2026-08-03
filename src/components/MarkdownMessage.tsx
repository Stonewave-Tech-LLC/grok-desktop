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
        {text}
      </ReactMarkdown>
    </div>
  );
}
