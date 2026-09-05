import type { JsonValue } from "../types/acp";

function asRecord(v: JsonValue): Record<string, JsonValue> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JsonValue>) : {};
}

export interface MediaGenResult {
  kind: "image" | "video";
  path: string;
  filename: string;
}

const IMAGINE_TOOL_NAMES = new Set([
  "image_gen",
  "image_edit",
  "image_to_video",
  "reference_to_video",
]);

const IMAGINE_OUTPUT_TYPES = new Set(["ImageGen", "ImageEdit", "ImageToVideo", "ReferenceToVideo"]);

// grok's image_gen/image_edit/image_to_video/reference_to_video tools all wrap
// MediaGenOutput, tagged by `rawOutput.type` (confirmed against grok-build's own
// source — crates/codegen/xai-grok-tools/src/types/output.rs). The model-facing
// `content[]` is prose only; the file path lives in `rawOutput`. Shared between
// ToolCallCard (live per-message preview) and AssetsPanel (cross-session grid).
export function extractMediaGen(raw: Record<string, JsonValue>): MediaGenResult | undefined {
  const rawOutput = asRecord(raw.rawOutput);
  const type = typeof rawOutput.type === "string" ? rawOutput.type : "";
  const path = typeof rawOutput.path === "string" ? rawOutput.path : "";
  const filename = typeof rawOutput.filename === "string" ? rawOutput.filename : "";
  if (!path) return undefined;
  if (type === "ImageGen" || type === "ImageEdit") return { kind: "image", path, filename };
  if (type === "ImageToVideo" || type === "ReferenceToVideo") return { kind: "video", path, filename };
  return undefined;
}

export function extractPrompt(raw: Record<string, JsonValue>): string | undefined {
  const rawInput = asRecord(raw.rawInput);
  return typeof rawInput.prompt === "string" ? rawInput.prompt : undefined;
}

export function extractAspect(raw: Record<string, JsonValue>): string | undefined {
  const rawInput = asRecord(raw.rawInput);
  return typeof rawInput.aspect_ratio === "string" ? rawInput.aspect_ratio : undefined;
}

/// Tool name as grok tags it on `_meta["x.ai/tool"].name` (same path
/// `isBackgroundToolCall` already trusts), falling back to `title`.
export function extractToolName(raw: Record<string, JsonValue>): string {
  const meta = asRecord(asRecord(raw._meta)["x.ai/tool"]);
  if (typeof meta.name === "string" && meta.name) return meta.name;
  if (typeof raw.title === "string" && raw.title) return raw.title;
  if (typeof raw.kind === "string" && raw.kind) return raw.kind;
  return "";
}

export function isImagineTool(raw: Record<string, JsonValue>): boolean {
  const name = extractToolName(raw).toLowerCase();
  if (IMAGINE_TOOL_NAMES.has(name)) return true;
  const rawOutput = asRecord(raw.rawOutput);
  return typeof rawOutput.type === "string" && IMAGINE_OUTPUT_TYPES.has(rawOutput.type);
}

export function imagineVerb(raw: Record<string, JsonValue>): "generate" | "edit" | "animate" {
  const name = extractToolName(raw).toLowerCase();
  if (name.includes("edit")) return "edit";
  if (name.includes("video")) return "animate";
  const rawOutput = asRecord(raw.rawOutput);
  const type = typeof rawOutput.type === "string" ? rawOutput.type : "";
  if (type === "ImageEdit") return "edit";
  if (type === "ImageToVideo" || type === "ReferenceToVideo") return "animate";
  return "generate";
}

export function relativizePath(absPath: string, cwd: string): string {
  const normCwd = cwd.endsWith("/") ? cwd : `${cwd}/`;
  if (absPath === cwd) return ".";
  if (absPath.startsWith(normCwd)) return absPath.slice(normCwd.length);
  return absPath;
}
