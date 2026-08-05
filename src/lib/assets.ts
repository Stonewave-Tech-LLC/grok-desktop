import type { JsonValue } from "../types/acp";

function asRecord(v: JsonValue): Record<string, JsonValue> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JsonValue>) : {};
}

export interface MediaGenResult {
  kind: "image" | "video";
  path: string;
  filename: string;
}

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
