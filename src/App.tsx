import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { AmbientBackground } from "./components/AmbientBackground";
import { AnvilSplash, type BootStatus } from "./components/AnvilSplash";
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
  listSessions,
  mcpCapabilities,
  sendPrompt,
  cancelPrompt,
  checkAuth,
  initStatus,
  onAcpEvent,
  getMemoryEnabled,
  memoryRuntimeStatus,
  currentModelInfo,
  setSessionModel,
} from "./lib/api";
import { parseSessionControls } from "./lib/sessionControls";
import {
  AUTO_DREAM_MIN_EPISODICS,
  AUTO_DREAM_MIN_MS,
  hasPendingDream,
  runOperatorDream,
  uniqueEpisodicCount,
} from "./lib/dream";
import { MemoryToast } from "./components/MemoryToast";
import { EmptyCanvas } from "./components/EmptyCanvas";

export default function App() {
  const [authState, setAuthState] = useState<"checking" | "unauthenticated" | "authenticated">("checking");
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  // Drives the AnvilSplash overlay. Deliberately separate from the store's
  // `ready` flag: `ready` only ever meant "the ACP connection answered
  // init_status", which several other bits of UI (Composer, Sidebar's status
  // dot) already key off of and shouldn't have to wait on session import too.
  const [bootStatus, setBootStatus] = useState<BootStatus>("initializing");
  const [bootError, setBootError] = useState<string | undefined>(undefined);
  const [bootAttempt, setBootAttempt] = useState(0);

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
    activeSessionId,
    registerSession,
    applySessionControls,
    setSessionModelLocal,
    setModelCatalog,
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
    setMemoryStatusMessage,
    reattachedSessionIds,
    markReattached,
    mergeRemoteSessions,
    autoDream,
    operatorDreamDue,
    operatorDreamRunning,
    lastOperatorDreamAt,
    clearOperatorDreamDue,
    setOperatorDreamRunning,
    setLastOperatorDreamAt,
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

  // The onAcpEvent listener has to be live before anything else below can
  // possibly matter (a stream event could arrive the instant init_status
  // resolves), so it's registered unconditionally on mount, independent of
  // the boot sequence's own retries.
  useEffect(() => {
    const unlisten = onAcpEvent((e) => handleAcpEvent(e));
    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Slice 5's boot sequence: everything the splash holds for lives here in
  // one place instead of several independent effects racing each other —
  // init_status + check_auth (parallel, neither should block the other),
  // then list_sessions's merge, then reattaching *only* the session that was
  // last active (not the whole persisted history — see the on-select effect
  // below for the rest). `bootAttempt` is the retry hook for the splash's
  // failure state.
  useEffect(() => {
    let cancelled = false;
    setBootStatus("initializing");
    setBootError(undefined);

    // Each phase is shown at least this long so the wordmark/heat-scan actually
    // reads on a fast local boot (otherwise the overlay is gone in <300ms).
    const dwell = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const PHASE_MS = 900;

    (async () => {
      // A command (request/response), not a "ready" event — correct
      // regardless of how fast this effect happens to run relative to the
      // Rust side finishing its (near-instant) initialize handshake. See
      // src-tauri's state.rs/lib.rs. This is the one call whose failure is
      // actually fatal to the app being usable at all — checkAuth failing
      // just means "assume unauthenticated, the onboarding screen after the
      // splash handles it", so it's swallowed rather than propagated.
      const [authOk] = await Promise.all([checkAuth().catch(() => false), initStatus(), dwell(PHASE_MS)]);
      if (cancelled) return;
      setAuthState(authOk ? "authenticated" : "unauthenticated");
      setReady(true);

      // Slice 2 MCP probe: just logged for now, not used to gate anything —
      // stdio (what the probe server below uses) has no capability flag at
      // all, it's spec-mandatory regardless of what this reports.
      mcpCapabilities()
        .then((caps) => console.log("[Anvil] grok-build MCP capabilities:", caps, "(stdio is spec-mandatory regardless)"))
        .catch((err) => console.warn("[Anvil] couldn't read MCP capabilities:", err));
      currentModelInfo()
        .then(setModelCatalog)
        .catch((err) => console.warn("[Anvil] couldn't read model catalog:", err));

      setBootStatus("importing");
      // grok's own on-disk session history can be large; a failure here
      // (unsupported CLI version, transient RPC error) shouldn't block the
      // app on local-only sessions still being fully usable.
      const [remote] = await Promise.all([listSessions().catch(() => []), dwell(PHASE_MS)]);
      if (cancelled) return;
      mergeRemoteSessions(remote);

      setBootStatus("reattaching");
      const active = useSessionStore.getState().activeSessionId;
      const sessionToReattach = active ? useSessionStore.getState().sessions[active] : undefined;
      const reattach = (async () => {
        if (active && sessionToReattach && !useSessionStore.getState().reattachedSessionIds.has(active)) {
          try {
            const raw = await loadSession(active, sessionToReattach.cwd);
            applySessionControls(active, parseSessionControls(raw));
            markReattached(active);
          } catch (err) {
            setLastError(`Couldn't reconnect "${sessionToReattach.title}": ${String(err)}`);
          }
        }
      })();
      await Promise.all([reattach, dwell(PHASE_MS)]);
      if (cancelled) return;
      setBootStatus("ready");
    })().catch((err) => {
      if (cancelled) return;
      setInitError(String(err));
      setBootStatus("error");
      setBootError(String(err));
    });

    return () => {
      cancelled = true;
    };
    // Only the retry button (bootAttempt) should ever re-run this — it's a
    // one-shot sequence otherwise, not something that reacts to store state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootAttempt]);

  // Any *other* persisted session becomes reattached lazily, on first select
  // — not during the splash (a CLI-imported history can be hundreds of
  // sessions; loading every stub's transcript up front is the exact "118MB
  // JSONL" cost Forge already avoided, see SLICE5.md). `reattachedSessionIds`
  // is what makes this idempotent per session per run — new sessions are
  // marked reattached at creation time (handleCreateSession) since
  // `session/new` already established their backend context.
  useEffect(() => {
    if (bootStatus !== "ready" || !activeSessionId) return;
    if (reattachedSessionIds.has(activeSessionId)) return;
    const session = sessions[activeSessionId];
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await loadSession(activeSessionId, session.cwd);
        if (!cancelled) {
          applySessionControls(activeSessionId, parseSessionControls(raw));
          markReattached(activeSessionId);
        }
      } catch (err) {
        if (!cancelled) setLastError(`Couldn't reconnect "${session.title}": ${String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, bootStatus]);

  async function handleCreateSession(cwd: string, yolo: boolean, modelId?: string) {
    setNewSessionDialogOpen(false);
    try {
      const { sessionId, raw } = await newSession(cwd, yolo, modelId);
      registerSession(sessionId, cwd, yolo, modelId);
      applySessionControls(sessionId, parseSessionControls(raw));
      // `session/new` already established this session's backend context —
      // the lazy on-select reattach effect would otherwise redundantly
      // `session/load` it the moment it becomes active (which it does,
      // immediately, via registerSession).
      markReattached(sessionId);
      // `_meta.modelId` on session/new is best-effort. If grok ignored it,
      // follow up with the dedicated ACP method so the picker isn't a lie.
      if (modelId) {
        const applied = useSessionStore.getState().sessions[sessionId]?.modelId;
        if (applied !== modelId) {
          try {
            await setSessionModel(sessionId, modelId);
            setSessionModelLocal(sessionId, modelId);
          } catch (err) {
            setLastError(`Session started, but model switch failed: ${String(err)}`);
          }
        }
      }
    } catch (err) {
      setLastError(`Couldn't start a session: ${String(err)}`);
    }
  }

  // Auto operator-dream: grok's own /dream (or 5 unique episodics + 24h)
  // marks us due; we only fire when the session is idle, and we never attach
  // — a pending candidate is the whole point (review in the Memory cockpit).
  useEffect(() => {
    if (!autoDream || !ready || !activeSessionId || !activeSession) return;
    if (activeSession.status !== "idle") return;
    if (operatorDreamRunning) return;
    if (pendingPermissions.some((p) => !p.sessionId || p.sessionId === activeSessionId)) return;
    const cwd = activeSession.cwd;
    const sessionId = activeSessionId;
    let cancelled = false;
    (async () => {
      if (await hasPendingDream(cwd)) {
        if (!cancelled && operatorDreamDue) {
          clearOperatorDreamDue();
          openDockTab("memory");
        }
        return;
      }
      let due = operatorDreamDue;
      if (!due) {
        const last = lastOperatorDreamAt ?? 0;
        if (Date.now() - last < AUTO_DREAM_MIN_MS) return;
        const n = await uniqueEpisodicCount(cwd);
        due = n >= AUTO_DREAM_MIN_EPISODICS;
      }
      if (!due || cancelled) return;
      setOperatorDreamRunning(true);
      clearOperatorDreamDue();
      try {
        const ok = await runOperatorDream(sessionId, cwd);
        if (cancelled) return;
        setLastOperatorDreamAt(Date.now());
        if (ok) {
          setMemoryStatusMessage("Dream ready for review");
          openDockTab("memory");
        }
      } catch (err) {
        if (!cancelled) setLastError(`Auto-dream failed: ${String(err)}`);
      } finally {
        if (!cancelled) setOperatorDreamRunning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDream, ready, activeSessionId, activeSession?.status, operatorDreamDue, pendingPermissions.length]);

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
        title={activeSession ? activeSession.title : "Anvil"}
        extra={
          activeSession && (
            <>
              <button
                onClick={toggleDiffsAutoExpand}
                title={diffsAutoExpand ? "Collapse all diffs" : "Show all diffs"}
                className={"gd-panel-tab" + (diffsAutoExpand ? " active" : "")}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="3" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.3" />
                  <rect x="9" y="3" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M4.5 6v4M11.5 6v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                Diffs
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
                Studio
              </button>
              {/* Always rendered now (was gated on memoryActiveThisRun) so the
                  right edge doesn't jump depending on whether memory happens
                  to be on this run — just dim/disabled when it's off. */}
              <button
                onClick={() => openDockTab("memory")}
                disabled={!memoryActiveThisRun}
                title={memoryActiveThisRun ? undefined : "Memory is off for this session"}
                className={"gd-panel-tab" + (activityDockOpen && dockTab === "memory" ? " active" : "")}
              >
                Memory
              </button>
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
                <div className="flex-1 min-h-0 relative">
                  <EmptyCanvas
                    kind="no-session"
                    onNewSession={() => setNewSessionDialogOpen(true)}
                    newSessionDisabled={!ready}
                  />
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
      <AnvilSplash
        status={bootStatus}
        errorMessage={bootError}
        onRetry={() => setBootAttempt((n) => n + 1)}
      />
      </div>
    </div>
  );
}
