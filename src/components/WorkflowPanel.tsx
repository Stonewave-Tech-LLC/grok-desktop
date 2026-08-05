import type { ChatSession, WorkflowRun } from "../store/sessions";

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function statusColor(status: string): string {
  if (status === "complete") return "var(--gd-success)";
  if (status === "failed" || status === "cancelled") return "var(--gd-danger)";
  if (status === "active") return "var(--gd-warning)";
  return "var(--gd-text-faint)";
}

function agentStateColor(state: string): string {
  if (state === "running") return "var(--gd-warning)";
  if (state === "done" || state === "completed") return "var(--gd-success)";
  if (state === "failed") return "var(--gd-danger)";
  return "var(--gd-text-faint)";
}

function PhaseTimeline({ phases, currentPhase }: { phases: WorkflowRun["phases"]; currentPhase?: string }) {
  if (phases.length === 0) return null;
  return (
    <div className="flex items-center gap-1 mt-2">
      {phases.map((p, idx) => (
        <div key={`${p.title}-${idx}`} className="flex items-center gap-1 flex-1 min-w-0">
          <div
            title={p.title}
            className="h-1.5 flex-1 rounded-full min-w-[8px]"
            style={{
              background:
                p.state === "done"
                  ? "var(--gd-success)"
                  : p.state === "active"
                    ? "var(--gd-warning)"
                    : "var(--gd-metal-2)",
            }}
          />
        </div>
      ))}
      <span className="text-[10px] ml-1 shrink-0" style={{ color: "var(--gd-text-faint)" }}>
        {currentPhase ?? ""}
      </span>
    </div>
  );
}

function WorkflowCard({ run }: { run: WorkflowRun }) {
  return (
    <div className="rounded-[var(--gd-radius-md)] border p-2.5" style={{ borderColor: "var(--gd-border)", background: "var(--gd-metal-1)" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium truncate" style={{ color: "var(--gd-text)" }}>
          {run.name}
        </span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
          style={{ color: statusColor(run.status), background: "var(--gd-bg)" }}
        >
          {run.status.replace(/_/g, " ")}
        </span>
      </div>
      {run.objective && (
        <div className="text-[11px] mt-1 line-clamp-2" style={{ color: "var(--gd-text-muted)" }}>
          {run.objective}
        </div>
      )}

      <PhaseTimeline phases={run.phases} currentPhase={run.currentPhase} />

      <div className="text-[10.5px] mt-1.5 flex items-center gap-2" style={{ color: "var(--gd-text-faint)" }}>
        <span>{formatDuration(run.elapsedMs)}</span>
        {typeof run.agentBudget === "number" && (
          <span>
            {run.agentsUsed}/{run.agentBudget} agents
          </span>
        )}
      </div>

      {run.agents.length > 0 && (
        <div className="mt-2 space-y-1">
          {run.agents.map((agent) => (
            <div key={agent.agentId} className="flex items-center gap-1.5 text-[11px]">
              <span
                className={agent.state === "running" ? "h-1.5 w-1.5 rounded-full shrink-0 animate-pulse" : "h-1.5 w-1.5 rounded-full shrink-0"}
                style={{ background: agentStateColor(agent.state) }}
              />
              <span className="truncate flex-1" style={{ color: "var(--gd-text)" }}>
                {agent.label}
              </span>
              {agent.tokensUsed > 0 && (
                <span className="shrink-0" style={{ color: "var(--gd-text-faint)" }}>
                  {(agent.tokensUsed / 1000).toFixed(1)}k tok
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {run.pauseMessage && (
        <div className="text-[10.5px] mt-2 italic" style={{ color: "var(--gd-warning)" }}>
          {run.pauseMessage}
        </div>
      )}
      {run.resultSummary && (
        <div className="text-[10.5px] mt-2" style={{ color: "var(--gd-text-muted)" }}>
          {run.resultSummary}
        </div>
      )}
      {!run.resultSummary && run.lastEvent && (
        <div className="text-[10.5px] mt-2" style={{ color: "var(--gd-text-faint)" }}>
          {run.lastEvent}
          {run.lastEventDetail ? ` — ${run.lastEventDetail}` : ""}
        </div>
      )}
    </div>
  );
}

export function WorkflowPanel({ session }: { session?: ChatSession }) {
  if (!session) return <div className="flex-1" />;
  const runs = session.workflowOrder.map((id) => session.workflows[id]).filter(Boolean);

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-2">
      {runs.length === 0 ? (
        <div className="px-2 py-6 text-center text-[12px]" style={{ color: "var(--gd-text-faint)" }}>
          No `/workflow` or `/goal` runs yet. Multi-agent runs (phases, per-agent status/tokens, budget) show up here live.
        </div>
      ) : (
        runs.map((run) => <WorkflowCard key={run.runId} run={run} />)
      )}
    </div>
  );
}
