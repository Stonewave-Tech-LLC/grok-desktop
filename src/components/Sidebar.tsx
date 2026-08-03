import { useState } from "react";
import { useSessionStore } from "../store/sessions";

function relativeTime(ts: number): string {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return "now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.round(diffHr / 24)}d`;
}

export function Sidebar({ onNewSession }: { onNewSession: () => void }) {
  const { sessions, sessionOrder, activeSessionId, setActiveSession, ready, renameSession, deleteSession } =
    useSessionStore();
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [editValue, setEditValue] = useState("");

  function startRename(id: string, current: string) {
    setEditingId(id);
    setEditValue(current);
  }

  function commitRename() {
    if (editingId && editValue.trim()) renameSession(editingId, editValue.trim());
    setEditingId(undefined);
  }

  return (
    <div
      className="w-64 shrink-0 flex flex-col border-r"
      style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)" }}
    >
      <div className="p-3">
        <button
          onClick={onNewSession}
          className="w-full rounded-[var(--gd-radius-md)] px-3 py-2 text-sm font-medium transition"
          style={{ background: "var(--gd-accent)", color: "var(--gd-accent-contrast)" }}
        >
          + New Session
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {sessionOrder.length === 0 && (
          <div className="px-2 py-6 text-center text-[13px]" style={{ color: "var(--gd-text-faint)" }}>
            No sessions yet
          </div>
        )}
        {sessionOrder.map((id) => {
          const s = sessions[id];
          if (!s) return null;
          const active = id === activeSessionId;
          const hasActiveBackgroundWork = s.activityOrder.some((aid) => s.activity[aid]?.status === "running");
          const isEditing = editingId === id;
          return (
            <div
              key={id}
              onClick={() => !isEditing && setActiveSession(id)}
              className="w-full text-left rounded-[var(--gd-radius-sm)] px-2.5 py-2 transition group cursor-pointer"
              style={{ background: active ? "var(--gd-accent-soft)" : "transparent" }}
            >
              <div className="flex items-center justify-between gap-2">
                {isEditing ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditingId(undefined);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[13px] font-medium bg-transparent outline-none border-b flex-1 min-w-0"
                    style={{ color: "var(--gd-text)", borderColor: "var(--gd-accent)" }}
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRename(id, s.title);
                    }}
                    className="text-[13px] font-medium truncate"
                    style={{ color: active ? "var(--gd-accent)" : "var(--gd-text)" }}
                  >
                    {s.title}
                  </span>
                )}
                <div className="flex items-center gap-1.5 shrink-0">
                  {hasActiveBackgroundWork && (
                    <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "var(--gd-warning)" }} />
                  )}
                  <span
                    className="text-[11px] opacity-0 group-hover:opacity-100 transition"
                    style={{ color: "var(--gd-text-faint)" }}
                  >
                    {relativeTime(s.createdAt)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete session "${s.title}"?`)) deleteSession(id);
                    }}
                    className="text-[13px] leading-none opacity-0 group-hover:opacity-100 transition px-0.5"
                    style={{ color: "var(--gd-text-faint)" }}
                    aria-label="Delete session"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="text-[11px] truncate mt-0.5" style={{ color: "var(--gd-text-faint)" }}>
                {s.cwd}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="p-3 border-t flex items-center gap-2 text-[12px]"
        style={{ borderColor: "var(--gd-border)", color: "var(--gd-text-muted)" }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: ready ? "var(--gd-success)" : "var(--gd-text-faint)" }} />
        {ready ? "Connected" : "Connecting…"}
      </div>
    </div>
  );
}
