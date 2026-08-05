import { useEffect } from "react";
import { useSessionStore } from "../store/sessions";

// Transient background-success notification (memory flush/dream/session-save
// events) — deliberately not the `lastError` banner: that's styled as an
// error, needs manual dismissal, and pins at the top pushing content down,
// all wrong for something the user didn't ask about and doesn't need to act
// on. `absolute`, not `fixed`, so it stays clipped by #root's rounded-corner
// overflow:hidden instead of painting over the transparent window's corners
// (the same fix already applied to the lightbox/dialog/settings backdrops).
export function MemoryToast() {
  const message = useSessionStore((s) => s.memoryStatusMessage);
  const setMemoryStatusMessage = useSessionStore((s) => s.setMemoryStatusMessage);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMemoryStatusMessage(undefined), 4000);
    return () => clearTimeout(timer);
  }, [message, setMemoryStatusMessage]);

  if (!message) return null;

  return (
    <div
      className="absolute bottom-4 right-4 z-50 gd-pop px-3 py-2 rounded-[var(--gd-radius-md)] border text-[12px] shadow-2xl"
      style={{ background: "var(--gd-surface-raised)", borderColor: "var(--gd-border-strong)", color: "var(--gd-text)" }}
    >
      {message}
    </div>
  );
}
