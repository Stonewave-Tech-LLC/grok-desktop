import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ChatSession, TimelineItem } from "../store/sessions";
import { useSessionStore } from "../store/sessions";
import { downloadImage, readImageDataUrl } from "../lib/api";
import {
  extractAspect,
  extractMediaGen,
  extractPrompt,
  imagineVerb,
  isImagineTool,
  relativizePath,
} from "../lib/assets";

const ease = [0.16, 1, 0.3, 1] as const;

const VERB_LABEL = {
  generate: "Forging",
  edit: "Reforging",
  animate: "Animating",
} as const;

interface ImagineEvent {
  toolCallId?: string;
  status: string;
  verb: "generate" | "edit" | "animate";
  prompt?: string;
  aspect?: string;
  path?: string;
  filename?: string;
  kind?: "image" | "video";
}

function latestImagine(timeline: TimelineItem[]): ImagineEvent | undefined {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i];
    if (item.sessionUpdate !== "tool_call" && item.sessionUpdate !== "tool_call_update") continue;
    if (!isImagineTool(item.raw)) continue;
    const media = extractMediaGen(item.raw);
    const status = typeof item.raw.status === "string" ? item.raw.status : "pending";
    return {
      toolCallId: item.toolCallId,
      status,
      verb: imagineVerb(item.raw),
      prompt: extractPrompt(item.raw),
      aspect: extractAspect(item.raw),
      path: media?.path,
      filename: media?.filename,
      kind: media?.kind,
    };
  }
  return undefined;
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ImagineOverlay({ session }: { session: ChatSession }) {
  const imagineAutoOpen = useSessionStore((s) => s.imagineAutoOpen);
  const setComposerDraft = useSessionStore((s) => s.setComposerDraft);
  const openDockTab = useSessionStore((s) => s.openDockTab);
  const event = useMemo(() => latestImagine(session.timeline), [session.timeline]);

  const [dismissedId, setDismissedId] = useState<string | undefined>(undefined);
  const lastCompleteId = useRef<string | undefined>(undefined);

  const hasMedia = Boolean(event?.path);
  const running = Boolean(event && event.status !== "failed" && !hasMedia);
  const complete = Boolean(event && event.status !== "failed" && hasMedia);
  const eventKey = event?.toolCallId ?? (event?.path ? `path:${event.path}` : undefined);

  // A completed image always surfaces, even if the user dismissed the
  // generating plate — that's the "the picture should be visible" rule.
  // Dismissing the finished frame is sticky for that toolCallId only.
  useEffect(() => {
    if (!event || !eventKey) return;
    if (complete && lastCompleteId.current !== eventKey) {
      lastCompleteId.current = eventKey;
      setDismissedId(undefined);
    }
  }, [complete, event, eventKey]);

  const open = Boolean(imagineAutoOpen && event && eventKey && dismissedId !== eventKey && (running || complete));

  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!event?.path || event.kind === "video") {
      setDataUrl(undefined);
      return;
    }
    let cancelled = false;
    readImageDataUrl(event.path)
      .then((result) => {
        if (!cancelled) setDataUrl(result.dataUrl);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [event?.path, event?.kind]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDismissedId(eventKey);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, eventKey]);

  function dismiss() {
    setDismissedId(eventKey);
  }

  function useInChat(kind: "edit" | "animate" | "vary") {
    if (!event?.path) return;
    const rel = relativizePath(event.path, session.cwd);
    if (kind === "edit") setComposerDraft(`Edit the image at @${rel}: `);
    else if (kind === "animate") setComposerDraft(`Animate the image at @${rel} into a short 6s shot: `);
    else {
      const prompt = event.prompt ? `"${event.prompt}"` : `@${rel}`;
      setComposerDraft(`Generate a new variation of ${prompt} — same subject and style, fresh take.`);
    }
    dismiss();
  }

  return (
    <AnimatePresence>
      {open && event && (
        <motion.div
          key={eventKey ?? "imagine"}
          role="dialog"
          aria-label={running ? "Generating image" : "Generated image"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="absolute inset-0 z-40 flex items-center justify-center"
          style={{ background: "rgba(6,6,8,0.82)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
          onClick={dismiss}
        >
          <div className="gd-imagine-grain absolute inset-0" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss();
            }}
            aria-label="Close"
            title="Close"
            className="gd-glow-hover absolute top-4 right-4 z-10 h-8 w-8 rounded-full flex items-center justify-center"
            style={{ background: "var(--gd-surface-raised)", color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)" }}
          >
            <CloseIcon />
          </button>

          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.35, ease }}
            className="relative z-[1] flex flex-col items-center px-6 max-w-[min(920px,92vw)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[11px] font-mono uppercase tracking-[0.28em] mb-4" style={{ color: "var(--gd-text-faint)" }}>
              {running ? VERB_LABEL[event.verb] : event.kind === "video" ? "Motion" : "Still"}
            </div>

            {complete && dataUrl ? (
              <motion.img
                key={event.path}
                src={dataUrl}
                alt={event.prompt || event.filename || "Generated image"}
                initial={{ opacity: 0, scale: 0.94, filter: "blur(16px) brightness(1.4)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px) brightness(1)" }}
                transition={{ duration: 0.7, ease }}
                className="max-h-[68vh] max-w-full rounded-[var(--gd-radius-lg)]"
                style={{ boxShadow: "0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)" }}
              />
            ) : complete && event.kind === "video" ? (
              <div
                className="w-[min(560px,80vw)] aspect-video rounded-[var(--gd-radius-lg)] flex items-center justify-center"
                style={{ background: "var(--gd-metal-1)", border: "1px solid var(--gd-border-strong)" }}
              >
                <div className="text-center">
                  <div className="text-[13px] font-medium" style={{ color: "var(--gd-text)" }}>
                    Video ready
                  </div>
                  <div className="text-[11px] mt-1 font-mono" style={{ color: "var(--gd-text-faint)" }}>
                    {event.filename || event.path}
                  </div>
                </div>
              </div>
            ) : (
              <div className="gd-imagine-ring w-[min(420px,78vw)] aspect-[4/3] p-[1px]">
                <div className="gd-imagine-plate relative h-full w-full flex flex-col items-center justify-center">
                  <div className="gd-imagine-scan" />
                  <div className="gd-imagine-wordmark relative z-[1] font-semibold" style={{ color: "var(--gd-text)" }}>
                    IMAGINE
                  </div>
                  <div className="gd-heat-scan relative z-[1] mt-6" style={{ width: 160, height: 2 }} />
                </div>
              </div>
            )}

            {event.prompt && (
              <div
                className="mt-5 max-w-[520px] text-center text-[13px] leading-relaxed line-clamp-3"
                style={{ color: "var(--gd-text-muted)" }}
                title={event.prompt}
              >
                {event.prompt}
              </div>
            )}
            {event.aspect && event.aspect !== "auto" && (
              <div className="mt-2 text-[10px] font-mono uppercase tracking-wide" style={{ color: "var(--gd-text-faint)" }}>
                {event.aspect}
              </div>
            )}

            {complete && event.path && (
              <div className="mt-5 flex items-center gap-2">
                <button
                  onClick={() => downloadImage(event.path!)}
                  className="gd-glow-hover text-[12px] font-medium px-3 py-1.5 rounded-[var(--gd-radius-sm)]"
                  style={{ color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)" }}
                >
                  Download
                </button>
                {event.kind !== "video" && (
                  <>
                    <button
                      onClick={() => useInChat("edit")}
                      className="gd-glow-hover text-[12px] font-medium px-3 py-1.5 rounded-[var(--gd-radius-sm)]"
                      style={{ color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)" }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => useInChat("animate")}
                      className="gd-glow-hover text-[12px] font-medium px-3 py-1.5 rounded-[var(--gd-radius-sm)]"
                      style={{ color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)" }}
                    >
                      Animate
                    </button>
                    <button
                      onClick={() => useInChat("vary")}
                      className="gd-glow-hover text-[12px] font-medium px-3 py-1.5 rounded-[var(--gd-radius-sm)]"
                      style={{ color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)" }}
                    >
                      Vary
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    openDockTab("assets");
                    dismiss();
                  }}
                  className="gd-billet text-[12px] font-semibold px-3 py-1.5 rounded-[var(--gd-radius-sm)]"
                >
                  Open Studio
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}