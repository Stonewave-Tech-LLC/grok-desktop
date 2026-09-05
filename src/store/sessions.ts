import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AcpEvent, JsonValue } from "../types/acp";
import type { ModelInfo, RemoteSessionStub } from "../lib/api";
import { captureEpisodic, denyPermission, respondPermission } from "../lib/api";
import { emitAcpTap } from "../lib/acpTap";
import {
  FALLBACK_MODES,
  modeImpliesYolo,
  type SessionControls,
  type SessionMode,
} from "../lib/sessionControls";

// zustand's persist middleware writes on *every* set() call by default — fine
// for occasional UI-toggle changes, but handleSessionUpdate calls set() once
// per streamed token, and the persisted payload is the full session history
// (hundreds of KB once a conversation has any length — confirmed by reading
// the actual localStorage sqlite file during a live debugging session). Doing
// a full JSON.stringify + localStorage write on every single token during
// active streaming is exactly what made the whole app lag/hang while grok was
// working — it got worse over the session specifically because it scales with
// how much history had piled up. Debounce the actual write instead of
// throttling set() itself (which would also delay UI updates); a `pagehide`
// flush keeps a mid-burst quit from losing more than the last ~400ms.
function debouncedLocalStorage(delayMs: number) {
  let pendingValue: string | null = null;
  let pendingName: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pendingName !== null && pendingValue !== null) {
      localStorage.setItem(pendingName, pendingValue);
      pendingName = null;
      pendingValue = null;
    }
  }

  window.addEventListener("pagehide", flush);

  return {
    getItem: (name: string) => localStorage.getItem(name),
    removeItem: (name: string) => {
      pendingName = null;
      pendingValue = null;
      localStorage.removeItem(name);
    },
    setItem: (name: string, value: string) => {
      pendingName = name;
      pendingValue = value;
      if (timer) return;
      timer = setTimeout(flush, delayMs);
    },
  };
}

export interface TimelineItem {
  id: string;
  ts: number;
  sessionUpdate: string;
  toolCallId?: string;
  raw: Record<string, JsonValue>;
}

export interface ActivityItem {
  id: string;
  kind: "subagent" | "background_command";
  title: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  updatedAt: number;
  // subagent fields
  subagentType?: string;
  durationMs?: number;
  toolCallCount?: number;
  tokensUsed?: number;
  toolsUsed?: string[];
  output?: string;
  // background command fields
  command?: string;
  outputText?: string;
  exitCode?: number;
}

// Shape confirmed against grok-build's own source
// (crates/codegen/xai-grok-shell/src/session/workflow/notify.rs +
// extensions/notification.rs's `WorkflowUpdated` variant) — this is the real
// mechanism behind `/workflow` and `/goal` parallel-agent runs. There is no
// separate "arena mode": no arena/candidate/winner/promote code exists
// anywhere in the grok-build repo.
export interface WorkflowPhaseInfo {
  title: string;
  state: "done" | "active" | "pending";
}

export interface WorkflowAgentInfo {
  agentId: string;
  label: string;
  phase?: string;
  model?: string;
  state: string;
  tokensUsed: number;
  durationMs: number;
}

export interface WorkflowRun {
  runId: string;
  revision: number;
  name: string;
  objective: string;
  status: string;
  phases: WorkflowPhaseInfo[];
  currentPhase?: string;
  agentBudget?: number;
  agentsUsed: number;
  agentsRemaining?: number;
  elapsedMs: number;
  activeAgents: number;
  currentAgentLabel?: string;
  agents: WorkflowAgentInfo[];
  lastEvent?: string;
  lastEventDetail?: string;
  pauseMessage?: string;
  resultSummary?: string;
  updatedAt: number;
}

export type ImagineAspect = "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export interface ChatSession {
  id: string;
  cwd: string;
  title: string;
  createdAt: number;
  timeline: TimelineItem[];
  streamingText: string;
  status: "idle" | "thinking" | "streaming" | "error";
  activity: Record<string, ActivityItem>;
  activityOrder: string[];
  yolo: boolean;
  modelId?: string;
  modeId?: string;
  availableModels?: ModelInfo["availableModels"];
  availableModes?: SessionMode[];
  // Latest turn's total (input+output, includes cache reads) — a proxy for
  // "how full is the context window right now", not cumulative spend. Reset
  // by nothing; each turn just overwrites it.
  contextTokensUsed?: number;
  // Cumulative across the whole session — the actual cost-cockpit numbers.
  // costCumulativeUsdTicks only sums turns whose usage was trustworthy (see
  // handleXaiNotification's turn_completed branch for the trust rule grok's
  // own source documents); costEstimated flips true the first time a turn's
  // cost had to be excluded, so the UI can mark the total as a floor.
  tokensCumulative: number;
  costCumulativeUsdTicks: number;
  costEstimated: boolean;
  workflows: Record<string, WorkflowRun>;
  workflowOrder: string[];
}

export interface PendingPermission {
  id: JsonValue;
  sessionId?: string;
  method: string;
  params: Record<string, JsonValue>;
}

interface DebugLogLine {
  ts: number;
  line: string;
}

interface SessionStoreState {
  ready: boolean;
  initError?: string;
  sessions: Record<string, ChatSession>;
  sessionOrder: string[];
  activeSessionId?: string;
  pendingPermissions: PendingPermission[];
  activityDockOpen: boolean;
  dockTab: "activity" | "workflows" | "memory" | "assets";
  diffsAutoExpand: boolean;
  debugLog: DebugLogLine[];
  lastError?: string;
  // Mirrors of Rust-owned state (~/.grok-desktop/config.json + GrokState) —
  // deliberately not persisted here (see partialize below): that config file
  // is already the authoritative source (it has to be, read before this store
  // even exists), so re-fetching on launch avoids a second copy that could
  // drift. memoryEnabled is the saved (next-restart) value; memoryActiveThisRun
  // is whether the currently-running grok process actually has it on.
  memoryEnabled: boolean;
  memoryActiveThisRun: boolean;
  memoryStatusMessage?: string;
  // A one-shot prefill for the Composer's input — set by things outside the
  // Composer itself (e.g. AssetsPanel's "Regenerate" button) that want to hand
  // it a draft without lifting the Composer's own text state up into the
  // store. Composer consumes it via useEffect and clears it right after, so
  // it never persists or refires. Deliberately not persisted (see partialize).
  composerDraft?: string;
  // Process-level model catalog from initialize `_meta.modelState`. A
  // session's live selection is `ChatSession.modelId`; this is the fallback
  // list so the picker still has names before session/new returns modes.
  modelCatalog?: ModelInfo;
  defaultYolo: boolean;
  defaultModelId?: string;
  imagineAutoOpen: boolean;
  imagineDefaultAspect: ImagineAspect;
  lastWorkspace?: string;
  // Operator dream auto-trigger (copy-on-write candidate, never auto-attach).
  // autoDream + lastOperatorDreamAt persist; due/running are this-process only.
  autoDream: boolean;
  lastOperatorDreamAt?: number;
  operatorDreamDue: boolean;
  operatorDreamRunning: boolean;
  // Sessions with a turn WE started this process (via appendUserMessage) and
  // haven't yet seen finalized (finalizeTurn / turn_completed). Deliberately
  // NOT persisted (see partialize below) — it exists only to stop a reattached
  // session's leftover/replayed chunks from resurrecting a "streaming" status
  // for a turn nobody in this run is actually waiting on. See handleSessionUpdate.
  activeTurnSessionIds: Set<string>;
  // Sessions whose backend context has been (re)established this process —
  // via `session/new` at creation time or `session/load` on reattach/select.
  // Drives the slice-5 lazy-import behavior: a CLI-imported stub's timeline
  // is empty until its first `session/load`, and this set is what stops that
  // load from firing more than once per session per run. Deliberately NOT
  // persisted (see partialize below) — it describes *this process's* live
  // ACP connection, meaningless across a restart.
  reattachedSessionIds: Set<string>;

  setReady: (ready: boolean) => void;
  setInitError: (msg: string) => void;
  setLastError: (msg?: string) => void;
  registerSession: (id: string, cwd: string, yolo: boolean, modelId?: string) => void;
  applySessionControls: (id: string, controls: SessionControls) => void;
  setSessionModelLocal: (id: string, modelId: string) => void;
  setSessionModeLocal: (id: string, modeId: string) => void;
  setModelCatalog: (info: ModelInfo) => void;
  setDefaultYolo: (v: boolean) => void;
  setDefaultModelId: (id?: string) => void;
  setImagineAutoOpen: (v: boolean) => void;
  setImagineDefaultAspect: (v: ImagineAspect) => void;
  setLastWorkspace: (cwd: string) => void;
  setAutoDream: (v: boolean) => void;
  markOperatorDreamDue: () => void;
  clearOperatorDreamDue: () => void;
  setOperatorDreamRunning: (v: boolean) => void;
  setLastOperatorDreamAt: (ms: number) => void;
  setActiveSession: (id: string) => void;
  appendUserMessage: (sessionId: string, text: string) => void;
  handleAcpEvent: (event: AcpEvent) => void;
  resolvePermission: (id: JsonValue) => void;
  toggleActivityDock: (open?: boolean) => void;
  openDockTab: (tab: "activity" | "workflows" | "memory" | "assets") => void;
  toggleDiffsAutoExpand: () => void;
  setMemoryEnabled: (v: boolean) => void;
  setMemoryActiveThisRun: (v: boolean) => void;
  setMemoryStatusMessage: (msg?: string) => void;
  setComposerDraft: (text?: string) => void;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  finalizeTurn: (sessionId: string) => void;
  markReattached: (sessionId: string) => void;
  // Adds grok CLI sessions (from `list_sessions`) as empty-timeline stubs for
  // any sessionId not already known locally — never overwrites an existing
  // entry (this app's own persisted history always wins). Appended after the
  // existing sessionOrder rather than interleaved by recency: this app's own
  // sessions are already ordered by creation (LIFO, see registerSession), and
  // grok's `updatedAt` isn't a comparable creation timestamp to sort against.
  mergeRemoteSessions: (remote: RemoteSessionStub[]) => void;
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function asRecord(v: JsonValue): Record<string, JsonValue> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JsonValue>) : {};
}

function asArray(v: JsonValue): JsonValue[] {
  return Array.isArray(v) ? v : [];
}

function extractOutputForPrompt(update: Record<string, JsonValue>): string | undefined {
  const rawOutput = asRecord(update.rawOutput);
  if (typeof rawOutput.output_for_prompt === "string") return rawOutput.output_for_prompt;
  const content = asArray(update.content);
  for (const c of content) {
    const rec = asRecord(c);
    const inner = asRecord(rec.content);
    if (typeof inner.text === "string") return inner.text;
  }
  return undefined;
}

const SILENT_KINDS = new Set(["available_commands_update", "session_info_update", "user_message_chunk"]);

function isBackgroundToolCall(update: Record<string, JsonValue>): boolean {
  // `background: true` alone isn't a reliable signal — spawn_subagent also
  // accepts a `background` param (for non-blocking subagents), and that's
  // tracked separately via the _x.ai/session_notification subagent_* events,
  // not here. Only run_terminal_command's own background launches count.
  const meta = asRecord(asRecord(update._meta)["x.ai/tool"]);
  const isTerminalCommand = meta.name === "run_terminal_command" || update.title === "run_terminal_command";
  if (!isTerminalCommand) return false;
  const rawInput = asRecord(update.rawInput);
  const rawOutput = asRecord(update.rawOutput);
  return rawInput.background === true || rawInput.is_background === true || rawOutput.type === "BackgroundTaskStarted";
}

export const useSessionStore = create<SessionStoreState>()(
  persist(
    (set) => ({
  ready: false,
  sessions: {},
  sessionOrder: [],
  pendingPermissions: [],
  activityDockOpen: false,
  dockTab: "activity",
  diffsAutoExpand: false,
  debugLog: [],
  activeTurnSessionIds: new Set(),
  reattachedSessionIds: new Set(),
  memoryEnabled: false,
  memoryActiveThisRun: false,
  defaultYolo: false,
  imagineAutoOpen: true,
  imagineDefaultAspect: "auto",
  autoDream: true,
  operatorDreamDue: false,
  operatorDreamRunning: false,

  setReady: (ready) => set({ ready }),
  setInitError: (msg) => set({ initError: msg }),
  setLastError: (msg) => set({ lastError: msg }),
  setMemoryEnabled: (v) => set({ memoryEnabled: v }),
  setMemoryActiveThisRun: (v) => set({ memoryActiveThisRun: v }),
  setMemoryStatusMessage: (msg) => set({ memoryStatusMessage: msg }),
  setComposerDraft: (text) => set({ composerDraft: text }),
  setModelCatalog: (info) => set({ modelCatalog: info }),
  setDefaultYolo: (v) => set({ defaultYolo: v }),
  setDefaultModelId: (id) => set({ defaultModelId: id }),
  setImagineAutoOpen: (v) => set({ imagineAutoOpen: v }),
  setImagineDefaultAspect: (v) => set({ imagineDefaultAspect: v }),
  setLastWorkspace: (cwd) => set({ lastWorkspace: cwd }),
  setAutoDream: (v) => set({ autoDream: v }),
  markOperatorDreamDue: () => set({ operatorDreamDue: true }),
  clearOperatorDreamDue: () => set({ operatorDreamDue: false }),
  setOperatorDreamRunning: (v) => set({ operatorDreamRunning: v }),
  setLastOperatorDreamAt: (ms) => set({ lastOperatorDreamAt: ms }),

  registerSession: (id, cwd, yolo, modelId) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [id]: {
          id,
          cwd,
          title: cwd.split("/").filter(Boolean).pop() || "Session",
          createdAt: Date.now(),
          timeline: [],
          streamingText: "",
          status: "idle",
          activity: {},
          activityOrder: [],
          yolo,
          modelId,
          modeId: yolo ? "bypassPermissions" : "default",
          availableModes: FALLBACK_MODES,
          availableModels: s.modelCatalog?.availableModels,
          tokensCumulative: 0,
          costCumulativeUsdTicks: 0,
          costEstimated: false,
          workflows: {},
          workflowOrder: [],
        },
      },
      sessionOrder: [id, ...s.sessionOrder],
      activeSessionId: id,
      lastWorkspace: cwd,
    })),

  applySessionControls: (id, controls) =>
    set((s) => {
      const session = s.sessions[id];
      if (!session) return {};
      const modeId = controls.modeId ?? session.modeId;
      return {
        sessions: {
          ...s.sessions,
          [id]: {
            ...session,
            modelId: controls.modelId ?? session.modelId,
            modeId,
            availableModels: controls.availableModels ?? session.availableModels,
            availableModes: controls.availableModes ?? session.availableModes ?? FALLBACK_MODES,
            yolo: modeId ? modeImpliesYolo(modeId) : session.yolo,
          },
        },
      };
    }),

  setSessionModelLocal: (id, modelId) =>
    set((s) => {
      const session = s.sessions[id];
      if (!session) return {};
      return { sessions: { ...s.sessions, [id]: { ...session, modelId } } };
    }),

  setSessionModeLocal: (id, modeId) =>
    set((s) => {
      const session = s.sessions[id];
      if (!session) return {};
      return {
        sessions: {
          ...s.sessions,
          [id]: { ...session, modeId, yolo: modeImpliesYolo(modeId) },
        },
      };
    }),

  setActiveSession: (id) => set({ activeSessionId: id }),

  appendUserMessage: (sessionId, text) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return {};
      // If the previous turn's trailing text hasn't been flushed into the
      // timeline yet (finalizeTurn runs when session/prompt resolves, which can
      // lag slightly behind the last visible chunk), flush it first — otherwise
      // it keeps rendering in the always-last streamingText slot, appearing
      // *below* this new message instead of where it actually belongs.
      let timeline = session.timeline;
      if (session.streamingText) {
        timeline = [
          ...timeline,
          { id: uid(), ts: Date.now(), sessionUpdate: "agent_message_final", raw: { text: session.streamingText } },
        ];
      }
      const item: TimelineItem = { id: uid(), ts: Date.now(), sessionUpdate: "user_message", raw: { text } };
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...session, timeline: [...timeline, item], streamingText: "", status: "thinking" },
        },
        activeTurnSessionIds: new Set(s.activeTurnSessionIds).add(sessionId),
      };
    }),

  handleAcpEvent: (event) => {
    // Fan out first so an out-of-band dream worker can collect chunks for
    // a sessionId we deliberately never registered in the visible store.
    emitAcpTap(event);

    if (event.kind === "stderr") {
      set((s) => ({ debugLog: [...s.debugLog.slice(-500), { ts: Date.now(), line: event.line }] }));
      return;
    }

    if (event.kind === "process_exited") {
      set((s) => ({
        debugLog: [...s.debugLog, { ts: Date.now(), line: `[process exited] code=${event.code ?? "unknown"}` }],
      }));
      return;
    }

    if (event.kind === "incoming_request") {
      const params = asRecord(event.params);
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
      // Out-of-band dream workers are never registered in the visible store.
      // If yolo didn't swallow the prompt, grant rather than hang the curator
      // (and rather than surfacing a permission card on a session the user
      // can't select).
      if (sessionId && !useSessionStore.getState().sessions[sessionId]) {
        const options = asArray(params.options);
        let optionId = "allow-once";
        for (const o of options) {
          const rec = asRecord(o);
          if (typeof rec.optionId !== "string") continue;
          if (rec.kind === "allow_once" || rec.kind === "allow_always" || rec.optionId.includes("allow")) {
            optionId = rec.optionId;
            break;
          }
        }
        respondPermission(event.id, optionId).catch(() => {
          denyPermission(event.id).catch(() => {});
        });
        return;
      }
      set((s) => ({
        pendingPermissions: [...s.pendingPermissions, { id: event.id, sessionId, method: event.method, params }],
      }));
      return;
    }

    // notification — grok splits real activity across two methods; see
    // docs/protocol-notes/README.md. Standard ACP tool calls/messages live on
    // session/update; subagent lifecycle only ever appears on
    // _x.ai/session_notification.
    if (event.method === "session/update") {
      handleSessionUpdate(event.params, set);
    } else if (event.method === "_x.ai/session_notification") {
      handleXaiNotification(event.params, set);
    }
  },

  resolvePermission: (id) =>
    set((s) => ({
      pendingPermissions: s.pendingPermissions.filter((p) => JSON.stringify(p.id) !== JSON.stringify(id)),
    })),

  toggleActivityDock: (open) => set((s) => ({ activityDockOpen: open ?? !s.activityDockOpen })),
  openDockTab: (tab) =>
    set((s) => (s.activityDockOpen && s.dockTab === tab ? { activityDockOpen: false } : { activityDockOpen: true, dockTab: tab })),
  toggleDiffsAutoExpand: () => set((s) => ({ diffsAutoExpand: !s.diffsAutoExpand })),

  renameSession: (id, title) =>
    set((s) => {
      const session = s.sessions[id];
      if (!session) return {};
      return { sessions: { ...s.sessions, [id]: { ...session, title } } };
    }),

  deleteSession: (id) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.sessions;
      const sessionOrder = s.sessionOrder.filter((sid) => sid !== id);
      const activeSessionId = s.activeSessionId === id ? sessionOrder[0] : s.activeSessionId;
      return { sessions: rest, sessionOrder, activeSessionId };
    }),

  markReattached: (sessionId) =>
    set((s) => ({ reattachedSessionIds: new Set(s.reattachedSessionIds).add(sessionId) })),

  mergeRemoteSessions: (remote) =>
    set((s) => {
      const sessions = { ...s.sessions };
      const additions: string[] = [];
      for (const r of remote) {
        if (sessions[r.sessionId]) continue;
        sessions[r.sessionId] = {
          id: r.sessionId,
          cwd: r.cwd,
          title: r.title || r.cwd.split("/").filter(Boolean).pop() || "Session",
          createdAt: r.updatedAt ?? Date.now(),
          timeline: [],
          streamingText: "",
          status: "idle",
          activity: {},
          activityOrder: [],
          yolo: r.yolo,
          modeId: r.yolo ? "bypassPermissions" : "default",
          availableModes: FALLBACK_MODES,
          tokensCumulative: 0,
          costCumulativeUsdTicks: 0,
          costEstimated: false,
          workflows: {},
          workflowOrder: [],
        };
        additions.push(r.sessionId);
      }
      if (additions.length === 0) return {};
      return { sessions, sessionOrder: [...s.sessionOrder, ...additions] };
    }),

  // `session/prompt` resolving is the actual ACP signal that a turn ended — nothing
  // in the session/update stream itself flips status back to idle, so without this
  // the composer's stop button would stay showing forever after grok finishes.
  finalizeTurn: (sessionId) =>
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return {};
      let timeline = session.timeline;
      if (session.streamingText) {
        timeline = [
          ...timeline,
          { id: uid(), ts: Date.now(), sessionUpdate: "agent_message_final", raw: { text: session.streamingText } },
        ];
      }
      const activeTurnSessionIds = new Set(s.activeTurnSessionIds);
      activeTurnSessionIds.delete(sessionId);
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...session, timeline, streamingText: "", status: "idle" },
        },
        activeTurnSessionIds,
      };
    }),
    }),
    {
      name: "grok-desktop-sessions",
      // Debounced so a streaming response's per-token set() calls don't each
      // trigger a full disk write — see debouncedLocalStorage above.
      storage: createJSONStorage(() => debouncedLocalStorage(400)),
      // Only session data survives a restart — connection state, pending
      // permissions, and UI toggles are all tied to *this* process's live ACP
      // connection and would be meaningless (or actively wrong) if restored.
      // streamingText is stripped: it's mid-turn accumulator state that
      // finalizeTurn/turn_completed always flushes into the timeline before
      // it'd matter, so persisting it is pure write volume for no benefit.
      partialize: (s) => ({
        sessions: Object.fromEntries(
          Object.entries(s.sessions).map(([id, session]) => [id, { ...session, streamingText: "" }])
        ),
        sessionOrder: s.sessionOrder,
        activeSessionId: s.activeSessionId,
        diffsAutoExpand: s.diffsAutoExpand,
        defaultYolo: s.defaultYolo,
        defaultModelId: s.defaultModelId,
        imagineAutoOpen: s.imagineAutoOpen,
        imagineDefaultAspect: s.imagineDefaultAspect,
        lastWorkspace: s.lastWorkspace,
        autoDream: s.autoDream,
        lastOperatorDreamAt: s.lastOperatorDreamAt,
      }),
      // A restored session's status ("streaming"/"thinking") describes a turn
      // that died with the old process — without normalizing it here, the
      // composer would show a stop button for a request that will never
      // resolve. `merge` is the hook that actually produces the state zustand
      // applies via setState — onRehydrateStorage's callback fires *after*
      // that setState already happened, so mutating its argument there is a
      // no-op that never triggers a re-render (this was the actual bug).
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<SessionStoreState>) };
        const sessions: Record<string, ChatSession> = {};
        for (const [id, session] of Object.entries(merged.sessions)) {
          sessions[id] = {
            ...session,
            status: "idle",
            streamingText: "",
            yolo: session.yolo ?? false,
            modeId: session.modeId ?? (session.yolo ? "bypassPermissions" : "default"),
            availableModes: session.availableModes ?? FALLBACK_MODES,
            tokensCumulative: session.tokensCumulative ?? 0,
            costCumulativeUsdTicks: session.costCumulativeUsdTicks ?? 0,
            costEstimated: session.costEstimated ?? false,
            workflows: session.workflows ?? {},
            workflowOrder: session.workflowOrder ?? [],
          };
        }
        return { ...merged, sessions };
      },
    }
  )
);

type Setter = (fn: (s: SessionStoreState) => Partial<SessionStoreState>) => void;

function handleSessionUpdate(params: JsonValue, set: Setter) {
  const p = asRecord(params);
  const sessionId = typeof p.sessionId === "string" ? p.sessionId : undefined;
  if (!sessionId) return;

  const update = asRecord(p.update);
  const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "unknown";
  const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : undefined;

  // Pure bookkeeping — no visible content, and (critically) high-frequency
  // enough that treating them like any other update would flush in-progress
  // streamed text mid-message, fragmenting markdown that spans the flush
  // boundary (e.g. splitting a table in two). Drop them before they can
  // touch streamingText at all.
  if (kind === "current_mode_update" || kind === "current_model_update") {
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return {};
      const modeId =
        (typeof update.currentModeId === "string" && update.currentModeId) ||
        (typeof update.modeId === "string" && update.modeId) ||
        session.modeId;
      const modelId =
        (typeof update.currentModelId === "string" && update.currentModelId) ||
        (typeof update.modelId === "string" && update.modelId) ||
        session.modelId;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            modeId,
            modelId,
            yolo: modeId ? modeImpliesYolo(modeId) : session.yolo,
          },
        },
      };
    });
    return;
  }

  if (SILENT_KINDS.has(kind)) return;

  set((s) => {
    const session = s.sessions[sessionId];
    if (!session) return {};

    // A reattached session can receive leftover/replayed chunks for a turn
    // nobody in this process asked for (e.g. one that never got a terminal
    // signal before the app quit or crashed last time) — only a turn WE
    // started this run via appendUserMessage should be allowed to drive the
    // "streaming"/"thinking" status, or the stop button gets stuck showing
    // work that isn't actually happening. Content still records normally.
    const isActiveTurn = s.activeTurnSessionIds.has(sessionId);

    let streamingText = session.streamingText;
    let status = session.status;
    let timeline = session.timeline;
    let activity = session.activity;
    let activityOrder = session.activityOrder;

    if (kind === "agent_message_chunk") {
      const content = asRecord(update.content);
      streamingText += typeof content.text === "string" ? content.text : "";
      if (isActiveTurn) status = "streaming";
    } else if (kind === "agent_thought_chunk") {
      if (isActiveTurn) status = "thinking";
      const content = asRecord(update.content);
      const text = typeof content.text === "string" ? content.text : "";
      const last = timeline[timeline.length - 1];
      // thought chunks arrive token-by-token; coalesce into the previous
      // thought item instead of one timeline entry per token.
      if (last && last.sessionUpdate === "agent_thought_chunk") {
        timeline = [
          ...timeline.slice(0, -1),
          { ...last, raw: { ...last.raw, content: { type: "text", text: (String(asRecord(last.raw.content).text ?? "")) + text } } },
        ];
      } else {
        timeline = [...timeline, { id: uid(), ts: Date.now(), sessionUpdate: kind, raw: update }];
      }
    } else if (kind === "tool_call" || kind === "tool_call_update") {
      if (streamingText) {
        timeline = [...timeline, { id: uid(), ts: Date.now(), sessionUpdate: "agent_message_final", raw: { text: streamingText } }];
        streamingText = "";
      }
      const existingIdx = toolCallId ? timeline.findIndex((t) => t.toolCallId === toolCallId) : -1;
      if (existingIdx >= 0) {
        const existing = timeline[existingIdx];
        const merged = { ...existing.raw, ...update };
        timeline = [...timeline];
        timeline[existingIdx] = { ...existing, raw: merged };
      } else {
        timeline = [...timeline, { id: uid(), ts: Date.now(), sessionUpdate: kind, toolCallId, raw: update }];
      }

      if (toolCallId && isBackgroundToolCall(update)) {
        const isDone = update.status === "completed" || update.status === "failed";
        const existingActivity = activity[toolCallId];
        const command =
          (typeof asRecord(update.rawInput).command === "string" && String(asRecord(update.rawInput).command)) ||
          existingActivity?.command ||
          (typeof update.title === "string" ? update.title : "Background command");
        const chunk = extractOutputForPrompt(update);
        activity = {
          ...activity,
          [toolCallId]: {
            id: toolCallId,
            kind: "background_command",
            title: command,
            status: isDone ? (update.status === "failed" ? "failed" : "completed") : "running",
            startedAt: existingActivity?.startedAt ?? Date.now(),
            updatedAt: Date.now(),
            command,
            outputText: chunk ? (existingActivity?.outputText ?? "") + chunk : existingActivity?.outputText,
            exitCode: typeof asRecord(update.rawOutput).exit_code === "number" ? (asRecord(update.rawOutput).exit_code as number) : existingActivity?.exitCode,
          },
        };
        if (!activityOrder.includes(toolCallId)) activityOrder = [toolCallId, ...activityOrder];
      }
    } else {
      if (streamingText) {
        timeline = [...timeline, { id: uid(), ts: Date.now(), sessionUpdate: "agent_message_final", raw: { text: streamingText } }];
        streamingText = "";
      }
      timeline = [...timeline, { id: uid(), ts: Date.now(), sessionUpdate: kind, raw: update }];
    }

    return { sessions: { ...s.sessions, [sessionId]: { ...session, timeline, streamingText, status, activity, activityOrder } } };
  });
}

function handleXaiNotification(params: JsonValue, set: Setter) {
  const p = asRecord(params);
  const sessionId = typeof p.sessionId === "string" ? p.sessionId : undefined;
  if (!sessionId) return;
  const update = asRecord(p.update);
  const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";

  // Memory notifications (confirmed shapes from grok-build's own source,
  // extensions/notification.rs) are global, not session-scoped in the UI —
  // they drive a transient toast, not any particular ChatSession's state, so
  // they're handled before the sessionId-dependent branches below. No shared
  // ID between a `_started` and its matching `_completed`, so each one just
  // independently produces its own toast text rather than a spinner sequence.
  //
  // Operator memory hook (docs/OPERATOR_MEMORY.md, diamond 2): grok's own
  // /flush and /dream already do the grading work — a `result`/`summary`
  // text field here is genuinely already-distilled content, not a raw
  // transcript. Promoting it into a durable, typed, bridged episodic entry
  // is the entire curation trigger; nothing here asks the live coding
  // session to save anything mid-turn. Best-effort (fire-and-forget) so a
  // write failure never blocks the toast or anything else.
  const promoteToEpisodic = (trigger: string) => {
    const resultRaw = update.result ?? update.summary;
    const result = typeof resultRaw === "string" ? resultRaw.trim() : "";
    if (result.length < 20) return;
    const cwd = useSessionStore.getState().sessions[sessionId]?.cwd;
    if (!cwd) return;
    captureEpisodic("project", trigger, result, cwd).catch(() => {});
  };

  if (kind === "memory_flush_started") {
    set(() => ({ memoryStatusMessage: "Saving memory…" }));
    return;
  }
  if (kind === "memory_flush_completed") {
    const result = typeof update.result === "string" ? update.result : undefined;
    set(() => ({ memoryStatusMessage: result ? `Memory saved: ${result.slice(0, 80)}` : "Memory saved" }));
    promoteToEpisodic("grok flush");
    return;
  }
  if (kind === "memory_dream_completed") {
    set(() => ({ memoryStatusMessage: "Memory consolidated", operatorDreamDue: true }));
    promoteToEpisodic("grok dream");
    return;
  }
  if (kind === "memory_session_saved") {
    set(() => ({ memoryStatusMessage: "Session memory saved" }));
    promoteToEpisodic("grok session save");
    return;
  }

  // Confirmed against grok-build's own source (PromptUsage/PromptUsageModel in
  // extensions/notification.rs): `usage.totalTokens` is THIS TURN's input+output
  // (a proxy for current context fullness, since chat-completion APIs resend the
  // whole history as input each turn) — not a running session total. Cost is
  // only trustworthy when present *and* neither flag below is set; the source's
  // own doc comment is explicit that absence of cost means "unknown", not "free".
  if (kind === "turn_completed") {
    // grok's own source calls this "the durable, replayable signal that a turn
    // reached its terminal outcome... so a viewer that re-attaches mid-turn can
    // finalize the turn from replay instead of staying stuck on 'Waiting…'" —
    // exactly our reattach-after-restart case. `finalizeTurn` (fired when
    // `session/prompt`'s own RPC promise resolves) used to be the only thing
    // that ever reset `status`; if the app quit before that promise settled,
    // the persisted status stayed "streaming"/"thinking" until this replayed
    // event arrived — which we received but ignored for `status` entirely.
    const usage = asRecord(update.usage);
    const totalTokens = typeof usage.totalTokens === "number" ? usage.totalTokens : undefined;
    const costUsdTicks = typeof usage.costUsdTicks === "number" ? usage.costUsdTicks : undefined;
    const usageIsIncomplete = usage.usageIsIncomplete === true;
    const costIsPartial = usage.costIsPartial === true;
    const trustworthyCost = costUsdTicks !== undefined && !usageIsIncomplete && !costIsPartial;
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return {};
      let timeline = session.timeline;
      if (session.streamingText) {
        timeline = [
          ...timeline,
          { id: uid(), ts: Date.now(), sessionUpdate: "agent_message_final", raw: { text: session.streamingText } },
        ];
      }
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            timeline,
            streamingText: "",
            status: "idle",
            contextTokensUsed: totalTokens ?? session.contextTokensUsed,
            tokensCumulative: session.tokensCumulative + (totalTokens ?? 0),
            costCumulativeUsdTicks: session.costCumulativeUsdTicks + (trustworthyCost ? (costUsdTicks as number) : 0),
            costEstimated: session.costEstimated || !trustworthyCost,
          },
        },
        activeTurnSessionIds: (() => {
          const next = new Set(s.activeTurnSessionIds);
          next.delete(sessionId);
          return next;
        })(),
      };
    });
    return;
  }

  if (kind === "workflow_updated") {
    const runId = typeof update.run_id === "string" ? update.run_id : undefined;
    if (!runId) return;
    const phases = asArray(update.phases).map((p) => {
      const rec = asRecord(p);
      return {
        title: typeof rec.title === "string" ? rec.title : "",
        state: (rec.state === "done" || rec.state === "active" ? rec.state : "pending") as WorkflowPhaseInfo["state"],
      };
    });
    const agents = asArray(update.agents).map((a) => {
      const rec = asRecord(a);
      return {
        agentId: typeof rec.agent_id === "string" ? rec.agent_id : "",
        label: typeof rec.label === "string" ? rec.label : "Agent",
        phase: typeof rec.phase === "string" ? rec.phase : undefined,
        model: typeof rec.model === "string" ? rec.model : undefined,
        state: typeof rec.state === "string" ? rec.state : "unknown",
        tokensUsed: typeof rec.tokens_used === "number" ? rec.tokens_used : 0,
        durationMs: typeof rec.duration_ms === "number" ? rec.duration_ms : 0,
      };
    });
    const run: WorkflowRun = {
      runId,
      revision: typeof update.revision === "number" ? update.revision : 0,
      name: typeof update.name === "string" ? update.name : "Workflow",
      objective: typeof update.objective === "string" ? update.objective : "",
      status: typeof update.status === "string" ? update.status : "active",
      phases,
      currentPhase: typeof update.current_phase === "string" ? update.current_phase : undefined,
      agentBudget: typeof update.agent_budget === "number" ? update.agent_budget : undefined,
      agentsUsed: typeof update.agents_used === "number" ? update.agents_used : 0,
      agentsRemaining: typeof update.agents_remaining === "number" ? update.agents_remaining : undefined,
      elapsedMs: typeof update.elapsed_ms === "number" ? update.elapsed_ms : 0,
      activeAgents: typeof update.active_agents === "number" ? update.active_agents : 0,
      currentAgentLabel: typeof update.current_agent_label === "string" ? update.current_agent_label : undefined,
      agents,
      lastEvent: typeof update.last_event === "string" ? update.last_event : undefined,
      lastEventDetail: typeof update.last_event_detail === "string" ? update.last_event_detail : undefined,
      pauseMessage: typeof update.pause_message === "string" ? update.pause_message : undefined,
      resultSummary: typeof update.result_summary === "string" ? update.result_summary : undefined,
      updatedAt: Date.now(),
    };
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return {};
      const workflowOrder = session.workflowOrder.includes(runId) ? session.workflowOrder : [runId, ...session.workflowOrder];
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...session, workflows: { ...session.workflows, [runId]: run }, workflowOrder },
        },
      };
    });
    return;
  }

  if (kind === "model_changed") {
    const modelId =
      (typeof update.modelId === "string" && update.modelId) ||
      (typeof update.model === "string" && update.model) ||
      (typeof update.currentModelId === "string" && update.currentModelId) ||
      undefined;
    if (!modelId) return;
    set((s) => {
      const session = s.sessions[sessionId];
      if (!session) return {};
      return { sessions: { ...s.sessions, [sessionId]: { ...session, modelId } } };
    });
    return;
  }

  if (kind !== "subagent_spawned" && kind !== "subagent_progress" && kind !== "subagent_finished") return;

  const subagentId = typeof update.subagent_id === "string" ? update.subagent_id : undefined;
  if (!subagentId) return;

  set((s) => {
    const session = s.sessions[sessionId];
    if (!session) return {};

    const existing = session.activity[subagentId];
    let item: ActivityItem;

    if (kind === "subagent_spawned") {
      item = {
        id: subagentId,
        kind: "subagent",
        title: typeof update.description === "string" ? update.description : "Subagent",
        status: "running",
        startedAt: Date.now(),
        updatedAt: Date.now(),
        subagentType: typeof update.subagent_type === "string" ? update.subagent_type : undefined,
      };
    } else if (kind === "subagent_progress") {
      item = {
        ...(existing ?? { id: subagentId, kind: "subagent", title: "Subagent", status: "running", startedAt: Date.now() }),
        updatedAt: Date.now(),
        durationMs: typeof update.duration_ms === "number" ? update.duration_ms : undefined,
        toolCallCount: typeof update.tool_call_count === "number" ? update.tool_call_count : undefined,
        tokensUsed: typeof update.tokens_used === "number" ? update.tokens_used : undefined,
        toolsUsed: Array.isArray(update.tools_used) ? (update.tools_used as string[]) : undefined,
      };
    } else {
      item = {
        ...(existing ?? { id: subagentId, kind: "subagent", title: "Subagent", startedAt: Date.now() }),
        status: update.status === "completed" ? "completed" : "failed",
        updatedAt: Date.now(),
        durationMs: typeof update.duration_ms === "number" ? update.duration_ms : existing?.durationMs,
        toolCallCount: typeof update.tool_calls === "number" ? update.tool_calls : existing?.toolCallCount,
        tokensUsed: typeof update.tokens_used === "number" ? update.tokens_used : existing?.tokensUsed,
        output: typeof update.output === "string" ? update.output : undefined,
      };
    }

    const activityOrder = session.activityOrder.includes(subagentId)
      ? session.activityOrder
      : [subagentId, ...session.activityOrder];

    return {
      sessions: {
        ...s.sessions,
        [sessionId]: {
          ...session,
          activity: { ...session.activity, [subagentId]: item },
          activityOrder,
        },
      },
    };
  });
}
