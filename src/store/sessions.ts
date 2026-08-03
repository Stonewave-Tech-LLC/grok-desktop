import { create } from "zustand";
import type { AcpEvent, JsonValue } from "../types/acp";

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
  debugLog: DebugLogLine[];
  lastError?: string;

  setReady: (ready: boolean) => void;
  setInitError: (msg: string) => void;
  setLastError: (msg?: string) => void;
  registerSession: (id: string, cwd: string) => void;
  setActiveSession: (id: string) => void;
  appendUserMessage: (sessionId: string, text: string) => void;
  handleAcpEvent: (event: AcpEvent) => void;
  resolvePermission: (id: JsonValue) => void;
  toggleActivityDock: (open?: boolean) => void;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  finalizeTurn: (sessionId: string) => void;
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

export const useSessionStore = create<SessionStoreState>((set) => ({
  ready: false,
  sessions: {},
  sessionOrder: [],
  pendingPermissions: [],
  activityDockOpen: false,
  debugLog: [],

  setReady: (ready) => set({ ready }),
  setInitError: (msg) => set({ initError: msg }),
  setLastError: (msg) => set({ lastError: msg }),

  registerSession: (id, cwd) =>
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
        },
      },
      sessionOrder: [id, ...s.sessionOrder],
      activeSessionId: id,
    })),

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
      };
    }),

  handleAcpEvent: (event) => {
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
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...session, timeline, streamingText: "", status: "idle" },
        },
      };
    }),
}));

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
  if (SILENT_KINDS.has(kind)) return;

  set((s) => {
    const session = s.sessions[sessionId];
    if (!session) return {};

    let streamingText = session.streamingText;
    let status = session.status;
    let timeline = session.timeline;
    let activity = session.activity;
    let activityOrder = session.activityOrder;

    if (kind === "agent_message_chunk") {
      const content = asRecord(update.content);
      streamingText += typeof content.text === "string" ? content.text : "";
      status = "streaming";
    } else if (kind === "agent_thought_chunk") {
      status = "thinking";
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
