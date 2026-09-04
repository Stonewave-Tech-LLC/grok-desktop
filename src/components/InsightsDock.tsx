import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useSessionStore } from "../store/sessions";
import { ActivityPanel } from "./ActivityDock";
import { WorkflowPanel } from "./WorkflowPanel";
import { MemoryPanel } from "./MemoryPanel";
import { AssetsPanel } from "./AssetsPanel";

const TABS: Array<{ id: "activity" | "workflows" | "memory" | "assets"; label: string }> = [
  { id: "activity", label: "Activity" },
  { id: "workflows", label: "Workflows" },
  { id: "assets", label: "Assets" },
  { id: "memory", label: "Memory" },
];

const WIDTH_KEY = "gd-dock-width";
const MIN_WIDTH = 280;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 320;

function readStoredWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(raw) && raw >= MIN_WIDTH && raw <= MAX_WIDTH ? raw : DEFAULT_WIDTH;
}

export function InsightsDock({ sessionId }: { sessionId?: string }) {
  const dockTab = useSessionStore((s) => s.dockTab);
  const openDockTab = useSessionStore((s) => s.openDockTab);
  const toggleActivityDock = useSessionStore((s) => s.toggleActivityDock);
  const session = useSessionStore((s) => (sessionId ? s.sessions[sessionId] : undefined));

  const [width, setWidth] = useState(readStoredWidth);
  const [resizing, setResizing] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (!resizing) return;
    function onMove(e: MouseEvent) {
      if (!dragState.current) return;
      // The panel hangs off the right edge, so dragging the left-edge handle
      // further left should grow it — width grows opposite to mouse delta.
      const delta = dragState.current.startX - e.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragState.current.startWidth + delta));
      setWidth(next);
    }
    function onUp() {
      setResizing(false);
      dragState.current = null;
      setWidth((w) => {
        localStorage.setItem(WIDTH_KEY, String(w));
        return w;
      });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  function handleHandleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: width };
    setResizing(true);
  }

  return (
    // Floating overlay rather than a flex sibling that shrinks the chat pane —
    // absolutely positioned within the relative content area in App.tsx, so it
    // sits on top instead of squeezing ChatPane/Composer. `absolute` (not
    // `fixed`) is correct here regardless of the corner-clipping rule: this
    // panel is scoped to that content area, not the viewport, so it doesn't
    // need to escape any ancestor to begin with.
    <motion.div
      key="insights-dock"
      initial={{ x: width, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: width, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="absolute top-0 right-0 bottom-0 flex flex-col min-h-0"
      style={{
        width,
        borderLeft: "1px solid var(--gd-border)",
        background: "var(--gd-surface)",
        boxShadow: "-8px 0 24px rgba(0,0,0,0.35)",
        zIndex: 20,
      }}
    >
      <div
        onMouseDown={handleHandleMouseDown}
        title="Drag to resize"
        className="absolute top-0 bottom-0 left-0 w-1.5 -translate-x-1/2 cursor-col-resize"
        style={{ background: resizing ? "var(--gd-accent)" : "transparent" }}
      />
      <div className="flex items-center border-b shrink-0" style={{ borderColor: "var(--gd-border)" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => openDockTab(tab.id)}
            className="flex-1 px-2 py-2 text-[10.5px] font-semibold uppercase tracking-wide transition"
            style={{
              color: dockTab === tab.id ? "var(--gd-text)" : "var(--gd-text-faint)",
              borderBottom: dockTab === tab.id ? "2px solid var(--gd-accent)" : "2px solid transparent",
            }}
          >
            {tab.label}
          </button>
        ))}
        <button
          onClick={() => toggleActivityDock(false)}
          aria-label="Close panel"
          title="Close panel"
          className="gd-glow-hover shrink-0 h-7 w-7 mr-1.5 rounded-[var(--gd-radius-sm)] flex items-center justify-center transition"
          style={{ color: "var(--gd-text-faint)" }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {dockTab === "activity" && <ActivityPanel sessionId={sessionId} />}
      {dockTab === "workflows" && <WorkflowPanel session={session} />}
      {dockTab === "assets" && <AssetsPanel cwd={session?.cwd} />}
      {dockTab === "memory" && <MemoryPanel cwd={session?.cwd} />}
    </motion.div>
  );
}
