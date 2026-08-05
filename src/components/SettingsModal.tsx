import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { setMemoryEnabled as setMemoryEnabledBackend } from "../lib/api";
import { useSessionStore } from "../store/sessions";

type Section = "general" | "about" | "memory";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative h-5 w-9 rounded-full shrink-0 transition"
      style={{ background: checked ? "var(--gd-accent)" : "var(--gd-metal-2)" }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full transition-transform"
        style={{
          left: 2,
          transform: checked ? "translateX(16px)" : "translateX(0)",
          background: checked ? "var(--gd-accent-contrast)" : "var(--gd-text-muted)",
        }}
      />
    </button>
  );
}

function LinkRow({ href, label }: { href: string; label: string }) {
  return (
    <button
      onClick={() => openUrl(href).catch(() => {})}
      className="gd-glow-hover flex items-center justify-between px-3 py-2 rounded-[var(--gd-radius-sm)] text-[12.5px] text-left border border-transparent"
      style={{ color: "var(--gd-text-muted)" }}
    >
      {label}
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
        <path d="M6 4h6v6M12 4 4 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function NavItem({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--gd-radius-sm)] text-[12.5px] font-medium transition text-left"
      style={{
        color: active ? "var(--gd-text)" : "var(--gd-text-muted)",
        background: active ? "var(--gd-accent-soft)" : "transparent",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function GeneralSection({ ready }: { ready: boolean }) {
  return (
    <div>
      <div className="text-[13px] font-semibold mb-3" style={{ color: "var(--gd-text)" }}>
        General
      </div>
      <div
        className="flex items-center justify-between px-3 py-2.5 rounded-[var(--gd-radius-md)] border text-[12.5px]"
        style={{ borderColor: "var(--gd-border)", background: "var(--gd-metal-1)", color: "var(--gd-text-muted)" }}
      >
        <span>grok CLI connection</span>
        <span className="flex items-center gap-1.5" style={{ color: ready ? "var(--gd-success)" : "var(--gd-text-faint)" }}>
          <span
            className={ready ? "h-1.5 w-1.5 rounded-full" : "h-1.5 w-1.5 rounded-full animate-pulse"}
            style={{ background: "currentColor" }}
          />
          {ready ? "Connected" : "Connecting…"}
        </span>
      </div>
    </div>
  );
}

function MemorySection({ onBrowse }: { onBrowse: () => void }) {
  const memoryEnabled = useSessionStore((s) => s.memoryEnabled);
  const memoryActiveThisRun = useSessionStore((s) => s.memoryActiveThisRun);
  const setMemoryEnabled = useSessionStore((s) => s.setMemoryEnabled);
  const [saving, setSaving] = useState(false);

  async function handleToggle(next: boolean) {
    setSaving(true);
    try {
      await setMemoryEnabledBackend(next);
      setMemoryEnabled(next);
    } catch {
      // leave the store as-is; the toggle UI reflects whatever the last
      // successful save was
    } finally {
      setSaving(false);
    }
  }

  let statusLabel: string;
  let statusColor: string;
  if (memoryEnabled && memoryActiveThisRun) {
    statusLabel = "Active";
    statusColor = "var(--gd-success)";
  } else if (memoryEnabled && !memoryActiveThisRun) {
    statusLabel = "Will activate after restart";
    statusColor = "var(--gd-warning)";
  } else if (!memoryEnabled && memoryActiveThisRun) {
    statusLabel = "Still active this session — restart to disable";
    statusColor = "var(--gd-warning)";
  } else {
    statusLabel = "Disabled";
    statusColor = "var(--gd-text-faint)";
  }

  return (
    <div>
      <div className="text-[13px] font-semibold mb-3" style={{ color: "var(--gd-text)" }}>
        Memory
      </div>
      <div
        className="flex items-center justify-between px-3 py-2.5 rounded-[var(--gd-radius-md)] border"
        style={{ borderColor: "var(--gd-border)", background: "var(--gd-metal-1)" }}
      >
        <div className="text-[12.5px]" style={{ color: "var(--gd-text)" }}>
          Enable memory
        </div>
        <Toggle checked={memoryEnabled} onChange={handleToggle} />
      </div>
      <div className="flex items-center gap-1.5 mt-2 text-[11.5px]" style={{ color: statusColor }}>
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: "currentColor" }} />
        {saving ? "Saving…" : statusLabel}
      </div>
      <div className="text-[11.5px] mt-3 leading-relaxed" style={{ color: "var(--gd-text-faint)" }}>
        Stores notes in <code>.anvil/memory/</code> (this project) and{" "}
        <code>~/.anvil/memory/</code> (global), and bridges them into grok's own memory so
        they're recalled automatically in future sessions. Also seeds a small policy file
        at <code>~/.grok/rules/</code> so grok actually searches memory proactively instead
        of just having the tools without using them. Changes take effect after restarting
        Grok Desktop.
      </div>
      {memoryActiveThisRun && (
        <button
          onClick={onBrowse}
          className="gd-glow-hover mt-4 w-full text-[12px] font-medium px-3 py-2 rounded-[var(--gd-radius-sm)] border border-transparent"
          style={{ color: "var(--gd-text)", background: "var(--gd-metal-1)" }}
        >
          Browse memory files
        </button>
      )}
    </div>
  );
}

function AboutSection() {
  return (
    <div>
      <div className="text-[13px] font-semibold mb-3" style={{ color: "var(--gd-text)" }}>
        About
      </div>
      <div className="flex items-center gap-3 mb-4">
        <img
          src="/app-icon.png"
          alt=""
          className="h-14 w-14 rounded-[16px] border"
          style={{ borderColor: "var(--gd-border-strong)" }}
        />
        <div>
          <div className="text-[14px] font-semibold" style={{ color: "var(--gd-text)" }}>
            Grok Desktop
          </div>
          <div className="text-[11px]" style={{ color: "var(--gd-text-faint)" }}>
            v0.1.0
          </div>
        </div>
      </div>
      <div className="text-[12px] mb-4 leading-relaxed" style={{ color: "var(--gd-text-muted)" }}>
        An unofficial, community desktop client for xAI's <code>grok</code> CLI. Not affiliated with,
        endorsed by, or sponsored by xAI.
      </div>
      <div className="text-[12px] mb-4" style={{ color: "var(--gd-text-muted)" }}>
        Built by <span style={{ color: "var(--gd-text)" }}>Stonewave Tech</span> ×{" "}
        <span style={{ color: "var(--gd-text)" }}>Claude</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <LinkRow href="https://github.com/Stonewave-Tech-LLC/grok-desktop" label="Source on GitHub" />
        <LinkRow href="https://github.com/Stonewave-Tech-LLC/grok-desktop/blob/main/LICENSE" label="MIT License" />
        <LinkRow href="https://x.ai" label="grok CLI (xAI)" />
      </div>
    </div>
  );
}

export function SettingsModal({ ready, onClose }: { ready: boolean; onClose: () => void }) {
  const [section, setSection] = useState<Section>("general");
  const openDockTab = useSessionStore((s) => s.openDockTab);

  function handleBrowseMemory() {
    openDockTab("memory");
    onClose();
  }

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="gd-pop w-[520px] h-[380px] rounded-[var(--gd-radius-lg)] border flex overflow-hidden"
        style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)" }}
      >
        <div
          className="w-40 shrink-0 border-r p-3 flex flex-col gap-0.5"
          style={{ borderColor: "var(--gd-border)", background: "var(--gd-metal-1)" }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide px-2.5 mb-1.5" style={{ color: "var(--gd-text-faint)" }}>
            Settings
          </div>
          <NavItem
            label="General"
            active={section === "general"}
            onClick={() => setSection("general")}
            icon={
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke="currentColor" strokeWidth="1.2" />
                <path
                  d="M13.2 9.6a1.1 1.1 0 0 0 .22 1.2l.04.04a1.33 1.33 0 1 1-1.88 1.88l-.04-.04a1.1 1.1 0 0 0-1.2-.22 1.1 1.1 0 0 0-.67 1v.12a1.33 1.33 0 1 1-2.67 0v-.06a1.1 1.1 0 0 0-.72-1 1.1 1.1 0 0 0-1.2.22l-.04.04a1.33 1.33 0 1 1-1.88-1.88l.04-.04a1.1 1.1 0 0 0 .22-1.2 1.1 1.1 0 0 0-1-.67h-.12a1.33 1.33 0 1 1 0-2.67h.06a1.1 1.1 0 0 0 1-.72 1.1 1.1 0 0 0-.22-1.2l-.04-.04A1.33 1.33 0 1 1 4.9 2.28l.04.04a1.1 1.1 0 0 0 1.2.22h.06a1.1 1.1 0 0 0 .67-1V1.4a1.33 1.33 0 1 1 2.67 0v.06a1.1 1.1 0 0 0 .67 1h.06a1.1 1.1 0 0 0 1.2-.22l.04-.04a1.33 1.33 0 1 1 1.88 1.88l-.04.04a1.1 1.1 0 0 0-.22 1.2v.06a1.1 1.1 0 0 0 1 .67h.12a1.33 1.33 0 1 1 0 2.67h-.06a1.1 1.1 0 0 0-1 .67Z"
                  stroke="currentColor"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
          <NavItem
            label="Memory"
            active={section === "memory"}
            onClick={() => setSection("memory")}
            icon={
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 1.5c-2 0-3.5 1.5-3.5 3.3 0 1 .4 1.7 1 2.3-.7.5-1.2 1.3-1.2 2.4 0 1.8 1.5 3 3.2 3h.5c1.7 0 3.2-1.2 3.2-3 0-1.1-.5-1.9-1.2-2.4.6-.6 1-1.3 1-2.3C11 3 9.5 1.5 7.5 1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M8 5.2v7.3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
            }
          />
          <NavItem
            label="About"
            active={section === "about"}
            onClick={() => setSection("about")}
            icon={
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
                <path d="M8 7.3v4M8 5.3v.02" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            }
          />

          <div className="mt-auto">
            <button
              onClick={onClose}
              className="gd-billet w-full text-[12px] font-semibold px-3 py-1.5 rounded-[var(--gd-radius-sm)]"
            >
              Done
            </button>
          </div>
        </div>

        <div className="flex-1 p-5 overflow-y-auto">
          {section === "general" && <GeneralSection ready={ready} />}
          {section === "memory" && <MemorySection onBrowse={handleBrowseMemory} />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
