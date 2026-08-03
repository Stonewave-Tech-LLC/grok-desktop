import { useRef, useState } from "react";

export function Composer({
  disabled,
  isStreaming,
  onSend,
  onCancel,
}: {
  disabled: boolean;
  isStreaming: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  }

  return (
    <div className="p-4 border-t" style={{ borderColor: "var(--gd-border)" }}>
      <div
        className="max-w-2xl mx-auto rounded-[var(--gd-radius-lg)] border flex items-end gap-2 px-3.5 py-2.5 transition-shadow"
        style={{
          borderColor: focused ? "var(--gd-accent)" : "var(--gd-border-strong)",
          background: "var(--gd-surface)",
          boxShadow: focused ? "0 0 0 3px var(--gd-accent-soft)" : "none",
        }}
      >
        <textarea
          ref={taRef}
          value={text}
          placeholder="Message grok…"
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          className="flex-1 resize-none bg-transparent outline-none text-[14px] py-1 leading-relaxed"
          style={{ color: "var(--gd-text)", maxHeight: 200 }}
        />
        {isStreaming ? (
          <button
            onClick={onCancel}
            className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center transition-transform active:scale-90 hover:brightness-110"
            style={{ background: "var(--gd-danger-soft)", color: "var(--gd-danger)" }}
            aria-label="Stop"
          >
            <span className="block h-2.5 w-2.5 rounded-[2px]" style={{ background: "currentColor" }} />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={disabled || !text.trim()}
            className="gd-glow-hover shrink-0 h-8 w-8 rounded-full flex items-center justify-center disabled:opacity-40 disabled:pointer-events-none"
            style={{ background: "var(--gd-accent)", color: "var(--gd-accent-contrast)" }}
            aria-label="Send"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 13V3M8 3 3.5 7.5M8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
