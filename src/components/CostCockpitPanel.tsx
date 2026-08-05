import type { ChatSession } from "../store/sessions";

const USD_TICKS_PER_USD = 1e10;

function formatUsd(ticks: number): string {
  const usd = ticks / USD_TICKS_PER_USD;
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function CostCockpitPanel({ session }: { session?: ChatSession }) {
  if (!session) return <div className="flex-1" />;

  const subagents = session.activityOrder
    .map((id) => session.activity[id])
    .filter((a) => a && a.kind === "subagent" && typeof a.tokensUsed === "number" && a.tokensUsed > 0)
    .sort((a, b) => (b.tokensUsed ?? 0) - (a.tokensUsed ?? 0));

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="p-3 border-b" style={{ borderColor: "var(--gd-border)" }}>
        <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: "var(--gd-text-faint)" }}>
          This session
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[22px] font-semibold" style={{ color: "var(--gd-text)" }}>
            {session.costEstimated && "~"}
            {formatUsd(session.costCumulativeUsdTicks)}
          </span>
          {session.costEstimated && (
            <span className="text-[10px]" style={{ color: "var(--gd-text-faint)" }} title="Some turns reported incomplete or partial usage — the true total may be higher.">
              estimated
            </span>
          )}
        </div>
        <div className="text-[11.5px] mt-0.5" style={{ color: "var(--gd-text-muted)" }}>
          {formatTokens(session.tokensCumulative)} tokens across the session
        </div>
      </div>

      <div className="p-3">
        <div className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: "var(--gd-text-faint)" }}>
          Per subagent
        </div>
        {subagents.length === 0 ? (
          <div className="text-[12px] py-4 text-center" style={{ color: "var(--gd-text-faint)" }}>
            No subagent token usage reported yet.
          </div>
        ) : (
          <div className="space-y-1.5">
            {subagents.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-[12px]">
                <span className="truncate flex-1 mr-2" style={{ color: "var(--gd-text)" }}>
                  {item.title}
                </span>
                <span className="shrink-0 font-medium" style={{ color: "var(--gd-text-muted)" }}>
                  {formatTokens(item.tokensUsed ?? 0)} tok
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="text-[10.5px] mt-3 leading-relaxed" style={{ color: "var(--gd-text-faint)" }}>
          Subagent cost isn't exposed by the protocol, only token counts — the $ total above is session-level only.
        </div>
      </div>
    </div>
  );
}
