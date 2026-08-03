import { useEffect, useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { ChatPane } from "./components/ChatPane";
import { Composer } from "./components/Composer";
import { ActivityDock } from "./components/ActivityDock";
import { Onboarding } from "./components/Onboarding";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { useSessionStore } from "./store/sessions";
import { newSession, sendPrompt, cancelPrompt, checkAuth, initStatus, onAcpEvent } from "./lib/api";

export default function App() {
  const [authState, setAuthState] = useState<"checking" | "unauthenticated" | "authenticated">("checking");
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);

  useEffect(() => {
    checkAuth()
      .then((ok) => setAuthState(ok ? "authenticated" : "unauthenticated"))
      .catch(() => setAuthState("unauthenticated"));
  }, []);

  const {
    ready,
    setReady,
    setInitError,
    handleAcpEvent,
    sessions,
    activeSessionId,
    registerSession,
    appendUserMessage,
    pendingPermissions,
    activityDockOpen,
    toggleActivityDock,
    lastError,
    setLastError,
    finalizeTurn,
  } = useSessionStore();

  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const activityCount = activeSession?.activityOrder.length ?? 0;

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

  async function handleCreateSession(cwd: string, yolo: boolean) {
    setNewSessionDialogOpen(false);
    try {
      const { sessionId } = await newSession(cwd, yolo);
      registerSession(sessionId, cwd);
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
    <div className="h-full flex flex-col" style={{ background: "var(--gd-bg)" }}>
      <TitleBar title={activeSession ? activeSession.title : "Grok Desktop"} />
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
            <div className="flex-1 flex min-h-0">
              {activeSession ? (
                <>
                  <div className="flex-1 flex flex-col min-h-0">
                    <div
                      className="h-9 shrink-0 flex items-center justify-end px-3 border-b gap-2"
                      style={{ borderColor: "var(--gd-border)" }}
                    >
                      <button
                        onClick={() => toggleActivityDock()}
                        className="text-[11px] font-medium px-2 py-1 rounded-[var(--gd-radius-sm)] flex items-center gap-1.5"
                        style={{
                          color: activityDockOpen ? "var(--gd-accent)" : "var(--gd-text-muted)",
                          background: activityDockOpen ? "var(--gd-accent-soft)" : "transparent",
                        }}
                      >
                        Activity
                        {activityCount > 0 && (
                          <span
                            className="rounded-full px-1.5 text-[10px]"
                            style={{ background: "var(--gd-surface-raised)" }}
                          >
                            {activityCount}
                          </span>
                        )}
                      </button>
                    </div>
                    <ChatPane session={activeSession} permissions={activePermissions} />
                    <Composer
                      disabled={!ready}
                      isStreaming={activeSession.status === "streaming" || activeSession.status === "thinking"}
                      onSend={handleSend}
                      onCancel={handleCancel}
                    />
                  </div>
                  {activityDockOpen && <ActivityDock sessionId={activeSessionId} />}
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
                      className="gd-glow-hover rounded-[var(--gd-radius-md)] px-4 py-2 text-sm font-medium disabled:opacity-40 disabled:pointer-events-none"
                      style={{ background: "var(--gd-accent)", color: "var(--gd-accent-contrast)" }}
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
      {newSessionDialogOpen && (
        <NewSessionDialog onCreate={handleCreateSession} onClose={() => setNewSessionDialogOpen(false)} />
      )}
    </div>
  );
}
