import { useState } from "react";
import type { PendingPermission } from "../store/sessions";
import type { JsonValue } from "../types/acp";
import { respondExt } from "../lib/api";

// Renders grok's `x.ai/ask_user_question` ACP ext_method request — see
// PlanApprovalCard for the same background on why this needs its own card
// instead of the generic PermissionCard. Wire shapes confirmed against
// grok-build's own source (xai-grok-tools/.../ask_user_question/*.rs).
//
// Request: { sessionId, toolCallId, questions: Question[], mode: "default"|"plan" }
// Question: { question, options: [{label, description, preview?}], multiSelect? }
// Response (tagged on "outcome"):
//   Accepted:      { outcome: "accepted", answers: {[question]: string[]}, annotations?: {...} }
//   ChatAboutThis: { outcome: "chat_about_this", partial_answers: {[question]: string} }  (plan mode only)
//   SkipInterview: { outcome: "skip_interview", partial_answers: {[question]: string} }   (plan mode only)
//   Cancelled:     { outcome: "cancelled" }
// `answers`/`partial_answers` are keyed by the question's own text, not an id
// (confirmed from grok-build's own test fixtures) — questions rarely carry an
// explicit `id` in practice (it's model-optional and hidden from the schema).

interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

interface Question {
  question: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

function asRecord(v: JsonValue): Record<string, JsonValue> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JsonValue>) : {};
}

function parseQuestions(raw: JsonValue): Question[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((q) => {
    const rec = asRecord(q);
    const options = Array.isArray(rec.options)
      ? rec.options.map((o) => {
          const orec = asRecord(o);
          return {
            label: typeof orec.label === "string" ? orec.label : "",
            description: typeof orec.description === "string" ? orec.description : "",
            preview: typeof orec.preview === "string" ? orec.preview : undefined,
          };
        })
      : [];
    return {
      question: typeof rec.question === "string" ? rec.question : "",
      options,
      multiSelect: rec.multiSelect === true,
    };
  });
}

interface QuestionState {
  selected: string[];
  freeform: boolean;
  freeformText: string;
}

export function AskUserQuestionCard({ permission, onResolved }: { permission: PendingPermission; onResolved: () => void }) {
  const questions = parseQuestions(permission.params.questions);
  const isPlanMode = permission.params.mode === "plan";
  const [answers, setAnswers] = useState<Record<string, QuestionState>>({});
  const [busy, setBusy] = useState(false);

  function stateFor(q: string): QuestionState {
    return answers[q] ?? { selected: [], freeform: false, freeformText: "" };
  }

  function toggleOption(q: Question, label: string) {
    setAnswers((prev) => {
      const cur = stateFor(q.question);
      const already = cur.selected.includes(label);
      const selected = q.multiSelect
        ? already
          ? cur.selected.filter((l) => l !== label)
          : [...cur.selected, label]
        : already
          ? []
          : [label];
      return { ...prev, [q.question]: { selected, freeform: false, freeformText: cur.freeformText } };
    });
  }

  function toggleFreeform(q: Question) {
    setAnswers((prev) => {
      const cur = stateFor(q.question);
      return { ...prev, [q.question]: { selected: [], freeform: !cur.freeform, freeformText: cur.freeformText } };
    });
  }

  function setFreeformText(q: Question, text: string) {
    setAnswers((prev) => ({ ...prev, [q.question]: { ...stateFor(q.question), freeformText: text } }));
  }

  function buildAnswers(): { answers: Record<string, string[]>; annotations: Record<string, { preview?: string; notes?: string }> } {
    const out: Record<string, string[]> = {};
    const annotations: Record<string, { preview?: string; notes?: string }> = {};
    for (const q of questions) {
      const st = answers[q.question];
      if (!st) continue;
      if (st.freeform && st.freeformText.trim()) {
        out[q.question] = ["Other"];
        annotations[q.question] = { notes: st.freeformText.trim() };
      } else if (st.selected.length > 0) {
        out[q.question] = st.selected;
        if (!q.multiSelect && st.selected.length === 1) {
          const opt = q.options.find((o) => o.label === st.selected[0]);
          if (opt?.preview) annotations[q.question] = { preview: opt.preview };
        }
      }
    }
    return { answers: out, annotations };
  }

  function buildPartialAnswers(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const q of questions) {
      const st = answers[q.question];
      if (!st) continue;
      if (st.freeform && st.freeformText.trim()) out[q.question] = st.freeformText.trim();
      else if (st.selected.length > 0) out[q.question] = st.selected[0];
    }
    return out;
  }

  async function respond(result: JsonValue) {
    setBusy(true);
    try {
      await respondExt(permission.id, result);
      onResolved();
    } finally {
      setBusy(false);
    }
  }

  function accept() {
    const { answers: a, annotations } = buildAnswers();
    respond(
      Object.keys(annotations).length > 0
        ? { outcome: "accepted", answers: a, annotations }
        : { outcome: "accepted", answers: a }
    );
  }

  function cancel() {
    respond({ outcome: "cancelled" });
  }

  function chatAboutThis() {
    respond({ outcome: "chat_about_this", partial_answers: buildPartialAnswers() });
  }

  function skipInterview() {
    respond({ outcome: "skip_interview", partial_answers: buildPartialAnswers() });
  }

  return (
    <div
      className="rounded-[var(--gd-radius-md)] border my-2 max-w-xl overflow-hidden"
      style={{ borderColor: "var(--gd-accent)", background: "var(--gd-surface)" }}
    >
      <div className="px-3.5 py-2.5 border-b" style={{ borderColor: "var(--gd-border)" }}>
        <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: "var(--gd-accent)" }}>
          Grok has a question
        </div>
      </div>

      <div className="px-3.5 py-3 space-y-4 max-h-96 overflow-y-auto">
        {questions.map((q) => {
          const st = stateFor(q.question);
          return (
            <div key={q.question}>
              <div className="text-[13px] font-medium mb-1.5" style={{ color: "var(--gd-text)" }}>
                {q.question}
              </div>
              <div className="space-y-1.5">
                {q.options.map((o) => {
                  const selected = !st.freeform && st.selected.includes(o.label);
                  return (
                    <button
                      key={o.label}
                      onClick={() => toggleOption(q, o.label)}
                      disabled={busy}
                      className="w-full text-left px-2.5 py-1.5 rounded-[var(--gd-radius-sm)] transition"
                      style={{
                        background: selected ? "var(--gd-accent-soft)" : "var(--gd-surface-raised)",
                        border: selected ? "1px solid var(--gd-accent)" : "1px solid var(--gd-border)",
                      }}
                      title={o.preview}
                    >
                      <div className="text-[12.5px] font-medium" style={{ color: "var(--gd-text)" }}>
                        {o.label}
                      </div>
                      {o.description && (
                        <div className="text-[11px] mt-0.5" style={{ color: "var(--gd-text-faint)" }}>
                          {o.description}
                        </div>
                      )}
                    </button>
                  );
                })}
                <button
                  onClick={() => toggleFreeform(q)}
                  disabled={busy}
                  className="text-[11px] font-medium px-2 py-1 rounded-[var(--gd-radius-sm)]"
                  style={{ color: st.freeform ? "var(--gd-accent)" : "var(--gd-text-faint)" }}
                >
                  {st.freeform ? "− Cancel custom answer" : "+ Write my own answer"}
                </button>
                {st.freeform && (
                  <textarea
                    autoFocus
                    value={st.freeformText}
                    onChange={(e) => setFreeformText(q, e.target.value)}
                    disabled={busy}
                    rows={2}
                    className="w-full resize-none rounded-[var(--gd-radius-sm)] px-2.5 py-1.5 text-[12.5px] outline-none"
                    style={{ background: "var(--gd-bg)", color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)" }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 px-3.5 pb-3.5 pt-1">
        <button
          onClick={accept}
          disabled={busy}
          className="gd-billet text-[12px] font-semibold px-3.5 py-1.5 rounded-[var(--gd-radius-sm)] disabled:opacity-50"
        >
          Submit
        </button>
        <button
          onClick={cancel}
          disabled={busy}
          className="text-[12px] font-medium px-3.5 py-1.5 rounded-[var(--gd-radius-sm)]"
          style={{ background: "var(--gd-surface)", color: "var(--gd-danger)", border: "1px solid var(--gd-border)" }}
        >
          Cancel
        </button>
        {isPlanMode && (
          <>
            <button
              onClick={chatAboutThis}
              disabled={busy}
              className="text-[12px] font-medium px-3.5 py-1.5 rounded-[var(--gd-radius-sm)]"
              style={{ background: "var(--gd-surface-raised)", color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)" }}
            >
              Chat about this
            </button>
            <button
              onClick={skipInterview}
              disabled={busy}
              className="text-[12px] font-medium px-3.5 py-1.5 rounded-[var(--gd-radius-sm)]"
              style={{ background: "var(--gd-surface-raised)", color: "var(--gd-text)", border: "1px solid var(--gd-border-strong)" }}
            >
              Skip interview
            </button>
          </>
        )}
      </div>
    </div>
  );
}
