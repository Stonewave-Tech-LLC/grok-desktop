import type { JsonValue } from "../types/acp";

function asRecord(v: JsonValue): Record<string, JsonValue> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JsonValue>) : {};
}

// grok attaches a plain-language `description` to run_terminal_command calls
// (confirmed live: {"command": "...", "description": "Locate memory storage
// locations"}) — a genuine "why is it doing this" explanation that's much
// more useful as a headline than the raw "Execute `<command>`" title. Shared
// between ToolCallCard (historical record) and PermissionCard (the pending
// decision — this is where it matters most, since illegible raw commands in
// an approval prompt are a real "can I trust this?" problem, not just polish).
export function extractDescription(raw: Record<string, JsonValue>): string | undefined {
  const rawInput = asRecord(raw.rawInput);
  return typeof rawInput.description === "string" ? rawInput.description : undefined;
}

export function extractCommand(raw: Record<string, JsonValue>): string | undefined {
  const rawInput = asRecord(raw.rawInput);
  return typeof rawInput.command === "string" ? rawInput.command : undefined;
}
