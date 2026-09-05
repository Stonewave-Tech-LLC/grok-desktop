import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { AcpEvent, JsonValue } from "../types/acp";

export async function defaultCwd(): Promise<string> {
  return invoke("default_cwd");
}

export async function newSession(cwd: string, yolo = false): Promise<{ sessionId: string }> {
  const result = (await invoke("new_session", { cwd, yolo })) as JsonValue;
  const sessionId = (result as Record<string, JsonValue>)?.sessionId;
  if (typeof sessionId !== "string") {
    throw new Error(`session/new did not return a sessionId: ${JSON.stringify(result)}`);
  }
  return { sessionId };
}

/// Reattaches a session created in a previous app run so new prompts continue
/// the same backend context (grok persists sessions to disk independent of
/// which process created them). Doesn't replay old messages — those are
/// restored from our own persisted store state instead.
export async function loadSession(sessionId: string, cwd: string): Promise<void> {
  await invoke("load_session", { sessionId, cwd });
}

export interface RemoteSessionStub {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: number;
}

function asObj(v: JsonValue): Record<string, JsonValue> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JsonValue>) : {};
}

/// Sessions grok has persisted independent of this app instance (e.g.
/// started from the `grok` TUI) — via ACP `session/list` on the Rust side.
/// Field lookup here is defensive (falls back across a few plausible key
/// spellings) since the exact wire shape isn't confirmed from a live capture
/// the way the rest of this file's commands are — see the comment on
/// `list_sessions` in commands.rs. Entries missing a usable id/cwd are
/// dropped rather than surfaced as broken stubs.
export async function listSessions(): Promise<RemoteSessionStub[]> {
  const raw = (await invoke("list_sessions")) as JsonValue;
  const entries = Array.isArray(raw) ? raw : [];
  const stubs: RemoteSessionStub[] = [];
  for (const entry of entries) {
    const rec = asObj(entry);
    const sessionId = rec.sessionId ?? rec.session_id ?? rec.id;
    const cwd = rec.cwd ?? rec.workingDirectory ?? rec.working_directory;
    if (typeof sessionId !== "string" || typeof cwd !== "string") continue;
    const title = rec.title ?? rec.name;
    const updatedAt = rec.updatedAt ?? rec.updated_at ?? rec.lastUpdated ?? rec.modifiedAt;
    stubs.push({
      sessionId,
      cwd,
      title: typeof title === "string" ? title : undefined,
      updatedAt: typeof updatedAt === "number" ? updatedAt : undefined,
    });
  }
  return stubs;
}

export async function sendPrompt(sessionId: string, text: string): Promise<JsonValue> {
  return invoke("send_prompt", { sessionId, text });
}

export async function cancelPrompt(sessionId: string): Promise<void> {
  await invoke("cancel_prompt", { sessionId });
}

export async function respondPermission(id: JsonValue, optionId: string): Promise<void> {
  await invoke("respond_permission", { id, optionId });
}

export async function denyPermission(id: JsonValue): Promise<void> {
  await invoke("deny_permission", { id });
}

/// Answers an ACP `ext_method` request (`x.ai/exit_plan_mode`,
/// `x.ai/ask_user_question`) with an exact, pre-shaped result — these don't
/// share `session/request_permission`'s response envelope (confirmed against
/// grok-build's own wire types), so the caller builds the whole `result`
/// value itself; see PlanApprovalCard/AskUserQuestionCard.
export async function respondExt(id: JsonValue, result: JsonValue): Promise<void> {
  await invoke("respond_ext", { id, result });
}

export function onAcpEvent(handler: (event: AcpEvent) => void): Promise<UnlistenFn> {
  return listen<AcpEvent>("acp-event", (e) => handler(e.payload));
}

/// The `initialize` handshake already completed by the time the Rust side finishes
/// setup() — this is a plain command (request/response), not a one-shot event, so
/// there's no race with how fast the frontend's own JS happens to load.
export async function initStatus(): Promise<JsonValue> {
  return invoke("init_status");
}

export async function checkAuth(): Promise<boolean> {
  return invoke("check_auth");
}

export interface ModelInfo {
  currentModelId?: string;
  availableModels?: Array<{
    modelId: string;
    name: string;
    description?: string;
    _meta?: { totalContextTokens?: number };
  }>;
}

export async function currentModelInfo(): Promise<ModelInfo> {
  return invoke("current_model_info");
}

export async function pickFolder(defaultPath?: string): Promise<string | undefined> {
  const result = await open({ directory: true, multiple: false, defaultPath });
  return typeof result === "string" ? result : undefined;
}

export async function pickFiles(defaultPath?: string): Promise<string[]> {
  const result = await open({ directory: false, multiple: true, defaultPath });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

export interface ResolvedImage {
  dataUrl: string;
  /// The real absolute path that resolved — pass this to `downloadImage`.
  path: string;
}

/// Reads a local image and returns it as a `data:` URL for inline preview.
/// `path` is used as-is when absolute (e.g. a tool call's `rawOutput.path`);
/// when relative (a "short path" the model wrote in prose), the backend tries
/// it against `cwd` and then grok's own session folder — see the Rust command.
export async function readImageDataUrl(path: string, cwd?: string, sessionId?: string): Promise<ResolvedImage> {
  return invoke("read_image_data_url", { path, cwd, sessionId });
}

/// Prompts the user for a destination via the native save dialog and copies
/// the image there. Returns false if the user cancelled the dialog.
export async function downloadImage(sourcePath: string): Promise<boolean> {
  const suggested = sourcePath.split("/").pop() || "image.jpg";
  const dest = await save({ defaultPath: suggested });
  if (!dest) return false;
  await invoke("save_image_as", { sourcePath, destPath: dest });
  return true;
}

export async function startDeviceLogin(): Promise<void> {
  await invoke("start_device_login");
}

export interface LoginUrlPayload {
  url: string;
  code?: string;
}

export function onAuthLoginUrl(handler: (payload: LoginUrlPayload) => void): Promise<UnlistenFn> {
  return listen<LoginUrlPayload>("auth-login-url", (e) => handler(e.payload));
}

export interface LoginResultPayload {
  success: boolean;
  message?: string;
}

export function onAuthLoginResult(handler: (payload: LoginResultPayload) => void): Promise<UnlistenFn> {
  return listen<LoginResultPayload>("auth-login-result", (e) => handler(e.payload));
}

// ───────────────────────── Anvil Memory ─────────────────────────

/// Saved (next-restart) value of the memory-enable toggle.
export async function getMemoryEnabled(): Promise<boolean> {
  return invoke("get_memory_enabled");
}

export async function setMemoryEnabled(enabled: boolean): Promise<void> {
  await invoke("set_memory_enabled", { enabled });
}

/// Whether *this already-running* process actually has grok's native memory
/// active — can differ from `getMemoryEnabled()` right after a toggle flip,
/// since that only takes effect on the next restart.
export async function memoryRuntimeStatus(): Promise<boolean> {
  return invoke("memory_runtime_status");
}

export type MemoryEntryType = "project" | "decision" | "issue" | "person" | "preference" | "reference";
export type MemoryEntryScope = "project" | "global";
export type MemoryEntryStatus = "open" | "resolved";

export interface MemoryEntryMeta {
  slug: string;
  type: string;
  name: string;
  description: string;
  status?: string;
  modifiedAtMs: number;
  path: string;
}

export interface MemoryEntry extends MemoryEntryMeta {
  body: string;
}

/// All Anvil entries visible from this session: project-scoped ones (found by
/// walking up from `cwd` to the repo root, same discovery grok itself uses for
/// AGENTS.md) plus the global ones. Omit `cwd` to list only global entries.
export async function listAnvilEntries(cwd?: string): Promise<MemoryEntryMeta[]> {
  return invoke("list_anvil_entries", { cwd });
}

export async function readAnvilEntry(path: string): Promise<MemoryEntry> {
  return invoke("read_anvil_entry", { path });
}

export async function writeAnvilEntry(
  scope: MemoryEntryScope,
  type: string,
  slug: string,
  name: string,
  description: string,
  body: string,
  status?: string,
  cwd?: string
): Promise<void> {
  await invoke("write_anvil_entry", { scope, type, slug, name, description, status, body, cwd });
}

export async function deleteAnvilEntry(path: string, cwd?: string): Promise<void> {
  await invoke("delete_anvil_entry", { path, cwd });
}

// ───────────────────────── Voice mode ─────────────────────────

export interface VoiceEvent {
  type: "locale" | "ready" | "partial" | "final" | "error" | "ended";
  text?: string;
  message?: string;
}

/// Starts a new voice-recognition session (kills any previous one first).
/// Live results stream in via `onVoiceEvent`, not this call's return value.
export async function startVoice(): Promise<void> {
  await invoke("start_voice");
}

/// Signals the current session to stop — it still emits one last "final" (if
/// anything was recognized) and an "ended" event before actually exiting.
export async function stopVoice(): Promise<void> {
  await invoke("stop_voice");
}

export function onVoiceEvent(handler: (event: VoiceEvent) => void): Promise<UnlistenFn> {
  return listen<VoiceEvent>("voice-event", (e) => handler(e.payload));
}
