import { useState } from "react";
import { getStoredTheme, applyTheme, type ThemePreference } from "../lib/theme";
import { AboutModal } from "./AboutModal";

const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export function SettingsModal({ ready, onClose }: { ready: boolean; onClose: () => void }) {
  const [theme, setTheme] = useState<ThemePreference>(getStoredTheme());
  const [aboutOpen, setAboutOpen] = useState(false);

  function choose(pref: ThemePreference) {
    setTheme(pref);
    applyTheme(pref);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="gd-pop w-80 rounded-[var(--gd-radius-lg)] border p-5"
        style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)" }}
      >
        <div className="text-[15px] font-semibold mb-4" style={{ color: "var(--gd-text)" }}>
          Settings
        </div>

        <div className="flex items-center justify-between mb-4 text-[12px]" style={{ color: "var(--gd-text-muted)" }}>
          <span>grok CLI connection</span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: ready ? "var(--gd-success)" : "var(--gd-text-faint)" }}
            />
            {ready ? "Connected" : "Connecting…"}
          </span>
        </div>

        <label className="block text-[11px] font-medium mb-1.5" style={{ color: "var(--gd-text-muted)" }}>
          Appearance
        </label>
        <div className="flex gap-1.5 mb-1">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => choose(opt.id)}
              className="flex-1 text-[12px] font-medium py-1.5 rounded-[var(--gd-radius-sm)] border transition"
              style={{
                borderColor: theme === opt.id ? "var(--gd-accent)" : "var(--gd-border-strong)",
                background: theme === opt.id ? "var(--gd-accent-soft)" : "transparent",
                color: theme === opt.id ? "var(--gd-accent)" : "var(--gd-text)",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mt-5">
          <button
            onClick={() => setAboutOpen(true)}
            className="text-[11px] underline decoration-dotted underline-offset-2"
            style={{ color: "var(--gd-text-faint)" }}
          >
            About Grok Desktop
          </button>
          <button
            onClick={onClose}
            className="text-[12px] font-medium px-3.5 py-1.5 rounded-[var(--gd-radius-sm)]"
            style={{ background: "var(--gd-accent)", color: "var(--gd-accent-contrast)" }}
          >
            Done
          </button>
        </div>
      </div>
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
