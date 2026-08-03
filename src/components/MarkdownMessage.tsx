import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
            return (
              <div className="rounded-[var(--gd-radius-md)] overflow-hidden my-2 border" style={{ borderColor: "var(--gd-border)" }}>
                {match && (
                  <div
                    className="px-3 py-1 text-[10px] uppercase tracking-wide"
                    style={{ background: "var(--gd-surface-raised)", color: "var(--gd-text-faint)" }}
                  >
                    {match[1]}
                  </div>
                )}
                <pre className="p-3 overflow-x-auto text-[13px] leading-relaxed" style={{ background: "var(--gd-bg)", margin: 0 }}>
                  <code {...rest}>{children}</code>
                </pre>
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
