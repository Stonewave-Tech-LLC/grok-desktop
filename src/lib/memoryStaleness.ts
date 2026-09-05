// Staleness is signal, not silence (docs/OPERATOR_MEMORY.md, diamond 7).
// Half-life per type, adapted from Claude's own memory-reflect.py model
// (project 45d, reference 90d, decision/preference 180d, person 365d) —
// Anvil's type taxonomy differs slightly so the mapping isn't 1:1: episodic
// and issue decay fastest since they're meant to be perishable/resolved,
// not durable. Flag only, never auto-delete — an unflagged stale memory is
// worse than none, a silently deleted one is just gone.
const HALF_LIFE_DAYS: Record<string, number> = {
  episodic: 14,
  issue: 30,
  project: 45,
  reference: 90,
  decision: 180,
  preference: 180,
  person: 365,
};
const DEFAULT_HALF_LIFE_DAYS = 90;

export function halfLifeDays(type: string): number {
  return HALF_LIFE_DAYS[type] ?? DEFAULT_HALF_LIFE_DAYS;
}

export function isStale(entry: { type: string; modifiedAtMs: number }): boolean {
  const ageDays = (Date.now() - entry.modifiedAtMs) / 86_400_000;
  return ageDays > halfLifeDays(entry.type);
}
