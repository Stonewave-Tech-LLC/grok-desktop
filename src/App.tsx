import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { AmbientBackground } from "./components/AmbientBackground";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { ChatPane } from "./components/ChatPane";
import { Composer } from "./components/Composer";
import { InsightsDock } from "./components/InsightsDock";
import { Onboarding } from "./components/Onboarding";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { useSessionStore } from "./store/sessions";
import {
  newSession,
  loadSession,
  sendPrompt,
  cancelPrompt,
  checkAuth,
  initStatus,
  onAcpEvent,
  getMemoryEnabled,
  memoryRuntimeStatus,
} from "./lib/api";
import { MemoryToast } from "./components/MemoryToast";

export default function App() {
  const [authState, setAuthState] = useState<"checking" | "unauthenticated" | "authenticated">("checking");
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);

  useEffect(() => {
    checkAuth()
      .then((ok) => setAuthState(ok ? "authenticated" : "unauthenticated"))
      .catch(() => setAuthState("unauthenticated"));
  }, []);

  useEffect(() => {
    getMemoryEnabled().then(setMemoryEnabled).catch(() => {});
    memoryRuntimeStatus().then(setMemoryActiveThisRun).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    ready,
    setReady,
    setInitError,
    handleAcpEvent,
    sessions,
    sessionOrder,
    activeSessionId,
    registerSession,
    appendUserMessage,
    pendingPermissions,
    activityDockOpen,
    toggleActivityDock,
    dockTab,
    openDockTab,
    diffsAutoExpand,
    toggleDiffsAutoExpand,
    lastError,
    setLastError,
    finalizeTurn,
    memoryActiveThisRun,
    setMemoryEnabled,
    setMemoryActiveThisRun,
  } = useSessionStore();

  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const activityCount = activeSession?.activityOrder.length ?? 0;
  const activeWorkflowCount = (activeSession?.workflowOrder ?? []).filter((id) => {
    const status = activeSession?.workflows[id]?.status;
    return status && status !== "complete" && status !== "failed" && status !== "cancelled";
  }).length;

  // Auto-open the Activity dock the first time this session gets any
  // subagent/background-command activity — mirrors the TUI's own status
  // line auto-surfacing background work. The user can still close it again.
  useEffect(() => {
    if (activityCount > 0 && !activityDockOpen) toggleActivityDock(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityCount]);

  useEffect(() => {
    const unlisten = onAcpEvent((e) => handleAcpEvent(e));
    // A command (request/response), not a "ready" event — correct regardless of
    // how fast this effect happens to run relative to the Rust side finishing
    // its (near-instant) initialize handshake. See src-tauri's state.rs/lib.rs.
    initStatus()
      .then(() => setReady(true))
      .catch((err) => setInitError(String(err)));
    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sessions from a previous app run are restored into the store by the
  // persist middleware already (their timeline/messages included) — but the
  // *backend* needs a fresh reattach per session before it'll accept new
  // prompts for it, since grok's process restarted along with ours.
  //
  // A reattach failure here used to delete the session outright — but that
  // silently destroyed real conversation history on what can easily be a
  // transient failure (a timing race right after the session was created, a
  // momentary backend hiccup), not proof the session is actually gone. Keep
  // the session and its history visible either way; only surface the error,
  // so sending a *new* message is what tells the user something's actually
  // wrong (via the existing setLastError path in handleSend) — deleting a
  // dead session is still one click away if it truly never reconnects.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      for (const id of sessionOrder) {
        const session = sessions[id];
        if (!session) continue;
        try {
          await loadSession(id, session.cwd);
        } catch (err) {
          if (!cancelled) setLastError(`Couldn't reconnect "${session.title}": ${String(err)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-run when the connection just became ready, not on every
    // session list change — reattaching already-loaded sessions again would
    // be redundant work, not incorrect, but there's no reason to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function handleCreateSession(cwd: string, yolo: boolean) {
    setNewSessionDialogOpen(false);
    try {
      const { sessionId } = await newSession(cwd, yolo);
      registerSession(sessionId, cwd, yolo);
    } catch (err) {
      setLastError(`Couldn't start a session: ${String(err)}`);
    }
  }

  async function handleSend(text: string) {
    if (!activeSessionId) return;
    const sessionId = activeSessionId;
    appendUserMessage(sessionId, text);
    try {
      await sendPrompt(sessionId, text);
    } catch (err) {
      setLastError(`Prompt failed: ${String(err)}`);
    } finally {
      // session/prompt resolving is the real "turn ended" signal — nothing in the
      // streamed session/update notifications flips status back to idle on its own.
      finalizeTurn(sessionId);
    }
  }

  async function handleCancel() {
    if (!activeSessionId) return;
    const sessionId = activeSessionId;
    try {
      await cancelPrompt(sessionId);
    } finally {
      finalizeTurn(sessionId);
    }
  }

  const activePermissions = pendingPermissions.filter(
    (p) => !p.sessionId || p.sessionId === activeSessionId
  );

  return (
    <div className="h-full flex flex-col relative" style={{ background: "var(--gd-bg)" }}>
      <AmbientBackground />
      <div className="relative z-10 h-full flex flex-col min-h-0">
      <TitleBar
        title={activeSession ? activeSession.title : "Grok Desktop"}
        extra={
          activeSession && (
            <>
              <button
                onClick={toggleDiffsAutoExpand}
                aria-label="Show all diffs"
                title={diffsAutoExpand ? "Collapse all diffs" : "Show all diffs"}
                className="gd-glow-hover h-7 w-7 rounded-[var(--gd-radius-sm)] flex items-center justify-center transition border border-transparent"
                style={{
                  color: diffsAutoExpand ? "var(--gd-accent)" : "var(--gd-text-muted)",
                  background: diffsAutoExpand ? "var(--gd-accent-soft)" : "transparent",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="3" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.3" />
                  <rect x="9" y="3" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M4.5 6v4M11.5 6v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
              <button
                onClick={() => openDockTab("activity")}
                className={"gd-panel-tab" + (activityDockOpen && dockTab === "activity" ? " active" : "")}
              >
                Activity
                {activityCount > 0 && (
                  <span
                    className="h-3.5 min-w-3.5 px-0.5 rounded-full text-[9px] leading-3.5 font-semibold text-center"
                    style={{ background: "var(--gd-accent)", color: "var(--gd-accent-contrast)" }}
                  >
                    {activityCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => openDockTab("workflows")}
                className={"gd-panel-tab" + (activityDockOpen && dockTab === "workflows" ? " active" : "")}
              >
                Workflows
                {activeWorkflowCount > 0 && (
                  <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "var(--gd-warning)" }} />
                )}
              </button>
              <button
                onClick={() => openDockTab("assets")}
                className={"gd-panel-tab" + (activityDockOpen && dockTab === "assets" ? " active" : "")}
              >
                Assets
              </button>
              {memoryActiveThisRun && (
                <button
                  onClick={() => openDockTab("memory")}
                  className={"gd-panel-tab" + (activityDockOpen && dockTab === "memory" ? " active" : "")}
                >
                  Memory
                </button>
              )}
            </>
          )
        }
      />
      {lastError && (
        <div
          className="px-4 py-2 text-[12px] flex items-center justify-between"
          style={{ background: "var(--gd-danger-soft)", color: "var(--gd-danger)" }}
        >
          <span>{lastError}</span>
          <button onClick={() => setLastError(undefined)} className="font-bold px-2">
            ×
          </button>
        </div>
      )}
      <div className="flex-1 flex min-h-0">
        {authState === "unauthenticated" ? (
          <Onboarding onAuthenticated={() => setAuthState("authenticated")} />
        ) : authState === "checking" ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-[13px]" style={{ color: "var(--gd-text-muted)" }}>
              Checking grok CLI status…
            </div>
          </div>
        ) : (
          <>
            <Sidebar onNewSession={() => setNewSessionDialogOpen(true)} />
            <div className="flex-1 flex min-h-0 relative">
              {activeSession ? (
                <>
                  <div className="flex-1 flex flex-col min-h-0">
                    <ChatPane session={activeSession} permissions={activePermissions} />
                    <Composer
                      disabled={!ready}
                      isStreaming={activeSession.status === "streaming" || activeSession.status === "thinking"}
                      sessionId={activeSession.id}
                      cwd={activeSession.cwd}
                      yolo={activeSession.yolo}
                      contextTokensUsed={activeSession.contextTokensUsed}
                      onSend={handleSend}
                      onCancel={handleCancel}
                    />
                  </div>
                  <AnimatePresence>
                    {activityDockOpen && <InsightsDock sessionId={activeSessionId} />}
                  </AnimatePresence>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center max-w-sm">
                    <div className="text-[15px] font-medium mb-1" style={{ color: "var(--gd-text)" }}>
                      Grok Desktop
                    </div>
                    <div className="text-[13px] mb-4" style={{ color: "var(--gd-text-muted)" }}>
                      {ready ? "Start a new session to chat with grok." : "Connecting to the grok CLI…"}
                    </div>
                    <button
                      onClick={() => setNewSessionDialogOpen(true)}
                      disabled={!ready}
                      className="gd-billet rounded-[var(--gd-radius-md)] px-4 py-2 text-sm font-semibold disabled:opacity-40 disabled:pointer-events-none"
                    >
                      New Session
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <AnimatePresence>
        {newSessionDialogOpen && (
          <NewSessionDialog onCreate={handleCreateSession} onClose={() => setNewSessionDialogOpen(false)} />
        )}
      </AnimatePresence>
      <MemoryToast />
      </div>
    </div>
  );
}
