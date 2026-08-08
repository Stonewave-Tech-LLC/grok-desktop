import { useState } from "react";
import type { PendingPermission } from "../store/sessions";
import type { JsonValue } from "../types/acp";
import { respondExt } from "../lib/api";
import { MarkdownMessage } from "./MarkdownMessage";

// Renders grok's `x.ai/exit_plan_mode` ACP ext_method request — genuinely
// different from a regular tool-permission prompt (see PermissionCard):
// wire shape confirmed against grok-build's own source
// (xai-grok-tools/src/implementations/grok_build/exit_plan_mode/types.rs).
// Request: { sessionId, toolCallId, planContent }.
// Response: { outcome: "approved" | "cancelled" | "abandoned", feedback?: string }
// — a flat object, NOT the generic session/request_permission envelope. Grok
// Desktop used to funnel this through the generic permission flow, which
// always sent the wrong shape back — the agent's own deserializer failed (or
// silently defaulted), so "Approve" behaved like "Request changes" no matter
// what was clicked. This card sends the exact shape instead.
export function PlanApprovalCard({ permission, onResolved }: { permission: PendingPermission; onResolved: () => void }) {
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  const planContent = typeof permission.params.planContent === "string" ? permission.params.planContent : "";

  async function respond(result: JsonValue) {
    setBusy(true);
    try {
      await respondExt(permission.id, result);
      onResolved();
    } finally {
      setBusy(false);
    }
  }

  function approve() {
    respond({ outcome: "approved" });
  }

  function sendRevision() {
    const trimmed = feedback.trim();
    respond(trimmed ? { outcome: "cancelled", feedback: trimmed } : { outcome: "cancelled" });
  }

  function abandon() {
    respond({ outcome: "abandoned" });
  }

  return (
    <div
      className="rounded-[var(--gd-radius-md)] border my-2 max-w-xl overflow-hidden"
      style={{ borderColor: "var(--gd-accent)", background: "var(--gd-surface)" }}
    >
      <div className="px-3.5 py-2.5 border-b" style={{ borderColor: "var(--gd-border)" }}>
        <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: "var(--gd-accent)" }}>
          Plan ready for review
        </div>
      </div>
      {planContent && (
        <div className="px-3.5 py-3 max-h-80 overflow-y-auto text-[13px] leading-relaxed" style={{ color: "var(--gd-text)" }}>
          <MarkdownMessage text={planContent} sessionId={permission.sessionId} />
        </div>
      )}

      {revising ? (
        <div className="px-3.5 pb-3.5 pt-1">
          <textarea
            autoFocus
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What should change? (optional — leave blank to just ask for a revision)"
            rows={3}
            disabled={busy}
            className="w-full resize-none rounded-[var(--gd-radius-sm)] px-2.5 py-2 text-[12.5px] outline-none"
            style={{ background: "var(--gd-bg)", color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)" }}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={sendRevision}
              disabled={busy}
              className="gd-billet text-[12px] font-semibold px-3 py-1.5 rounded-[var(--gd-radius-sm)] disabled:opacity-50"
            >
              Send feedback
            </button>
            <button
              onClick={() => setRevising(false)}
              disabled={busy}
              className="text-[12px] font-medium px-3 py-1.5 rounded-[var(--gd-radius-sm)]"
              style={{ background: "var(--gd-surface-raised)", color: "var(--gd-text-muted)", border: "1px solid var(--gd-border)" }}
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 px-3.5 pb-3.5 pt-1">
          <button
            onClick={approve}
            disabled={busy}
            className="gd-billet text-[12px] font-semibold px-3.5 py-1.5 rounded-[var(--gd-radius-sm)] disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => setRevising(true)}
            disabled={busy}
            className="text-[12px] font-medium px-3.5 py-1.5 rounded-[var(--gd-radius-sm)]"
            style={{ background: "var(--gd-surface-raised)", color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)" }}
          >
            Request changes
          </button>
          <button
            onClick={abandon}
            disabled={busy}
            className="text-[12px] font-medium px-3.5 py-1.5 rounded-[var(--gd-radius-sm)]"
            style={{ background: "var(--gd-surface)", color: "var(--gd-danger)", border: "1px solid var(--gd-border)" }}
          >
            Abandon plan
          </button>
        </div>
      )}
    </div>
  );
}
