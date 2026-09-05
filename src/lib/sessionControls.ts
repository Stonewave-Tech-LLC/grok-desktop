import type { JsonValue } from "../types/acp";
import type { ModelInfo } from "./api";

function asRecord(v: JsonValue): Record<string, JsonValue> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JsonValue>) : {};
}

function asArray(v: JsonValue): JsonValue[] {
  return Array.isArray(v) ? v : [];
}

export interface SessionMode {
  id: string;
  name: string;
  description?: string;
}

export interface SessionControls {
  modelId?: string;
  availableModels?: ModelInfo["availableModels"];
  modeId?: string;
  availableModes?: SessionMode[];
}

/// Modes we offer when grok doesn't advertise `modes` on session/new.
/// Ids match grok's `--permission-mode` values (see user-guide 22).
export const FALLBACK_MODES: SessionMode[] = [
  { id: "default", name: "Ask", description: "Confirm edits and commands" },
  { id: "bypassPermissions", name: "Always Allow", description: "No prompts — trusted workspaces only" },
];

export function modeImpliesYolo(modeId: string | undefined): boolean {
  if (!modeId) return false;
  return /bypass|always-approve|always.?allow|yolo/i.test(modeId);
}

export function yoloToModeId(yolo: boolean): string {
  return yolo ? "bypassPermissions" : "default";
}

function parseModels(rec: Record<string, JsonValue>): Pick<SessionControls, "modelId" | "availableModels"> {
  const models = asRecord(rec.models);
  const modelState = asRecord(rec.modelState);
  const meta = asRecord(rec._meta);
  const metaModels = asRecord(meta.models);
  const metaState = asRecord(meta.modelState);
  const src = Object.keys(models).length
    ? models
    : Object.keys(modelState).length
      ? modelState
      : Object.keys(metaModels).length
        ? metaModels
        : metaState;
  const current =
    (typeof src.currentModelId === "string" && src.currentModelId) ||
    (typeof rec.modelId === "string" && rec.modelId) ||
    (typeof meta.modelId === "string" && meta.modelId) ||
    undefined;
  const list = asArray(src.availableModels)
    .map((m) => {
      const r = asRecord(m);
      const modelId = typeof r.modelId === "string" ? r.modelId : typeof r.id === "string" ? r.id : "";
      const name = typeof r.name === "string" ? r.name : modelId;
      if (!modelId) return undefined;
      const description = typeof r.description === "string" ? r.description : undefined;
      const nested = asRecord(r._meta);
      const total =
        typeof nested.totalContextTokens === "number"
          ? nested.totalContextTokens
          : typeof r.contextWindow === "number"
            ? r.contextWindow
            : undefined;
      return {
        modelId,
        name,
        description,
        _meta: total !== undefined ? { totalContextTokens: total } : undefined,
      };
    })
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  return {
    modelId: current,
    availableModels: list.length ? list : undefined,
  };
}

function parseModes(rec: Record<string, JsonValue>): Pick<SessionControls, "modeId" | "availableModes"> {
  const modes = asRecord(rec.modes);
  const modeState = asRecord(rec.modeState);
  const meta = asRecord(rec._meta);
  const metaModes = asRecord(meta.modes);
  const src = Object.keys(modes).length
    ? modes
    : Object.keys(modeState).length
      ? modeState
      : metaModes;
  const current =
    (typeof src.currentModeId === "string" && src.currentModeId) ||
    (typeof rec.modeId === "string" && rec.modeId) ||
    undefined;
  const list: SessionMode[] = [];
  for (const m of asArray(src.availableModes)) {
    const r = asRecord(m);
    const id = typeof r.id === "string" ? r.id : typeof r.modeId === "string" ? r.modeId : "";
    const name = typeof r.name === "string" ? r.name : id;
    if (!id) continue;
    const description = typeof r.description === "string" ? r.description : undefined;
    list.push({ id, name, description });
  }
  return {
    modeId: current,
    availableModes: list.length ? list : undefined,
  };
}

/// Pull model/mode catalogs out of a `session/new` or `session/load` result
/// (and the initialize `_meta.modelState` shape, which is the same fields).
/// Every lookup is defensive — grok has put these on the result root, under
/// `_meta`, and under `models`/`modes` depending on ACP version.
export function parseSessionControls(result: JsonValue): SessionControls {
  const rec = asRecord(result);
  return { ...parseModels(rec), ...parseModes(rec) };
}

export function sessionIdFromResult(result: JsonValue): string | undefined {
  const rec = asRecord(result);
  if (typeof rec.sessionId === "string") return rec.sessionId;
  const meta = asRecord(rec._meta);
  if (typeof meta.sessionId === "string") return meta.sessionId;
  return undefined;
}