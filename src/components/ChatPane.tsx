import { useEffect, useRef } from "react";
import type { ChatSession, PendingPermission } from "../store/sessions";
import { MarkdownMessage } from "./MarkdownMessage";
import { ToolCallCard } from "./ToolCallCard";
import { PermissionCard } from "./PermissionCard";
import { useSessionStore } from "../store/sessions";

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

export function ChatPane({ session, permissions }: { session: ChatSession; permissions: PendingPermission[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const resolvePermission = useSessionStore((s) => s.resolvePermission);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.timeline.length, session.streamingText, permissions.length]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="max-w-2xl mx-auto space-y-1">
        {session.timeline.map((item) => {
          if (item.sessionUpdate === "user_message") {
            return (
              <div key={item.id} className="flex justify-end gd-enter">
                <div
                  className="max-w-lg rounded-[var(--gd-radius-lg)] px-3.5 py-2 text-[14px]"
                  style={{ background: "var(--gd-accent)", color: "var(--gd-accent-contrast)" }}
                >
                  {String(item.raw.text ?? "")}
                </div>
              </div>
            );
          }
          if (item.sessionUpdate === "agent_message_final") {
            return (
              <div key={item.id} className="text-[14px] leading-relaxed gd-enter" style={{ color: "var(--gd-text)" }}>
                <MarkdownMessage text={String(item.raw.text ?? "")} />
              </div>
            );
          }
          if (item.sessionUpdate === "agent_thought_chunk") {
            const content = item.raw.content as Record<string, unknown> | undefined;
            const text = content && typeof content.text === "string" ? content.text : "";
            return (
              <div
                key={item.id}
                className="text-[12px] italic px-3 py-1.5 rounded-[var(--gd-radius-md)] my-1 max-w-xl gd-enter"
                style={{ color: "var(--gd-text-faint)", background: "var(--gd-surface)" }}
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
            <MarkdownMessage text={session.streamingText} />
          </div>
        )}

        {session.status === "thinking" && !session.streamingText && <ThinkingDots />}

        {permissions.map((p) => (
          <PermissionCard key={JSON.stringify(p.id)} permission={p} onResolved={() => resolvePermission(p.id)} />
        ))}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
