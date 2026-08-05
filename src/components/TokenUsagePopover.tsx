import { useEffect } from "react";
import { useSessionStore } from "../store/sessions";
import { CostCockpitPanel } from "./CostCockpitPanel";

export function TokenUsagePopover({ sessionId, onClose }: { sessionId?: string; onClose: () => void }) {
  const session = useSessionStore((s) => (sessionId ? s.sessions[sessionId] : undefined));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* fixed, not absolute: this sits inside the small `relative` badge
          wrapper in Composer.tsx, so `absolute` would only cover the badge
          itself instead of the whole screen for click-outside-to-close.
          It's a transparent click-catcher with no background painted, so
          it doesn't hit the #root corner-clipping issue `fixed` usually
          causes for actual backdrops (see GeneratedImage's Lightbox). */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute right-0 bottom-full mb-2 z-50 w-72 max-h-96 overflow-y-auto rounded-[var(--gd-radius-md)] border shadow-2xl gd-pop"
        style={{ background: "var(--gd-surface-raised)", borderColor: "var(--gd-border-strong)" }}
      >
        <CostCockpitPanel session={session} />
      </div>
    </>
  );
}
