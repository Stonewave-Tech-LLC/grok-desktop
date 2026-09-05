import { useEffect, useState } from "react";
import {
  deleteAnvilEntry,
  listAnvilEntries,
  readAnvilEntry,
  writeAnvilEntry,
  readStateCard,
  writeStateCard,
  captureEpisodic,
  sendPrompt,
  type MemoryEntry,
  type MemoryEntryMeta,
  type StateCard,
} from "../lib/api";
import { useSessionStore, type ChatSession } from "../store/sessions";
import { isStale } from "../lib/memoryStaleness";
import { MarkdownMessage } from "./MarkdownMessage";

const PROJECT_TYPES = ["project", "decision", "issue"] as const;
const GLOBAL_TYPES = ["person", "preference", "reference"] as const;
// Deliberately does NOT include "episodic" — that type is never offered in
// the manual-entry form, only ever written by captureEpisodic() (grok's own
// flush/dream output, or an explicit "Capture now"). See
// docs/OPERATOR_MEMORY.md diamond 2/3: single writer, always something
// already graded, never a live save-trivia tool.
const ALL_TYPES = [...PROJECT_TYPES, ...GLOBAL_TYPES];

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusDotColor(status?: string): string | undefined {
  if (status === "open") return "var(--gd-warning)";
  if (status === "resolved") return "var(--gd-success)";
  return undefined;
}

function relativeTime(ts: number): string {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return "now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.round(diffHr / 24)}d`;
}

function extractLastAssistantText(session: ChatSession): string | undefined {
  for (let i = session.timeline.length - 1; i >= 0; i--) {
    const item = session.timeline[i];
    if (item.sessionUpdate === "agent_message_final" && typeof item.raw.text === "string") {
      return item.raw.text;
    }
  }
  return undefined;
}

function EntryRow({
  entry,
  active,
  onClick,
  onDelete,
  stale,
}: {
  entry: MemoryEntryMeta;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
  stale?: boolean;
}) {
  const dot = statusDotColor(entry.status);
  return (
    <div
      onClick={onClick}
      className="group w-full text-left rounded-[var(--gd-radius-sm)] px-2.5 py-1.5 cursor-pointer transition"
      style={{ background: active ? "var(--gd-accent-soft)" : "transparent" }}
    >
      <div className="flex items-center gap-1.5">
        {dot && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: dot }} />}
        {stale && (
          <span
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ background: "var(--gd-text-faint)" }}
            title="Stale — past its expected freshness window"
          />
        )}
        <span
          className="text-[12px] font-medium truncate flex-1"
          style={{ color: active ? "var(--gd-accent)" : "var(--gd-text)" }}
        >
          {entry.name}
        </span>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="gd-glow-hover h-5 w-5 rounded-[var(--gd-radius-sm)] flex items-center justify-center opacity-0 group-hover:opacity-100 transition border border-transparent shrink-0"
            style={{ color: "var(--gd-text-faint)" }}
            aria-label="Delete entry"
            title="Delete entry"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
              <path
                d="M2.75 4h10.5M6.5 4V2.75a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1V4m-6 0 .6 8.4a1 1 0 0 0 1 .93h5.8a1 1 0 0 0 1-.93L12.5 4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
      <div className="text-[10.5px] truncate pl-3" style={{ color: "var(--gd-text-faint)" }}>
        {entry.description}
      </div>
    </div>
  );
}

function NewEntryForm({
  cwd,
  onCancel,
  onSaved,
}: {
  cwd?: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<(typeof ALL_TYPES)[number]>("preference");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [saving, setSaving] = useState(false);

  const isProjectType = (PROJECT_TYPES as readonly string[]).includes(type);
  const scope = isProjectType ? "project" : "global";
  const canSave = name.trim() && description.trim() && (!isProjectType || cwd);

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await writeAnvilEntry(scope, type, name, name, description, body, type === "issue" ? status : undefined, cwd);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold" style={{ color: "var(--gd-text)" }}>
          New memory entry
        </div>
        <button onClick={onCancel} className="text-[11px]" style={{ color: "var(--gd-text-faint)" }}>
          Cancel
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {ALL_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className="px-2 py-1 rounded-full text-[10.5px] font-medium transition"
            style={{
              background: type === t ? "var(--gd-accent-soft)" : "var(--gd-metal-1)",
              color: type === t ? "var(--gd-accent)" : "var(--gd-text-muted)",
            }}
          >
            {titleCase(t)}
          </button>
        ))}
      </div>
      {isProjectType && !cwd && (
        <div className="text-[10.5px]" style={{ color: "var(--gd-warning)" }}>
          This type needs an open session (for its project folder) to save.
        </div>
      )}

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        className="w-full rounded-[var(--gd-radius-sm)] border px-2.5 py-1.5 text-[12px] bg-transparent outline-none"
        style={{ borderColor: "var(--gd-border)", color: "var(--gd-text)" }}
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="One-line description"
        className="w-full rounded-[var(--gd-radius-sm)] border px-2.5 py-1.5 text-[12px] bg-transparent outline-none"
        style={{ borderColor: "var(--gd-border)", color: "var(--gd-text)" }}
      />
      {type === "issue" && (
        <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--gd-text-muted)" }}>
          Status:
          <button
            onClick={() => setStatus("open")}
            className="px-2 py-0.5 rounded-full transition"
            style={{ background: status === "open" ? "var(--gd-warning-soft)" : "var(--gd-metal-1)", color: status === "open" ? "var(--gd-warning)" : "var(--gd-text-faint)" }}
          >
            Open
          </button>
          <button
            onClick={() => setStatus("resolved")}
            className="px-2 py-0.5 rounded-full transition"
            style={{ background: status === "resolved" ? "var(--gd-success-soft)" : "var(--gd-metal-1)", color: status === "resolved" ? "var(--gd-success)" : "var(--gd-text-faint)" }}
          >
            Resolved
          </button>
        </div>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Details — rule/fact, Why, How to apply…"
        rows={5}
        className="w-full rounded-[var(--gd-radius-sm)] border px-2.5 py-1.5 text-[12px] bg-transparent outline-none resize-none"
        style={{ borderColor: "var(--gd-border)", color: "var(--gd-text)" }}
      />
      <button
        onClick={handleSave}
        disabled={!canSave || saving}
        className="gd-billet w-full text-[12px] font-semibold px-3 py-1.5 rounded-[var(--gd-radius-sm)] disabled:opacity-40 disabled:pointer-events-none"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

// The state card is the project layer's headline artifact (docs/
// OPERATOR_MEMORY.md diamond 4) — Focus / Last decided / Open-Blockers, the
// `## Aktueller Zustand` pattern brought natively into Anvil, plus a
// last-commit line the backend computes live from git (never editable here,
// never stored — read-only by construction).
function StateCardPanel({ cwd }: { cwd: string }) {
  const [card, setCard] = useState<StateCard | undefined>(undefined);
  const [focus, setFocus] = useState("");
  const [lastDecided, setLastDecided] = useState("");
  const [openBlockers, setOpenBlockers] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readStateCard(cwd)
      .then((c) => {
        if (cancelled) return;
        setCard(c);
        setFocus(c.focus);
        setLastDecided(c.lastDecided);
        setOpenBlockers(c.openBlockers);
        setDirty(false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  async function handleSave() {
    setSaving(true);
    try {
      await writeStateCard(cwd, focus, lastDecided, openBlockers);
      const fresh = await readStateCard(cwd);
      setCard(fresh);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  function field(label: string, value: string, onChange: (v: string) => void) {
    return (
      <div>
        <div className="text-[9.5px] uppercase tracking-wide mb-1" style={{ color: "var(--gd-text-faint)" }}>
          {label}
        </div>
        <textarea
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setDirty(true);
          }}
          placeholder="—"
          rows={2}
          className="w-full rounded-[var(--gd-radius-sm)] px-2 py-1.5 text-[12px] bg-transparent outline-none resize-none border transition-colors"
          style={{ color: "var(--gd-text)", borderColor: "var(--gd-border)" }}
        />
      </div>
    );
  }

  return (
    <div
      className="rounded-[var(--gd-radius-md)] p-3 space-y-2.5"
      style={{ background: "var(--gd-surface)", boxShadow: "var(--gd-panel-shadow)" }}
    >
      {field("Focus", focus, setFocus)}
      {field("Last decided", lastDecided, setLastDecided)}
      {field("Open / Blockers", openBlockers, setOpenBlockers)}
      {card?.lastCommit && (
        <div className="text-[10.5px] font-mono truncate pt-1 border-t" style={{ color: "var(--gd-text-faint)", borderColor: "var(--gd-border)" }}>
          {card.lastCommit}
        </div>
      )}
      {dirty && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="gd-billet w-full text-[11.5px] font-semibold px-3 py-1.5 rounded-[var(--gd-radius-sm)] disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save state"}
        </button>
      )}
    </div>
  );
}

export function MemoryPanel({ cwd, sessionId }: { cwd?: string; sessionId?: string }) {
  const memoryEnabled = useSessionStore((s) => s.memoryEnabled);
  const memoryActiveThisRun = useSessionStore((s) => s.memoryActiveThisRun);
  const appendUserMessage = useSessionStore((s) => s.appendUserMessage);
  const finalizeTurn = useSessionStore((s) => s.finalizeTurn);
  const [entries, setEntries] = useState<MemoryEntryMeta[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [selectedEntry, setSelectedEntry] = useState<MemoryEntry | undefined>(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);

  async function refresh() {
    const list = await listAnvilEntries(cwd).catch(() => []);
    setEntries(list);
  }

  useEffect(() => {
    refresh();
    setSelectedPath(undefined);
    setSelectedEntry(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  useEffect(() => {
    if (!selectedPath) {
      setSelectedEntry(undefined);
      return;
    }
    let cancelled = false;
    readAnvilEntry(selectedPath)
      .then((e) => {
        if (!cancelled) setSelectedEntry(e);
      })
      .catch(() => {
        if (!cancelled) setSelectedEntry(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  async function handleDelete(entry: MemoryEntryMeta) {
    if (!window.confirm(`Delete "${entry.name}"?`)) return;
    await deleteAnvilEntry(entry.path, cwd);
    if (selectedPath === entry.path) setSelectedPath(undefined);
    refresh();
  }

  // "Flush this session" would be misleading — grok's own /flush is TUI-only
  // and isn't exposed over ACP at all (confirmed, see docs/OPERATOR_MEMORY.md
  // diamond 2), it can't be triggered remotely. This is Anvil's own action
  // instead: ask the *current* session (already has full context) for one
  // explicit graded summary, then promote that reply — same curation rule as
  // the automatic flush/dream hook, just human-initiated.
  async function handleCaptureNow() {
    if (!sessionId || !cwd || capturing) return;
    setCapturing(true);
    try {
      const prompt =
        "Summarize this session for operator memory: current focus in one line, what was decided, what's open or blocked. Plain bullet points, no fluff, nothing you haven't actually done or decided.";
      appendUserMessage(sessionId, prompt);
      try {
        await sendPrompt(sessionId, prompt);
      } finally {
        finalizeTurn(sessionId);
      }
      const session = useSessionStore.getState().sessions[sessionId];
      const text = session ? extractLastAssistantText(session) : undefined;
      if (text) {
        await captureEpisodic("project", "manual capture", text, cwd);
        refresh();
      }
    } finally {
      setCapturing(false);
    }
  }

  const bodyEntries = entries.filter((e) => e.type !== "episodic");
  const projectEntries = bodyEntries.filter((e) => (PROJECT_TYPES as readonly string[]).includes(e.type));
  const globalEntries = bodyEntries.filter((e) => (GLOBAL_TYPES as readonly string[]).includes(e.type));
  const episodicEntries = entries.filter((e) => e.type === "episodic").sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
  const staleEntries = bodyEntries.filter(isStale);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="px-3 py-2 border-b flex items-center justify-between shrink-0" style={{ borderColor: "var(--gd-border)" }}>
        <div className="flex items-center gap-1.5 text-[10.5px]" style={{ color: memoryActiveThisRun ? "var(--gd-success)" : "var(--gd-text-faint)" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
          {memoryActiveThisRun ? "Surfaced to grok" : memoryEnabled ? "Restart to activate" : "Not surfaced to grok"}
        </div>
        <button
          onClick={() => setFormOpen((o) => !o)}
          className="gd-glow-hover h-6 px-2 rounded-full text-[10.5px] font-medium border border-transparent"
          style={{ color: "var(--gd-text-muted)" }}
        >
          {formOpen ? "Cancel" : "+ New"}
        </button>
      </div>

      {formOpen ? (
        <NewEntryForm
          cwd={cwd}
          onCancel={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            refresh();
          }}
        />
      ) : (
        <div className="p-3 space-y-4">
          {cwd && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[9.5px] uppercase tracking-wide" style={{ color: "var(--gd-text-faint)" }}>
                  Current State
                </div>
                {sessionId && (
                  <button
                    onClick={handleCaptureNow}
                    disabled={capturing}
                    className="gd-glow-hover text-[10.5px] font-medium px-2 py-0.5 rounded-full border border-transparent disabled:opacity-40"
                    style={{ color: "var(--gd-text-muted)" }}
                    title="Ask this session for a graded summary, then save it as an episodic memory"
                  >
                    {capturing ? "Capturing…" : "Capture now"}
                  </button>
                )}
              </div>
              <StateCardPanel cwd={cwd} />
            </div>
          )}

          {episodicEntries.length > 0 && (
            <div>
              <div className="text-[9.5px] uppercase tracking-wide px-0.5 mb-1" style={{ color: "var(--gd-text-faint)" }}>
                Recent episodic
              </div>
              <div className="space-y-0.5">
                {episodicEntries.slice(0, 5).map((e) => (
                  <EntryRow key={e.path} entry={e} active={e.path === selectedPath} onClick={() => setSelectedPath(e.path)} onDelete={() => handleDelete(e)} />
                ))}
              </div>
            </div>
          )}

          {staleEntries.length > 0 && (
            <div>
              <div className="text-[9.5px] uppercase tracking-wide px-0.5 mb-1" style={{ color: "var(--gd-text-faint)" }}>
                Stale
              </div>
              <div className="space-y-0.5">
                {staleEntries.map((e) => (
                  <EntryRow key={e.path} entry={e} active={e.path === selectedPath} onClick={() => setSelectedPath(e.path)} stale />
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[9.5px] uppercase tracking-wide px-0.5 mb-1" style={{ color: "var(--gd-text-faint)" }}>
              Body
            </div>
            {bodyEntries.length === 0 && (
              <div className="px-2 py-4 text-center text-[11.5px]" style={{ color: "var(--gd-text-faint)" }}>
                No typed entries yet.
              </div>
            )}
            {cwd && projectEntries.length > 0 && (
              <div className="mb-2">
                <div className="text-[9.5px] uppercase tracking-wide px-2.5 mb-1" style={{ color: "var(--gd-text-faint)" }}>
                  This repo
                </div>
                <div className="space-y-0.5">
                  {projectEntries.map((e) => (
                    <EntryRow key={e.path} entry={e} active={e.path === selectedPath} onClick={() => setSelectedPath(e.path)} onDelete={() => handleDelete(e)} />
                  ))}
                </div>
              </div>
            )}
            {globalEntries.length > 0 && (
              <div>
                <div className="text-[9.5px] uppercase tracking-wide px-2.5 mb-1" style={{ color: "var(--gd-text-faint)" }}>
                  Global
                </div>
                <div className="space-y-0.5">
                  {globalEntries.map((e) => (
                    <EntryRow key={e.path} entry={e} active={e.path === selectedPath} onClick={() => setSelectedPath(e.path)} onDelete={() => handleDelete(e)} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {selectedEntry && (
            <div className="rounded-[var(--gd-radius-md)] p-3" style={{ background: "var(--gd-surface)", boxShadow: "var(--gd-panel-shadow)" }}>
              <div className="flex items-center gap-1.5 mb-2">
                <span
                  className="text-[9.5px] uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                  style={{ background: "var(--gd-metal-1)", color: "var(--gd-text-muted)" }}
                >
                  {titleCase(selectedEntry.type)}
                </span>
                {selectedEntry.status && (
                  <span
                    className="text-[9.5px] uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                    style={{
                      background: selectedEntry.status === "open" ? "var(--gd-warning-soft)" : "var(--gd-success-soft)",
                      color: selectedEntry.status === "open" ? "var(--gd-warning)" : "var(--gd-success)",
                    }}
                  >
                    {selectedEntry.status}
                  </span>
                )}
                <span className="text-[10px] ml-auto" style={{ color: "var(--gd-text-faint)" }}>
                  {relativeTime(selectedEntry.modifiedAtMs)}
                </span>
              </div>
              <div className="text-[12px]" style={{ color: "var(--gd-text)" }}>
                <MarkdownMessage text={selectedEntry.body} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
