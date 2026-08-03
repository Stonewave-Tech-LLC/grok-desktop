import { getCurrentWindow } from "@tauri-apps/api/window";

const win = getCurrentWindow();

function WindowControls() {
  return (
    <div className="flex items-center gap-2">
      <button
        aria-label="Minimize"
        onClick={() => win.minimize()}
        className="h-3 w-3 rounded-full bg-[var(--gd-border-strong)] hover:brightness-90 transition"
      />
      <button
        aria-label="Maximize"
        onClick={() => win.toggleMaximize()}
        className="h-3 w-3 rounded-full bg-[var(--gd-border-strong)] hover:brightness-90 transition"
      />
      <button
        aria-label="Close"
        onClick={() => win.close()}
        className="h-3 w-3 rounded-full bg-[var(--gd-danger)] hover:brightness-90 transition"
      />
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
