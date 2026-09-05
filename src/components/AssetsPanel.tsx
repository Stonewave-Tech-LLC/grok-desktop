import { useEffect, useMemo, useState } from "react";
import { useSessionStore, type ChatSession } from "../store/sessions";
import { extractAspect, extractMediaGen, extractPrompt, isImagineTool, relativizePath } from "../lib/assets";
import { readImageDataUrl } from "../lib/api";
import { GeneratedImage } from "./GeneratedImage";

interface AssetRow {
  kind: "image" | "video";
  path: string;
  filename: string;
  prompt?: string;
  aspect?: string;
  sessionTitle: string;
  sessionId: string;
  ts: number;
}

function collectAssets(sessions: Record<string, ChatSession>, cwd?: string): AssetRow[] {
  const out: AssetRow[] = [];
  const seenPaths = new Set<string>();
  for (const session of Object.values(sessions)) {
    if (cwd && session.cwd !== cwd) continue;
    for (const item of session.timeline) {
      if (item.sessionUpdate !== "tool_call" && item.sessionUpdate !== "tool_call_update") continue;
      if (!isImagineTool(item.raw) && !extractMediaGen(item.raw)) continue;
      const media = extractMediaGen(item.raw);
      if (!media || seenPaths.has(media.path)) continue;
      seenPaths.add(media.path);
      out.push({
        ...media,
        prompt: extractPrompt(item.raw),
        aspect: extractAspect(item.raw),
        sessionTitle: session.title,
        sessionId: session.id,
        ts: item.ts,
      });
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

function timeAgo(ts: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function familyKey(prompt?: string): string {
  const t = (prompt || "").trim().toLowerCase().replace(/\s+/g, " ");
  return t ? t.slice(0, 80) : "__untitled";
}

function useThumb(path: string | undefined) {
  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) return;
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
  return { dataUrl, failed };
}

function Action({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="gd-glow-hover text-[11px] font-medium px-2 py-1 rounded-[var(--gd-radius-sm)]"
      style={{ color: "var(--gd-text)", border: "1px solid var(--gd-border)" }}
    >
      {label}
    </button>
  );
}

function AssetThumb({ asset, className }: { asset: AssetRow; className?: string }) {
  const { dataUrl, failed } = useThumb(asset.kind === "image" ? asset.path : undefined);
  if (failed) {
    return (
      <div className={className} style={{ background: "var(--gd-metal-1)", color: "var(--gd-text-faint)" }}>
        <div className="h-full w-full flex items-center justify-center text-[10px]">Couldn't load</div>
      </div>
    );
  }
  if (asset.kind === "video") {
    return (
      <div className={className} style={{ background: "var(--gd-metal-1)" }}>
        <div className="h-full w-full flex items-center justify-center text-[11px]" style={{ color: "var(--gd-text-muted)" }}>
          Motion
        </div>
      </div>
    );
  }
  if (!dataUrl) return <div className={className + " animate-pulse"} style={{ background: "var(--gd-metal-1)" }} />;
  return <GeneratedImage src={dataUrl} path={asset.path} alt={asset.filename} className={className} />;
}

export function AssetsPanel({ cwd }: { cwd?: string }) {
  const sessions = useSessionStore((s) => s.sessions);
  const setComposerDraft = useSessionStore((s) => s.setComposerDraft);
  const assets = useMemo(() => collectAssets(sessions, cwd), [sessions, cwd]);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (filter !== "all" && a.kind !== filter) return false;
      if (q && !(a.prompt || a.filename).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assets, filter, query]);

  const families = useMemo(() => {
    const map = new Map<string, AssetRow[]>();
    for (const a of visible) {
      const key = familyKey(a.prompt);
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [visible]);

  const hero = visible[0];

  function draft(asset: AssetRow, kind: "edit" | "animate" | "vary" | "reference") {
    const rel = cwd ? relativizePath(asset.path, cwd) : asset.path;
    if (kind === "edit") setComposerDraft(`Edit the image at @${rel}: `);
    else if (kind === "animate") setComposerDraft(`Animate the image at @${rel} into a short 6s shot: `);
    else if (kind === "reference") setComposerDraft(`Use @${rel} as a visual reference. `);
    else {
      const prompt = asset.prompt ? `"${asset.prompt}"` : `@${rel}`;
      setComposerDraft(`Generate a new variation of ${prompt} — same subject and style, fresh take.`);
    }
  }

  if (assets.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-5 text-center">
        <div className="text-[11px] font-mono uppercase tracking-[0.22em] mb-3" style={{ color: "var(--gd-text-faint)" }}>
          Studio
        </div>
        <div className="text-[15px] font-semibold mb-2" style={{ color: "var(--gd-text)" }}>
          Nothing forged yet
        </div>
        <div className="text-[12px] leading-relaxed max-w-[240px]" style={{ color: "var(--gd-text-muted)" }}>
          Ask grok to imagine a still or a shot. This is a working set — edit, animate, and reuse from here, not a dump of files.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 pb-2 flex flex-col gap-2 shrink-0">
        <div className="flex items-center gap-1">
          {(["all", "image", "video"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="h-6 px-2 rounded-full text-[10.5px] font-medium"
              style={{
                color: filter === f ? "var(--gd-text)" : "var(--gd-text-faint)",
                background: filter === f ? "var(--gd-accent-soft)" : "transparent",
                border: filter === f ? "1px solid var(--gd-border-strong)" : "1px solid transparent",
              }}
            >
              {f === "all" ? "All" : f === "image" ? "Stills" : "Motion"}
            </button>
          ))}
          <span className="ml-auto text-[10px] font-mono" style={{ color: "var(--gd-text-faint)" }}>
            {visible.length}
          </span>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search prompts…"
          className="h-7 px-2.5 text-[12px] rounded-[var(--gd-radius-sm)] border outline-none"
          style={{ background: "var(--gd-bg)", color: "var(--gd-text)", borderColor: "var(--gd-border)" }}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-4">
        {hero && (
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wide mb-1.5" style={{ color: "var(--gd-text-faint)" }}>
              Latest
            </div>
            <div className="rounded-[var(--gd-radius-md)] overflow-hidden border" style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)" }}>
              <AssetThumb asset={hero} className="w-full aspect-[4/3] object-cover" />
              <div className="p-2.5">
                <div className="text-[12px] leading-snug line-clamp-3 mb-2" style={{ color: "var(--gd-text)" }}>
                  {hero.prompt || hero.filename}
                </div>
                <div className="text-[10px] mb-2" style={{ color: "var(--gd-text-faint)" }}>
                  {hero.sessionTitle} · {timeAgo(hero.ts)}
                  {hero.aspect && hero.aspect !== "auto" ? ` · ${hero.aspect}` : ""}
                </div>
                <div className="flex flex-wrap gap-1">
                  {hero.kind === "image" && (
                    <>
                      <Action label="Edit" onClick={() => draft(hero, "edit")} />
                      <Action label="Animate" onClick={() => draft(hero, "animate")} />
                      <Action label="Vary" onClick={() => draft(hero, "vary")} />
                      <Action label="Use as ref" onClick={() => draft(hero, "reference")} />
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {families.map(([key, group]) => {
          const rest = hero && group[0]?.path === hero.path ? group.slice(1) : group.filter((a) => a.path !== hero?.path);
          if (rest.length === 0 && hero && familyKey(hero.prompt) === key) return null;
          const label = group[0]?.prompt || "Untitled";
          const show = rest.length ? rest : group;
          return (
            <div key={key}>
              <div className="text-[10px] font-mono uppercase tracking-wide mb-1.5 line-clamp-1" style={{ color: "var(--gd-text-faint)" }} title={label}>
                {label}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {show.map((asset) => (
                  <button
                    key={asset.path}
                    onClick={() => draft(asset, asset.kind === "video" ? "reference" : "edit")}
                    className="rounded-[var(--gd-radius-sm)] overflow-hidden border text-left"
                    style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)" }}
                    title="Prefill composer to continue this"
                  >
                    <AssetThumb asset={asset} className="w-full aspect-square object-cover" />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
