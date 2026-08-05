import type { PendingPermission } from "../store/sessions";
import type { JsonValue } from "../types/acp";
import { respondPermission, denyPermission } from "../lib/api";

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
  const title =
    (toolCall && typeof toolCall.title === "string" && toolCall.title) ||
    (typeof permission.params.title === "string" && permission.params.title) ||
    "Permission requested";

  async function choose(optionId: string) {
    await respondPermission(permission.id, optionId);
    onResolved();
  }

  async function deny() {
    await denyPermission(permission.id);
    onResolved();
  }

  return (
    <div
      className="rounded-[var(--gd-radius-md)] border my-2 max-w-xl p-3"
      style={{ borderColor: "var(--gd-warning)", background: "var(--gd-warning-soft)" }}
    >
      <div className="text-[13px] font-medium mb-2" style={{ color: "var(--gd-text)" }}>
        {title}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.length > 0 ? (
          options.map((o) => {
            const isReject = /reject|deny/i.test(o.optionId + (o.kind ?? ""));
            const isAllow = /allow/i.test(o.optionId + (o.kind ?? ""));
            return (
              <button
                key={o.optionId}
                onClick={() => choose(o.optionId)}
                className={
                  isAllow
                    ? "gd-billet text-[12px] font-semibold px-3 py-1.5 rounded-[var(--gd-radius-sm)]"
                    : "text-[12px] font-medium px-3 py-1.5 rounded-[var(--gd-radius-sm)] transition"
                }
                style={
                  isAllow
                    ? undefined
                    : {
                        background: "var(--gd-surface)",
                        color: isReject ? "var(--gd-danger)" : "var(--gd-text)",
                        border: "1px solid var(--gd-border-strong)",
                      }
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
            <button
              onClick={deny}
              className="text-[12px] font-medium px-3 py-1.5 rounded-[var(--gd-radius-sm)]"
              style={{ background: "var(--gd-surface)", color: "var(--gd-danger)", border: "1px solid var(--gd-border-strong)" }}
            >
              Deny
            </button>
          </>
        )}
      </div>
    </div>
  );
}
