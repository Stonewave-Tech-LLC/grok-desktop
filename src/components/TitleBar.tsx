import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const win = getCurrentWindow();

// No `@tauri-apps/plugin-os` dependency in this project — a UA sniff is enough
// to pick a control style, we don't need real OS APIs for anything else here.
const isWindows = navigator.userAgent.includes("Windows");

function TrafficLight({
  color,
  glyph,
  label,
  onClick,
}: {
  color: string;
  glyph: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      // Stops the mousedown from bubbling into any ancestor's drag-region
      // listener — without this, clicking a traffic light while it sits
      // inside a data-tauri-drag-region ancestor starts a window drag
      // instead of firing the click.
      onMouseDown={(e) => e.stopPropagation()}
      className="group h-3.5 w-3.5 rounded-full flex items-center justify-center transition-transform active:scale-90"
      style={{ background: color }}
    >
      <span
        className="text-[9px] leading-none font-bold opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: "rgba(0,0,0,0.55)" }}
      >
        {glyph}
      </span>
    </button>
  );
}

function MacWindowControls() {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <TrafficLight color="#ff5f57" glyph="✕" label="Close" onClick={() => win.close()} />
      <TrafficLight color="#febc2e" glyph="−" label="Minimize" onClick={() => win.minimize()} />
      <TrafficLight color="#28c840" glyph="+" label="Zoom" onClick={() => win.toggleMaximize()} />
    </div>
  );
}

function CaptionButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      className="h-full w-[46px] flex items-center justify-center transition-colors"
      style={{ color: "var(--gd-text-muted)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? "#e81123" : "var(--gd-accent-soft)";
        e.currentTarget.style.color = danger ? "#fff" : "var(--gd-text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--gd-text-muted)";
      }}
    >
      {children}
    </button>
  );
}

// Windows convention: minimize / maximize-restore / close, rectangular,
// right-aligned, close hover turns red — matches every native Win32/UWP app
// (Explorer, Settings, Notepad) instead of the macOS traffic-light metaphor.
function WindowsWindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className="flex items-center h-full shrink-0">
      <CaptionButton label="Minimize" onClick={() => win.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </CaptionButton>
      <CaptionButton label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
            <path d="M0.5 2.5h7v7h-7z" fill="var(--gd-surface)" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </CaptionButton>
      <CaptionButton label="Close" onClick={() => win.close()} danger>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </CaptionButton>
    </div>
  );
}

// The passive `data-tauri-drag-region` attribute alone is unreliable once a
// window also has native OS file drag-and-drop enabled (dragDropEnabled,
// needed for the composer's file-attach — see Composer.tsx) — the two compete
// for the same mouse-down/mouse-move gesture at the WebView level on macOS,
// a known Tauri interaction (github.com/tauri-apps/tauri, multiple open
// issues on `data-tauri-drag-region` + drag-drop conflicts). Calling
// `startDragging()` explicitly on mousedown sidesteps it instead of relying
// on the passive attribute alone; keep the attribute too as a fallback.
function handleDragMouseDown(e: React.MouseEvent) {
  if (e.button !== 0) return;
  win.startDragging();
}

export function TitleBar({ title }: { title: string }) {
  const leading = isWindows ? (
    <div className="w-[68px] h-full shrink-0" />
  ) : (
    <MacWindowControls />
  );
  const trailing = isWindows ? <WindowsWindowControls /> : (
    <div data-tauri-drag-region onMouseDown={handleDragMouseDown} className="w-[68px] h-full" />
  );

  return (
    <div
      className="h-10 shrink-0 flex items-center justify-between select-none border-b"
      style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)" }}
    >
      {/* The drag region lives only on the empty title/spacer areas, never
          on an ancestor of the window-control buttons — nesting it around
          the buttons is what silently ate their clicks. */}
      <div className={isWindows ? "" : "pl-3"}>{leading}</div>
      <div
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
        className="flex-1 h-full flex items-center justify-center text-center text-[12px] font-medium tracking-wide"
        style={{ color: "var(--gd-text-muted)" }}
      >
        {title}
      </div>
      {trailing}
    </div>
  );
}
