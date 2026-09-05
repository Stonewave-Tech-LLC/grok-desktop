import { useEffect, useRef, useState } from "react";
import type { ChatSession, PendingPermission } from "../store/sessions";
import { MarkdownMessage } from "./MarkdownMessage";
import { ToolCallCard } from "./ToolCallCard";
import { PermissionCard } from "./PermissionCard";
import { PlanApprovalCard } from "./PlanApprovalCard";
import { AskUserQuestionCard } from "./AskUserQuestionCard";
import { useSessionStore } from "../store/sessions";
import { EmptyCanvas } from "./EmptyCanvas";

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full animate-bounce"
          style={{
            background: "var(--gd-accent)",
            animationDelay: `${i * 120}ms`,
            animationDuration: "900ms",
          }}
        />
      ))}
    </div>
  );
}

// How close to the bottom (px) still counts as "at the bottom" for
// auto-follow purposes — a little slack so the smooth-scroll animation
// settling doesn't itself get read as "the user scrolled away".
const NEAR_BOTTOM_PX = 120;

export function ChatPane({ session, permissions }: { session: ChatSession; permissions: PendingPermission[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const resolvePermission = useSessionStore((s) => s.resolvePermission);

  // Track whether the user is near the bottom, so new streamed content only
  // auto-follows when they were already there — scrolling up to read while
  // grok is still writing used to get yanked back down on every token.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX);
    }
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (atBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.timeline.length, session.streamingText, permissions.length, atBottom]);

  // Switching sessions should always land at the bottom, regardless of
  // wherever the previously-viewed session happened to be scrolled.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    setAtBottom(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setAtBottom(true);
  }

  const isBlank =
    session.timeline.length === 0 &&
    !session.streamingText &&
    session.status === "idle" &&
    permissions.length === 0;

  return (
    <div className="flex-1 min-h-0 relative">
      {isBlank ? (
        <EmptyCanvas kind="empty-session" />
      ) : (
      <div ref={containerRef} className="h-full overflow-y-auto px-6 py-5">
      <div className="max-w-4xl mx-auto space-y-1">
        {session.timeline.map((item, idx) => {
          const isLive = idx === session.timeline.length - 1 && session.status === "thinking";
          if (item.sessionUpdate === "user_message") {
            return (
              <div key={item.id} className="flex justify-end gd-enter">
                <div
                  className="max-w-lg rounded-[var(--gd-radius-lg)] px-3.5 py-2 text-[14px] border"
                  style={{ background: "var(--gd-metal-2)", color: "var(--gd-text)", borderColor: "var(--gd-border-strong)" }}
                >
                  {String(item.raw.text ?? "")}
                </div>
              </div>
            );
          }
          if (item.sessionUpdate === "agent_message_final") {
            return (
              <div key={item.id} className="text-[14px] leading-relaxed gd-enter" style={{ color: "var(--gd-text)" }}>
                <MarkdownMessage text={String(item.raw.text ?? "")} cwd={session.cwd} sessionId={session.id} />
              </div>
            );
          }
          if (item.sessionUpdate === "agent_thought_chunk") {
            const content = item.raw.content as Record<string, unknown> | undefined;
            const text = content && typeof content.text === "string" ? content.text : "";
            // The first chunk of a new thought can land with empty/whitespace
            // text before any real tokens have streamed in — rendering the
            // padded, bordered box for that produces a visibly empty block
            // that then "pops" once text finally appears. Skip the box
            // entirely until there's something to actually show.
            if (!text.trim()) return null;
            return (
              <div
                key={item.id}
                className={
                  isLive
                    ? "gd-shimmer text-[12px] italic px-3 py-1.5 rounded-[var(--gd-radius-md)] my-1 max-w-xl gd-enter"
                    : "text-[12px] italic px-3 py-1.5 rounded-[var(--gd-radius-md)] my-1 max-w-xl gd-enter"
                }
                style={isLive ? { background: "var(--gd-surface)" } : { color: "var(--gd-text-faint)", background: "var(--gd-surface)" }}
              >
                {text}
              </div>
            );
          }
          if (item.sessionUpdate === "tool_call" || item.sessionUpdate === "tool_call_update") {
            return (
              <div key={item.id} className="gd-enter">
                <ToolCallCard raw={item.raw} />
              </div>
            );
          }
          // Unknown/other update kinds — render minimally rather than
          // dropping data on the floor.
          return (
            <details key={item.id} className="text-[11px] my-1 gd-enter" style={{ color: "var(--gd-text-faint)" }}>
              <summary>{item.sessionUpdate}</summary>
              <pre className="whitespace-pre-wrap">{JSON.stringify(item.raw, null, 2)}</pre>
            </details>
          );
        })}

        {session.streamingText && (
          <div className="text-[14px] leading-relaxed" style={{ color: "var(--gd-text)" }}>
            <MarkdownMessage text={session.streamingText} cwd={session.cwd} sessionId={session.id} />
          </div>
        )}

        {session.status === "thinking" && !session.streamingText && <ThinkingDots />}

        {permissions.map((p) => {
          const key = JSON.stringify(p.id);
          const onResolved = () => resolvePermission(p.id);
          // exit_plan_mode/ask_user_question are ACP ext_methods with their own
          // response shapes — genuinely different from a regular tool-permission
          // request, not just a styling choice. See those cards' own doc
          // comments for the (confirmed against grok-build's source) wire shapes.
          if (p.method === "x.ai/exit_plan_mode") {
            return <PlanApprovalCard key={key} permission={p} onResolved={onResolved} />;
          }
          if (p.method === "x.ai/ask_user_question") {
            return <AskUserQuestionCard key={key} permission={p} onResolved={onResolved} />;
          }
          return <PermissionCard key={key} permission={p} onResolved={onResolved} />;
        })}

        <div ref={bottomRef} />
      </div>
      </div>
      )}

      {!atBottom && (
        <button
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          title="Scroll to bottom"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 h-9 w-9 rounded-full flex items-center justify-center transition gd-glow-hover gd-pop"
          style={{ background: "var(--gd-surface-raised)", color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)", boxShadow: "0 4px 16px rgba(0,0,0,0.35)" }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v10M8 12l-3.5-3.5M8 12l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
