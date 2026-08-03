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

export function TitleBar({ title }: { title: string }) {
  return (
    <div
      data-tauri-drag-region
      className="h-10 shrink-0 flex items-center justify-between px-3 select-none border-b"
      style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)" }}
    >
      <WindowControls />
      <div
        data-tauri-drag-region
        className="flex-1 text-center text-[12px] font-medium tracking-wide"
        style={{ color: "var(--gd-text-muted)" }}
      >
        {title}
      </div>
      <div className="w-[68px]" />
    </div>
  );
}
