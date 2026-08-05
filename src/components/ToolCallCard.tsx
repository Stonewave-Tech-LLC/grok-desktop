import { memo, useEffect, useState } from "react";
import type { JsonValue } from "../types/acp";
import { DiffView } from "./DiffView";
import { useSessionStore } from "../store/sessions";
import { readImageDataUrl } from "../lib/api";
import { GeneratedImage } from "./GeneratedImage";
import { extractMediaGen } from "../lib/assets";

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

function diffStats(diff: DiffBlock): { added: number; removed: number } {
  const oldLines = diff.oldText.split("\n");
  const newLines = diff.newText.split("\n");
  // Not a real line-diff algorithm — just a quick magnitude hint for the
  // collapsed state, good enough to signal "small tweak" vs "big rewrite".
  return { added: Math.max(0, newLines.length - oldLines.length) || newLines.length, removed: Math.max(0, oldLines.length - newLines.length) };
}

function ImagePreview({ path, filename }: { path: string; filename: string }) {
  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(undefined);
    setFailed(false);
    readImageDataUrl(path)
      .then((result) => {
        if (!cancelled) setDataUrl(result.dataUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed) {
    return (
      <div className="px-3 pb-2.5 text-[11px]" style={{ color: "var(--gd-text-faint)" }}>
        Couldn't load {filename || path}
      </div>
    );
  }

  return (
    <div className="px-3 pb-2.5">
      {dataUrl ? (
        <GeneratedImage
          src={dataUrl}
          path={path}
          alt={filename}
          className="rounded-[var(--gd-radius-sm)] max-h-72 w-auto border block"
          style={{ borderColor: "var(--gd-border)" }}
        />
      ) : (
        <div className="h-32 w-48 rounded-[var(--gd-radius-sm)] animate-pulse" style={{ background: "var(--gd-metal-1)" }} />
      )}
    </div>
  );
}

// grok attaches a plain-language `description` to run_terminal_command calls
// (confirmed live: {"command": "...", "description": "Locate memory storage
// locations"}) — a genuine "why is it doing this" explanation that we were
// only ever showing buried in the collapsed Raw JSON dump. Prefer it over the
// raw "Execute `<command>`" title for the at-a-glance row; the exact command
// still gets its own clearly-labeled block once expanded (see below), instead
// of only being visible truncated in that title or buried in Raw.
function extractDescription(raw: Record<string, JsonValue>): string | undefined {
  const rawInput = asRecord(raw.rawInput);
  return typeof rawInput.description === "string" ? rawInput.description : undefined;
}

function extractCommand(raw: Record<string, JsonValue>): string | undefined {
  const rawInput = asRecord(raw.rawInput);
  return typeof rawInput.command === "string" ? rawInput.command : undefined;
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

// Memoized for the same reason as MarkdownMessage — every completed tool
// call in a session would otherwise re-render (including re-diffing its
// DiffView) on every streamed token of the current, unrelated response.
function ToolCallCardImpl({ raw }: { raw: Record<string, JsonValue> }) {
  const [expanded, setExpanded] = useState(false);
  const diffsAutoExpand = useSessionStore((s) => s.diffsAutoExpand);
  const title = typeof raw.title === "string" ? raw.title : (typeof raw.kind === "string" ? raw.kind : "Tool call");
  const kind = typeof raw.kind === "string" ? raw.kind : "";
  const status = typeof raw.status === "string" ? raw.status : "pending";
  const icon = KIND_ICON[kind] ?? "◆";
  const diff = extractDiff(raw);
  const media = extractMediaGen(raw);
  const description = extractDescription(raw);
  const command = extractCommand(raw);
  const headline = description || title;
  const textOutput = !diff ? extractTextOutput(raw) : undefined;
  const showDiff = Boolean(diff) && (expanded || diffsAutoExpand);
  const stats = diff ? diffStats(diff) : undefined;
  const running = status === "in_progress";

  return (
    <div
      className="rounded-[var(--gd-radius-md)] border overflow-hidden my-1.5 max-w-xl"
      style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)" }}
    >
      <button onClick={() => setExpanded((e) => !e)} title={headline} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <span className="text-[13px]" style={{ color: "var(--gd-text-faint)" }}>
          {icon}
        </span>
        <span className={running ? "gd-shimmer text-[13px] font-medium flex-1 truncate" : "text-[13px] font-medium flex-1 truncate"} style={running ? undefined : { color: "var(--gd-text)" }}>
          {headline}
        </span>
        {stats && !showDiff && (
          <span className="text-[10px] font-mono shrink-0" style={{ color: "var(--gd-text-faint)" }}>
            {stats.added > 0 && <span style={{ color: "var(--gd-success)" }}>+{stats.added} </span>}
            {stats.removed > 0 && <span style={{ color: "var(--gd-danger)" }}>-{stats.removed}</span>}
          </span>
        )}
        <span
          className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0"
          style={{ color: statusColor(status), background: "var(--gd-surface-raised)" }}
        >
          {running ? (
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: statusColor(status) }} />
              running
            </span>
          ) : (
            status
          )}
        </span>
        <span className="text-[11px] shrink-0" style={{ color: "var(--gd-text-faint)" }}>
          {expanded ? "−" : "+"}
        </span>
      </button>

      {media?.kind === "image" && <ImagePreview path={media.path} filename={media.filename} />}
      {media?.kind === "video" && (
        <div className="px-3 pb-2.5 flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--gd-text-muted)" }}>
          <span aria-hidden>🎬</span>
          <span className="truncate">{media.filename || media.path}</span>
        </div>
      )}

      {showDiff && diff && (
        <div className="px-3 pb-3">
          <DiffView path={diff.path} oldText={diff.oldText} newText={diff.newText} />
        </div>
      )}

      {expanded && (
        <div
          className="px-3 pb-3 text-[12px] overflow-x-auto"
          style={{ borderTop: "1px solid var(--gd-border)", color: "var(--gd-text-muted)" }}
        >
          {command && (
            <div className="pt-2">
              <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--gd-text-faint)" }}>
                Command
              </div>
              <pre
                className="whitespace-pre-wrap break-words font-mono text-[11.5px] p-2 rounded-[var(--gd-radius-sm)]"
                style={{ background: "var(--gd-bg)", color: "var(--gd-text)" }}
              >
                {command}
              </pre>
            </div>
          )}
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

export const ToolCallCard = memo(ToolCallCardImpl);
