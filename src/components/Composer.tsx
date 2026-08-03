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
        className="max-w-2xl mx-auto rounded-[var(--gd-radius-lg)] border flex items-end gap-2 px-3 py-2"
        style={{ borderColor: "var(--gd-border-strong)", background: "var(--gd-surface)" }}
      >
        <textarea
          ref={taRef}
          value={text}
          placeholder="Message grok…"
          disabled={disabled}
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
          className="flex-1 resize-none bg-transparent outline-none text-[14px] py-1"
          style={{ color: "var(--gd-text)", maxHeight: 200 }}
        />
        {isStreaming ? (
          <button
            onClick={onCancel}
            className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center transition"
            style={{ background: "var(--gd-danger-soft)", color: "var(--gd-danger)" }}
            aria-label="Stop"
          >
            ■
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={disabled || !text.trim()}
            className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center transition disabled:opacity-40"
            style={{ background: "var(--gd-accent)", color: "var(--gd-accent-contrast)" }}
            aria-label="Send"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
}
