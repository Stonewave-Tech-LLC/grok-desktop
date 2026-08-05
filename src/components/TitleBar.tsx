import { getCurrentWindow } from "@tauri-apps/api/window";

const win = getCurrentWindow();

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

function WindowControls() {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <TrafficLight color="#ff5f57" glyph="✕" label="Close" onClick={() => win.close()} />
      <TrafficLight color="#febc2e" glyph="−" label="Minimize" onClick={() => win.minimize()} />
      <TrafficLight color="#28c840" glyph="+" label="Zoom" onClick={() => win.toggleMaximize()} />
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
  return (
    <div
      className="h-10 shrink-0 flex items-center justify-between px-3 select-none border-b"
      style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)" }}
    >
      {/* The drag region lives only on the empty title/spacer areas, never
          on an ancestor of the traffic-light buttons — nesting it around
          the buttons is what silently ate their clicks. */}
      <WindowControls />
      <div
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
        className="flex-1 h-full flex items-center justify-center text-center text-[12px] font-medium tracking-wide"
        style={{ color: "var(--gd-text-muted)" }}
      >
        {title}
      </div>
      <div data-tauri-drag-region onMouseDown={handleDragMouseDown} className="w-[68px] h-full" />
    </div>
  );
}
