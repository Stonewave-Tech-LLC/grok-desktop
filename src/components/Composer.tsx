import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { currentModelInfo, pickFiles, startVoice, stopVoice, onVoiceEvent, type ModelInfo } from "../lib/api";
import { TokenUsagePopover } from "./TokenUsagePopover";
import { useSessionStore } from "../store/sessions";

function relativizePath(absPath: string, cwd: string): string {
  const normCwd = cwd.endsWith("/") ? cwd : `${cwd}/`;
  if (absPath === cwd) return ".";
  if (absPath.startsWith(normCwd)) return absPath.slice(normCwd.length);
  return absPath;
}

function tokenBadgeColor(pct: number): string {
  if (pct >= 80) return "danger";
  if (pct >= 50) return "warning";
  return "success";
}

export function Composer({
  disabled,
  isStreaming,
  sessionId,
  cwd,
  yolo,
  contextTokensUsed,
  onSend,
  onCancel,
}: {
  disabled: boolean;
  isStreaming: boolean;
  sessionId: string;
  cwd: string;
  yolo: boolean;
  contextTokensUsed?: number;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [modelInfo, setModelInfo] = useState<ModelInfo | undefined>(undefined);
  const [listening, setListening] = useState(false);
  const [voiceLocale, setVoiceLocale] = useState<string | undefined>(undefined);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Text already in the box when voice mode starts — live transcript updates
  // append after this instead of clobbering it, so starting voice mode with
  // a half-typed message doesn't just throw it away.
  const voicePrefixRef = useRef("");
  // Guards against a trailing "partial"/"final" event landing after the user
  // already finalized (first Enter) or sent (second Enter) — the helper's
  // stop is a signal, not instant, so a stray late event is expected, not a
  // bug; it just shouldn't be allowed to overwrite text the user has already
  // moved past.
  const listeningRef = useRef(false);
  const composerDraft = useSessionStore((s) => s.composerDraft);
  const setComposerDraft = useSessionStore((s) => s.setComposerDraft);
  const setLastError = useSessionStore((s) => s.setLastError);

  useEffect(() => {
    currentModelInfo()
      .then(setModelInfo)
      .catch(() => {});
  }, []);

  // One-shot prefill from outside the composer (e.g. AssetsPanel's Regenerate
  // button) — consume it once, then clear it in the store so it can't refire
  // (a second "Regenerate" click with the same text wouldn't otherwise change
  // the store value and so wouldn't re-trigger this effect).
  useEffect(() => {
    if (composerDraft === undefined) return;
    setText(composerDraft);
    setComposerDraft(undefined);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      if (taRef.current) {
        taRef.current.style.height = "auto";
        taRef.current.style.height = `${Math.min(taRef.current.scrollHeight, 200)}px`;
      }
    });
  }, [composerDraft, setComposerDraft]);

  // Live speech-to-text updates from the native voice helper — see
  // src-tauri/src/voice.rs. Subscribed once for the component's lifetime;
  // `listeningRef` (not the `listening` state) gates whether an event still
  // applies, so this closure doesn't need to be re-subscribed on every
  // start/stop.
  useEffect(() => {
    const unlisten = onVoiceEvent((event) => {
      if (event.type === "locale") {
        setVoiceLocale(event.text);
      } else if (event.type === "partial" || event.type === "final") {
        if (!listeningRef.current) return;
        const prefix = voicePrefixRef.current;
        const spoken = event.text ?? "";
        const next = prefix.trim() ? `${prefix.trim()} ${spoken}` : spoken;
        setText(next);
      } else if (event.type === "error") {
        listeningRef.current = false;
        setListening(false);
        setLastError(`Voice mode: ${event.message ?? "unknown error"}`);
      }
      // "ready"/"ended" are informational only — listening state is driven
      // by the button/Enter handlers, not by these.
    });
    return () => {
      unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleVoice() {
    if (listening) {
      finalizeVoice();
      return;
    }
    voicePrefixRef.current = text;
    listeningRef.current = true;
    setListening(true);
    try {
      await startVoice();
    } catch (err) {
      listeningRef.current = false;
      setListening(false);
      setLastError(`Couldn't start voice mode: ${String(err)}`);
    }
  }

  // Stops listening and keeps whatever's currently in the box as normal,
  // committed input — does NOT send it. A second, separate Enter (now that
  // listening is false) goes through the regular submit() path below.
  function finalizeVoice() {
    listeningRef.current = false;
    setListening(false);
    stopVoice().catch(() => {});
  }

  // Files dropped anywhere on the window while this composer is mounted —
  // grok's own CLI convention for attaching a file is `@relative/path` inline
  // in the prompt text (see its "Use @ to attach files" tip), so we don't need
  // a separate upload API — just insert the token like the picker button does.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === "enter" || e.payload.type === "over") {
          setDragging(true);
        } else if (e.payload.type === "leave") {
          setDragging(false);
        } else if (e.payload.type === "drop") {
          setDragging(false);
          attachPaths(e.payload.paths);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  function attachPaths(paths: string[]) {
    if (!paths.length) return;
    const tokens = paths.map((p) => `@${relativizePath(p, cwd)}`).join(" ");
    setText((t) => (t.trim() ? `${t.trim()} ${tokens} ` : `${tokens} `));
    requestAnimationFrame(() => taRef.current?.focus());
  }

  async function handleAttachClick() {
    const paths = await pickFiles(cwd);
    attachPaths(paths);
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  }

  const model = modelInfo?.availableModels?.find((m) => m.modelId === modelInfo.currentModelId);
  const totalContextTokens = model?._meta?.totalContextTokens;
  const tokenPct =
    typeof contextTokensUsed === "number" && typeof totalContextTokens === "number" && totalContextTokens > 0
      ? Math.min(100, Math.round((contextTokensUsed / totalContextTokens) * 1000) / 10)
      : undefined;
  const tokenColor = tokenPct !== undefined ? tokenBadgeColor(tokenPct) : undefined;

  return (
    <div className="p-4 border-t" style={{ borderColor: "var(--gd-border)" }}>
      <div className="max-w-4xl mx-auto flex items-end gap-2">
        {/* Left: attach / voice / mode — outside the input box */}
        <div className="flex flex-col gap-1 shrink-0 items-start">
          <div className="flex items-center gap-1">
            <button
              onClick={handleAttachClick}
              disabled={disabled}
              aria-label="Attach files"
              title="Attach files"
              className="group h-8 w-8 rounded-[var(--gd-radius-sm)] flex items-center justify-center transition gd-glow-hover disabled:opacity-40 disabled:pointer-events-none"
              style={{ color: "var(--gd-text-muted)", border: "1px solid var(--gd-border)" }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 16 16"
                fill="none"
                className="transition-transform duration-200 group-hover:rotate-90"
              >
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <button
              onClick={toggleVoice}
              disabled={disabled}
              aria-label={listening ? "Stop voice mode" : "Voice mode"}
              title={
                listening
                  ? `Listening${voiceLocale ? ` (${voiceLocale})` : ""} — click or press Enter to stop`
                  : "Voice mode"
              }
              className={
                (listening ? "gd-pulse-accent" : "gd-glow-hover") +
                " h-8 w-8 rounded-[var(--gd-radius-sm)] flex items-center justify-center transition disabled:opacity-40 disabled:pointer-events-none"
              }
              style={{
                color: listening ? "var(--gd-accent-contrast)" : "var(--gd-text-muted)",
                background: listening ? "var(--gd-accent)" : "transparent",
                border: listening ? "1px solid var(--gd-accent)" : "1px solid var(--gd-border)",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <rect x="6" y="1.5" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <div
            title={
              yolo
                ? "Auto-accept was enabled when this session was created. Mode can't be changed mid-session yet."
                : "Grok will ask before editing files or running commands. Mode can't be changed mid-session yet."
            }
            className="inline-flex items-center gap-1 h-5 px-1.5 rounded-full text-[10px] font-medium select-none"
            style={{ color: "var(--gd-text-faint)", background: "var(--gd-metal-1)" }}
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5 3 4v4c0 3.5 2.2 6 5 6.5 2.8-.5 5-3 5-6.5V4L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            {yolo ? "Auto-accept" : "Ask before edits"}
          </div>
        </div>

        {/* Center: the actual input box, kept slim (just textarea + send) */}
        <div
          className="flex-1 rounded-[var(--gd-radius-lg)] border relative transition-shadow"
          style={{
            borderColor: dragging ? "var(--gd-accent)" : focused ? "var(--gd-accent)" : "var(--gd-border-strong)",
            background: "var(--gd-surface)",
            boxShadow: focused || dragging ? "0 0 0 3px var(--gd-accent-soft)" : "none",
          }}
        >
          {dragging && (
            <div
              className="absolute inset-0 z-10 rounded-[var(--gd-radius-lg)] flex items-center justify-center gd-enter pointer-events-none"
              style={{ background: "rgba(10,10,12,0.88)", border: "1.5px dashed var(--gd-border-glow)" }}
            >
              <div className="text-[13px] font-medium" style={{ color: "var(--gd-text)" }}>
                Drop to attach
              </div>
            </div>
          )}

          <div className="flex items-end gap-2 px-3.5 py-2.5">
            <textarea
              ref={taRef}
              value={text}
              placeholder="Message grok…"
              disabled={disabled}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (listening) {
                    finalizeVoice();
                  } else {
                    submit();
                  }
                }
              }}
              rows={1}
              className="flex-1 resize-none bg-transparent outline-none text-[14px] py-1 leading-relaxed"
              style={{
                color: listening ? "var(--gd-text-muted)" : "var(--gd-text)",
                fontStyle: listening ? "italic" : "normal",
                maxHeight: 200,
              }}
            />
            {isStreaming ? (
              <button
                onClick={onCancel}
                className="gd-pulse-danger shrink-0 h-8 w-8 rounded-full flex items-center justify-center"
                style={{ background: "var(--gd-danger-soft)", color: "var(--gd-danger)" }}
                aria-label="Stop"
                title="Stop generating"
              >
                <span className="block h-2.5 w-2.5 rounded-[2px]" style={{ background: "currentColor" }} />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={disabled || !text.trim()}
                className="gd-billet shrink-0 h-8 w-8 rounded-full flex items-center justify-center disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Send"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 13V3M8 3 3.5 7.5M8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Right: model + token usage — outside the input box */}
        <div className="flex flex-col gap-1 shrink-0 items-end">
          {model && (
            <div
              title="Active model"
              className="h-6 px-2 rounded-full flex items-center text-[11px] font-medium"
              style={{ background: "var(--gd-metal-1)", color: "var(--gd-text-muted)", border: "1px solid var(--gd-border)" }}
            >
              {model.name}
            </div>
          )}
          {tokenPct !== undefined && (
            <div className="relative">
              <button
                onClick={() => setCostOpen((o) => !o)}
                title="Click for cost & token breakdown"
                className="h-6 px-2 rounded-full flex items-center gap-1 text-[11px] font-medium transition hover:brightness-110"
                style={{
                  background: `var(--gd-${tokenColor}-soft)`,
                  color: `var(--gd-${tokenColor})`,
                }}
              >
                <span className="block h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
                {tokenPct}%
              </button>
              {costOpen && <TokenUsagePopover sessionId={sessionId} onClose={() => setCostOpen(false)} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
