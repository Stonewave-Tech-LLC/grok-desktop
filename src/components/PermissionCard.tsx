import type { PendingPermission } from "../store/sessions";
import type { JsonValue } from "../types/acp";
import { respondPermission, denyPermission } from "../lib/api";
import { extractDescription, extractCommand } from "../lib/toolCallDisplay";

interface PermissionOption {
  optionId: string;
  name?: string;
  kind?: string;
}

function extractOptions(params: Record<string, JsonValue>): PermissionOption[] {
  const direct = params.options;
  const toolCall = params.toolCall as Record<string, JsonValue> | undefined;
  const nested = toolCall && typeof toolCall === "object" ? toolCall.options : undefined;
  const raw = (Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : []) as JsonValue[];
  return raw
    .filter((o): o is Record<string, JsonValue> => typeof o === "object" && o !== null)
    .map((o) => ({
      optionId: typeof o.optionId === "string" ? o.optionId : "",
      name: typeof o.name === "string" ? o.name : undefined,
      kind: typeof o.kind === "string" ? o.kind : undefined,
    }))
    .filter((o) => o.optionId);
}

export function PermissionCard({ permission, onResolved }: { permission: PendingPermission; onResolved: () => void }) {
  const options = extractOptions(permission.params);
  const toolCall = permission.params.toolCall as Record<string, JsonValue> | undefined;
  const rawTitle =
    (toolCall && typeof toolCall.title === "string" && toolCall.title) ||
    (typeof permission.params.title === "string" && permission.params.title) ||
    "Permission requested";
  // Same fix as ToolCallCard: prefer grok's own plain-language explanation
  // over the raw, often-truncated tool title — this is a *decision* the user
  // has to make before anything runs, so illegible titles are worse here
  // than in the historical tool-call log.
  const description = toolCall ? extractDescription(toolCall) : undefined;
  const command = toolCall ? extractCommand(toolCall) : undefined;
  const title = description || rawTitle;

  async function choose(optionId: string) {
    await respondPermission(permission.id, optionId);
    onResolved();
  }

  async function deny() {
    await denyPermission(permission.id);
    onResolved();
  }

  return (
    // Slice 3: this used to be a yellow-bordered web-alert box — same
    // decision, different clothes now. A metal panel (same depth token the
    // dialogs already use) instead of a warning color reads as "the app's
    // own chrome asking a question", not a browser permission popup.
    <div
      className="rounded-[var(--gd-radius-md)] border my-2 max-w-xl p-3"
      style={{ borderColor: "var(--gd-border)", background: "var(--gd-surface)", boxShadow: "var(--gd-panel-shadow)" }}
    >
      <div className="text-[13px] font-medium mb-2" style={{ color: "var(--gd-text)" }}>
        {title}
      </div>
      {command && (
        <div className="mb-2.5">
          <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--gd-text-faint)" }}>
            Command
          </div>
          <pre
            className="whitespace-pre-wrap break-words font-mono text-[11.5px] p-2 rounded-[var(--gd-radius-sm)] max-h-40 overflow-y-auto"
            style={{ background: "var(--gd-bg)", color: "var(--gd-text)" }}
          >
            {command}
          </pre>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {options.length > 0 ? (
          options.map((o) => {
            const isAllow = /allow/i.test(o.optionId + (o.kind ?? ""));
            return (
              <button
                key={o.optionId}
                onClick={() => choose(o.optionId)}
                className={
                  isAllow
                    ? "gd-billet text-[12px] font-semibold px-3 py-1.5 rounded-[var(--gd-radius-sm)]"
                    : "gd-ghost text-[12px] font-medium px-3 py-1.5 rounded-[var(--gd-radius-sm)]"
                }
              >
                {o.name ?? o.optionId}
              </button>
            );
          })
        ) : (
          <>
            <button
              onClick={() => choose("allow_once")}
              className="gd-billet text-[12px] font-semibold px-3 py-1.5 rounded-[var(--gd-radius-sm)]"
            >
              Allow once
            </button>
            <button onClick={deny} className="gd-ghost text-[12px] font-medium px-3 py-1.5 rounded-[var(--gd-radius-sm)]">
              Deny
            </button>
          </>
        )}
      </div>
    </div>
  );
}
