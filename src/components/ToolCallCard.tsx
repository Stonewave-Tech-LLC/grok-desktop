import { useState } from "react";
import type { JsonValue } from "../types/acp";
import { DiffView } from "./DiffView";

const KIND_ICON: Record<string, string> = {
  read: "▤",
  edit: "✎",
  execute: "▸",
  search: "⌕",
  fetch: "⇩",
  think: "◌",
};

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return "var(--gd-success)";
    case "failed":
      return "var(--gd-danger)";
    case "in_progress":
      return "var(--gd-warning)";
    default:
      return "var(--gd-text-faint)";
  }
}

function asRecord(v: JsonValue): Record<string, JsonValue> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JsonValue>) : {};
}

interface DiffBlock {
  path?: string;
  oldText: string;
  newText: string;
}

function extractDiff(raw: Record<string, JsonValue>): DiffBlock | undefined {
  const content = raw.content;
  if (!Array.isArray(content)) return undefined;
  for (const c of content) {
    const rec = asRecord(c);
    if (rec.type === "diff" && typeof rec.oldText === "string" && typeof rec.newText === "string") {
      return { path: typeof rec.path === "string" ? rec.path : undefined, oldText: rec.oldText, newText: rec.newText };
    }
  }
  return undefined;
}

function extractTextOutput(raw: Record<string, JsonValue>): string | undefined {
  const content = raw.content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const c of content) {
    const rec = asRecord(c);
    const inner = asRecord(rec.content);
    if (typeof inner.text === "string" && inner.text.trim()) parts.push(inner.text);
  }
  return parts.length ? parts.join("\n") : undefined;
}

export function ToolCallCard({ raw }: { raw: Record<string, JsonValue> }) {
  const [expanded, setExpanded] = useState(false);
  const title = typeof raw.title === "string" ? raw.title : (typeof raw.kind === "string" ? raw.kind : "Tool call");
  const kind = typeof raw.kind === "string" ? raw.kind : "";
  const status = typeof raw.status === "string" ? raw.status : "pending";
  const icon = KIND_ICON[kind] ?? "◆";
  const diff = extractDiff(raw);
  const textOutput = !diff ? extractTextOutput(raw) : undefined;

  return (
    <div
      className="rounded-[var(--gd-radius-md)] border overflow-hidden my-1.5 max-w-xl"
      style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)" }}
    >
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <span className="text-[13px]" style={{ color: "var(--gd-text-faint)" }}>
          {icon}
        </span>
        <span className="text-[13px] font-medium flex-1 truncate" style={{ color: "var(--gd-text)" }}>
          {title}
        </span>
        <span
          className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full"
          style={{ color: statusColor(status), background: "var(--gd-surface-raised)" }}
        >
          {status === "in_progress" ? (
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: statusColor(status) }} />
              running
            </span>
          ) : (
            status
          )}
        </span>
        <span className="text-[11px]" style={{ color: "var(--gd-text-faint)" }}>
          {expanded ? "−" : "+"}
        </span>
      </button>

      {diff && (
        <div className="px-3 pb-3">
          <DiffView path={diff.path} oldText={diff.oldText} newText={diff.newText} />
        </div>
      )}

      {expanded && (
        <div
          className="px-3 pb-3 text-[12px] overflow-x-auto"
          style={{ borderTop: "1px solid var(--gd-border)", color: "var(--gd-text-muted)" }}
        >
          {textOutput && (
            <pre className="whitespace-pre-wrap break-words pt-2 font-mono text-[12px]">{textOutput}</pre>
          )}
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px]" style={{ color: "var(--gd-text-faint)" }}>
              Raw
            </summary>
            <pre className="whitespace-pre-wrap break-words pt-1">{JSON.stringify(raw, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
