import { useEffect, useMemo, useState } from "react";
import { useSessionStore, type ChatSession } from "../store/sessions";
import { extractMediaGen, extractPrompt } from "../lib/assets";
import { readImageDataUrl } from "../lib/api";
import { GeneratedImage } from "./GeneratedImage";

interface AssetRow {
  kind: "image" | "video";
  path: string;
  filename: string;
  prompt?: string;
  sessionTitle: string;
  ts: number;
}

// Assets are collected from sessions we already have client-side (this app's
// own persisted store), not by scanning grok's session directories on disk —
// that would need to parse grok's own JSONL history format just to recover
// the prompt text, which isn't a format we've confirmed as stable. Every
// image/video generated through Anvil already has its tool-call data sitting
// in a session's timeline, prompt included, so reusing that is both simpler
// and more robust. The tradeoff: assets generated via grok's native TUI
// (outside this app) won't show up here.
function collectAssets(sessions: Record<string, ChatSession>, cwd?: string): AssetRow[] {
  const out: AssetRow[] = [];
  const seenPaths = new Set<string>();
  for (const session of Object.values(sessions)) {
    if (cwd && session.cwd !== cwd) continue;
    for (const item of session.timeline) {
      if (item.sessionUpdate !== "tool_call" && item.sessionUpdate !== "tool_call_update") continue;
      const media = extractMediaGen(item.raw);
      if (!media || seenPaths.has(media.path)) continue;
      seenPaths.add(media.path);
      out.push({
        ...media,
        prompt: extractPrompt(item.raw),
        sessionTitle: session.title,
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

function RegenerateIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path
        d="M13.5 8A5.5 5.5 0 1 1 11.8 4M13.5 2v3.5H10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AssetCard({ asset }: { asset: AssetRow }) {
  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const setComposerDraft = useSessionStore((s) => s.setComposerDraft);

  useEffect(() => {
    let cancelled = false;
    readImageDataUrl(asset.path)
      .then((result) => {
        if (!cancelled) setDataUrl(result.dataUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.path]);

  function handleRegenerate(e: React.MouseEvent) {
    e.stopPropagation();
    const draft = asset.prompt
      ? `Generate a new variation of this image prompt: "${asset.prompt}" — keep the same subject and style, but make it a fresh take.`
      : `Generate a variation of the image at ${asset.path} — keep the same subject and style, but make it a fresh take.`;
    setComposerDraft(draft);
  }

  return (
    <div className="rounded-[var(--gd-radius-md)] border overflow-hidden" style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)" }}>
      <div className="aspect-square" style={{ background: "var(--gd-metal-1)" }}>
        {failed ? (
          <div className="h-full w-full flex items-center justify-center text-[10px] text-center px-2" style={{ color: "var(--gd-text-faint)" }}>
            Couldn't load
          </div>
        ) : dataUrl ? (
          asset.kind === "video" ? (
            <div className="h-full w-full flex items-center justify-center text-[22px]" title={asset.filename}>
              🎬
            </div>
          ) : (
            <GeneratedImage
              src={dataUrl}
              path={asset.path}
              alt={asset.filename}
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <div className="h-full w-full animate-pulse" />
        )}
      </div>
      <div className="p-2">
        <div
          className="text-[11px] leading-snug line-clamp-2 mb-1"
          title={asset.prompt}
          style={{ color: "var(--gd-text)", minHeight: "2.6em" }}
        >
          {asset.prompt || asset.filename || "Generated image"}
        </div>
        <div className="flex items-center justify-between gap-1">
          <div className="text-[10px] truncate" style={{ color: "var(--gd-text-faint)" }} title={asset.sessionTitle}>
            {asset.sessionTitle} · {timeAgo(asset.ts)}
          </div>
          <button
            onClick={handleRegenerate}
            aria-label="Regenerate"
            title="Prefill composer with a variation prompt"
            className="gd-glow-hover shrink-0 h-6 w-6 rounded-full flex items-center justify-center transition"
            style={{ color: "var(--gd-text-muted)", border: "1px solid var(--gd-border)" }}
          >
            <RegenerateIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AssetsPanel({ cwd }: { cwd?: string }) {
  const sessions = useSessionStore((s) => s.sessions);
  const assets = useMemo(() => collectAssets(sessions, cwd), [sessions, cwd]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-2">
      {assets.length === 0 ? (
        <div className="text-[12px] px-2 py-6 text-center" style={{ color: "var(--gd-text-faint)" }}>
          No generated images yet in this project. Ask grok to generate one and it'll show up here.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {assets.map((asset) => (
            <AssetCard key={asset.path} asset={asset} />
          ))}
        </div>
      )}
    </div>
  );
}
