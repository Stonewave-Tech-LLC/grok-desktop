import { useState } from "react";
import { useSessionStore, type ActivityItem } from "../store/sessions";
import { MarkdownMessage } from "./MarkdownMessage";

function formatDuration(ms?: number): string {
  if (!ms) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function statusColor(status: ActivityItem["status"]): string {
  switch (status) {
    case "running":
      return "var(--gd-warning)";
    case "completed":
      return "var(--gd-success)";
    case "failed":
      return "var(--gd-danger)";
  }
}

function ActivityRow({ item, active, onClick }: { item: ActivityItem; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-[var(--gd-radius-sm)] px-2.5 py-2 transition"
      style={{ background: active ? "var(--gd-accent-soft)" : "transparent" }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={item.status === "running" ? "h-1.5 w-1.5 rounded-full animate-pulse shrink-0" : "h-1.5 w-1.5 rounded-full shrink-0"}
          style={{ background: statusColor(item.status) }}
        />
        <span className="text-[12px] font-medium truncate flex-1" style={{ color: active ? "var(--gd-accent)" : "var(--gd-text)" }}>
          {item.title}
        </span>
      </div>
      <div className="text-[11px] mt-0.5 pl-3 truncate" style={{ color: "var(--gd-text-faint)" }}>
        {item.kind === "subagent"
          ? `${item.subagentType ?? "subagent"} · ${formatDuration(item.durationMs)}${item.tokensUsed ? ` · ${(item.tokensUsed / 1000).toFixed(1)}k tok` : ""}`
          : item.status === "running"
            ? "running…"
            : item.exitCode !== undefined
              ? `exit ${item.exitCode}`
              : item.status}
      </div>
    </button>
  );
}

function ActivityDetail({ item }: { item: ActivityItem }) {
  return (
    <div className="p-3 text-[12px] space-y-2 overflow-y-auto flex-1">
      <div className="font-medium text-[13px]" style={{ color: "var(--gd-text)" }}>
        {item.title}
      </div>
      {item.kind === "subagent" ? (
        <>
          <div style={{ color: "var(--gd-text-faint)" }}>
            {item.subagentType} · {formatDuration(item.durationMs)} · {item.toolCallCount ?? 0} tool calls
            {item.toolsUsed && item.toolsUsed.length > 0 && ` · ${item.toolsUsed.join(", ")}`}
          </div>
          {item.output ? (
            <div style={{ color: "var(--gd-text)" }}>
              <MarkdownMessage text={item.output} />
            </div>
          ) : (
            <div style={{ color: "var(--gd-text-faint)" }}>
              {item.status === "running" ? "Still running — no live sub-transcript is exposed by the protocol, only periodic progress and a final summary." : "No summary yet."}
            </div>
          )}
        </>
      ) : (
        <pre
          className="whitespace-pre-wrap break-words font-mono text-[11.5px] p-2 rounded-[var(--gd-radius-sm)]"
          style={{ background: "var(--gd-bg)", color: "var(--gd-text)" }}
        >
          {item.outputText || (item.status === "running" ? "…" : "(no output)")}
        </pre>
      )}
    </div>
  );
}

export function ActivityPanel({ sessionId }: { sessionId?: string }) {
  const session = useSessionStore((s) => (sessionId ? s.sessions[sessionId] : undefined));
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const order = session?.activityOrder ?? [];
  const items = order.map((id) => session?.activity[id]).filter((i): i is ActivityItem => Boolean(i));
  const selectedItem = items.find((i) => i.id === selected) ?? items[0];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="max-h-56 overflow-y-auto p-2 space-y-1 border-b" style={{ borderColor: "var(--gd-border)" }}>
        {items.length === 0 && (
          <div className="px-2 py-6 text-center text-[12px]" style={{ color: "var(--gd-text-faint)" }}>
            Subagents and background commands will show up here while they run.
          </div>
        )}
        {items.map((item) => (
          <ActivityRow key={item.id} item={item} active={item.id === selectedItem?.id} onClick={() => setSelected(item.id)} />
        ))}
      </div>

      {selectedItem ? (
        <ActivityDetail item={selectedItem} />
      ) : (
        <div className="flex-1" />
      )}
    </div>
  );
}
