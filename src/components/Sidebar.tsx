import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useSessionStore, type ChatSession } from "../store/sessions";
import { defaultCwd } from "../lib/api";
import { SettingsModal } from "./SettingsModal";

function relativeTime(ts: number): string {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return "now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.round(diffHr / 24)}d`;
}

/// Steals Forge's `BackendSessionBrowser` grouping key as-is: the last path
/// component of `cwd`, home collapsed to `~`. Two unrelated repos that happen
/// to share a folder name land in the same group — a known trade-off of that
/// exact scheme, not something to fix here.
function workspaceName(cwd: string, homeDir?: string): string {
  if (homeDir && cwd === homeDir) return "~";
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

interface WorkspaceGroup {
  name: string;
  sessionIds: string[];
  mostRecent: number;
}

function groupByWorkspace(
  sessionOrder: string[],
  sessions: Record<string, ChatSession>,
  homeDir: string | undefined
): WorkspaceGroup[] {
  const groups = new Map<string, WorkspaceGroup>();
  for (const id of sessionOrder) {
    const s = sessions[id];
    if (!s) continue;
    const name = workspaceName(s.cwd, homeDir);
    let group = groups.get(name);
    if (!group) {
      group = { name, sessionIds: [], mostRecent: -Infinity };
      groups.set(name, group);
    }
    group.sessionIds.push(id);
    if (s.createdAt > group.mostRecent) group.mostRecent = s.createdAt;
  }
  for (const group of groups.values()) {
    group.sessionIds.sort((a, b) => (sessions[b]?.createdAt ?? 0) - (sessions[a]?.createdAt ?? 0));
  }
  return [...groups.values()].sort((a, b) => b.mostRecent - a.mostRecent);
}

export function Sidebar({ onNewSession }: { onNewSession: () => void }) {
  const { sessions, sessionOrder, activeSessionId, setActiveSession, ready, renameSession, deleteSession } =
    useSessionStore();
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [editValue, setEditValue] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [homeDir, setHomeDir] = useState<string | undefined>(undefined);

  useEffect(() => {
    defaultCwd().then(setHomeDir).catch(() => {});
  }, []);

  const groups = useMemo(
    () => groupByWorkspace(sessionOrder, sessions, homeDir),
    [sessionOrder, sessions, homeDir]
  );

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
        <button onClick={onNewSession} className="gd-billet w-full rounded-[var(--gd-radius-md)] px-3 py-2 text-sm font-semibold">
          + New Session
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-3">
        {sessionOrder.length === 0 && (
          <div className="px-2 py-6 text-center text-[13px]" style={{ color: "var(--gd-text-faint)" }}>
            No sessions yet
          </div>
        )}
        {groups.map((group) => (
          <div key={group.name}>
            <div
              className="px-2.5 mb-1 text-[10px] font-mono uppercase tracking-wide truncate"
              style={{ color: "var(--gd-text-faint)" }}
              title={group.name}
            >
              {group.name}
            </div>
            <div className="space-y-1">
              {group.sessionIds.map((id) => {
                const s = sessions[id];
                if (!s) return null;
                const active = id === activeSessionId;
                const hasActiveBackgroundWork = s.activityOrder.some((aid) => s.activity[aid]?.status === "running");
                const isEditing = editingId === id;
                return (
                  <div
                    key={id}
                    onClick={() => !isEditing && setActiveSession(id)}
                    className={
                      "w-full text-left rounded-[var(--gd-radius-sm)] px-2.5 py-2 transition-colors duration-150 group cursor-pointer border-l-2 " +
                      (active ? "bg-[var(--gd-accent-soft)]" : "bg-transparent hover:bg-[var(--gd-surface-raised)]")
                    }
                    style={{ borderLeftColor: active ? "var(--gd-accent)" : "transparent" }}
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
                          className="text-[13px] font-medium truncate flex items-center gap-1.5 min-w-0"
                          style={{ color: active ? "var(--gd-accent)" : "var(--gd-text)" }}
                        >
                          <span className="truncate">{s.title}</span>
                          {s.yolo && (
                            <span
                              className="shrink-0 text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                              style={{ color: "var(--gd-text-muted)", background: "var(--gd-metal-1)" }}
                              title="This session runs in YOLO mode"
                            >
                              YOLO
                            </span>
                          )}
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
                          className="h-5 w-5 rounded-[var(--gd-radius-sm)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:!opacity-100 bg-transparent text-[var(--gd-text-faint)] hover:bg-[var(--gd-danger-soft)] hover:text-[var(--gd-danger)] hover:scale-110 active:scale-90"
                          aria-label="Delete session"
                          title="Delete session"
                        >
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                            <path
                              d="M2.75 4h10.5M6.5 4V2.75a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1V4m-6 0 .6 8.4a1 1 0 0 0 1 .93h5.8a1 1 0 0 0 1-.93L12.5 4"
                              stroke="currentColor"
                              strokeWidth="1.3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Slice 4: no border-t — was a second, independently-positioned
          hairline that never lined up with the composer's line in the main
          pane. Site never has competing pane-border T-junctions. */}
      <div className="p-3">
        <button
          onClick={() => setSettingsOpen(true)}
          className="gd-glow-hover-row w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--gd-radius-sm)] text-[12px] font-medium border border-transparent"
          style={{ color: "var(--gd-text-muted)", background: "var(--gd-surface-raised)" }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path
              d="M13.2 9.6a1.1 1.1 0 0 0 .22 1.2l.04.04a1.33 1.33 0 1 1-1.88 1.88l-.04-.04a1.1 1.1 0 0 0-1.2-.22 1.1 1.1 0 0 0-.67 1v.12a1.33 1.33 0 1 1-2.67 0v-.06a1.1 1.1 0 0 0-.72-1 1.1 1.1 0 0 0-1.2.22l-.04.04a1.33 1.33 0 1 1-1.88-1.88l.04-.04a1.1 1.1 0 0 0 .22-1.2 1.1 1.1 0 0 0-1-.67h-.12a1.33 1.33 0 1 1 0-2.67h.06a1.1 1.1 0 0 0 1-.72 1.1 1.1 0 0 0-.22-1.2l-.04-.04A1.33 1.33 0 1 1 4.9 2.28l.04.04a1.1 1.1 0 0 0 1.2.22h.06a1.1 1.1 0 0 0 .67-1V1.4a1.33 1.33 0 1 1 2.67 0v.06a1.1 1.1 0 0 0 .67 1h.06a1.1 1.1 0 0 0 1.2-.22l.04-.04a1.33 1.33 0 1 1 1.88 1.88l-.04.04a1.1 1.1 0 0 0-.22 1.2v.06a1.1 1.1 0 0 0 1 .67h.12a1.33 1.33 0 1 1 0 2.67h-.06a1.1 1.1 0 0 0-1 .67Z"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Settings
          <span
            className="h-1.5 w-1.5 rounded-full ml-auto"
            style={{ background: ready ? "var(--gd-success)" : "var(--gd-text-faint)" }}
          />
        </button>
      </div>
      <AnimatePresence>
        {settingsOpen && <SettingsModal ready={ready} onClose={() => setSettingsOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}
