import { openUrl } from "@tauri-apps/plugin-opener";

function LinkRow({ href, label }: { href: string; label: string }) {
  return (
    <button
      onClick={() => openUrl(href).catch(() => {})}
      className="text-[12px] underline decoration-dotted underline-offset-2 text-left"
      style={{ color: "var(--gd-text-muted)" }}
    >
      {label}
    </button>
  );
}

export function AboutModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-80 rounded-[var(--gd-radius-lg)] border p-5 text-center"
        style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)" }}
      >
        <div
          className="mx-auto mb-3 h-14 w-14 rounded-[20px] flex items-center justify-center text-2xl font-bold"
          style={{ background: "linear-gradient(135deg, #ffab6b, #dd5a1f)", color: "#0c0c0e" }}
        >
          ✦
        </div>
        <div className="text-[15px] font-semibold mb-0.5" style={{ color: "var(--gd-text)" }}>
          Grok Desktop
        </div>
        <div className="text-[11px] mb-3" style={{ color: "var(--gd-text-faint)" }}>
          v0.1.0
        </div>
        <div className="text-[12px] mb-4 leading-relaxed" style={{ color: "var(--gd-text-muted)" }}>
          An unofficial, community desktop client for xAI's <code>grok</code> CLI. Not
          affiliated with, endorsed by, or sponsored by xAI.
        </div>
        <div className="text-[12px] mb-4" style={{ color: "var(--gd-text-muted)" }}>
          Built by <span style={{ color: "var(--gd-text)" }}>Stonewave Tech</span> ×{" "}
          <span style={{ color: "var(--gd-text)" }}>Claude</span>
        </div>
        <div className="flex flex-col gap-1.5 items-center mb-4">
          <LinkRow href="https://github.com/Stonewave-Tech-LLC/grok-desktop" label="Source on GitHub" />
          <LinkRow href="https://github.com/Stonewave-Tech-LLC/grok-desktop/blob/main/LICENSE" label="MIT License" />
          <LinkRow href="https://x.ai" label="grok CLI (xAI)" />
        </div>
        <button
          onClick={onClose}
          className="text-[12px] font-medium px-4 py-1.5 rounded-[var(--gd-radius-sm)]"
          style={{ background: "var(--gd-accent)", color: "var(--gd-accent-contrast)" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
