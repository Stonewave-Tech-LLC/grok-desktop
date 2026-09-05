// Dream: the third clock (docs/OPERATOR_MEMORY.md) — cross-session densify
// + learn, distinct from compaction (grok, in-session) and flush (grok
// captures, Anvil promotes — v1). grok-build's own `/dream` is TUI-only and
// isn't exposed over ACP (same finding as v1's Capture Now vs `/flush`), so
// this runs as one explicit turn on the current session instead — never
// presented as if it were the native command. Output is parsed defensively:
// a malformed or missing JSON block means no candidate gets written, never
// a crash or garbage in the store.
import type { StateCard, DreamStateCardInput, DreamEpisodicInput, DreamPlaybookInput } from "./api";
import { writeDreamCandidate } from "./api";

export function buildDreamPrompt(stateCard: StateCard, episodics: { slug: string; name: string; body: string }[]): string {
  const lines: string[] = [
    "Run an operator-memory dream for this workspace: densify and learn from the curated memory below.",
    "You may also look at recent session transcripts on disk if it helps confirm a real recurring pattern — never invent one from a single occurrence.",
    "",
    "CURRENT STATE CARD:",
    `Focus: ${stateCard.focus || "—"}`,
    `Last decided: ${stateCard.lastDecided || "—"}`,
    `Open/Blockers: ${stateCard.openBlockers || "—"}`,
    "",
    'EPISODIC ENTRIES (most recent first, "[slug]" is the id to reference in "supersedes"):',
    ...(episodics.length ? episodics.map((e) => `- [${e.slug}] ${e.name}\n  ${e.body.replace(/\n/g, "\n  ")}`) : ["(none yet)"]),
    "",
    "Do this:",
    '1. Densify: merge duplicate or overlapping episodic entries into fewer, clearer ones. Convert relative dates ("yesterday", "this morning") to absolute ones using today\'s real date. Drop anything that\'s genuinely one-off trivia not worth keeping (e.g. "opened Settings").',
    "2. If something in the episodics is really a standing project fact now, not a point-in-time event, propose it as a state-card update instead of keeping it as an episodic.",
    "3. Learn: only if you see a REAL recurring pattern across multiple episodics — a mistake that repeated, a workflow that converged, an operator preference stated more than once — propose a playbook entry. Never invent one from a single occurrence.",
    "4. Never fabricate. If nothing meaningfully changed, say so and propose nothing.",
    "",
    "Reply with a short human-readable rationale first, then end your reply with EXACTLY one fenced JSON block, valid JSON, matching this shape (omit fields you have nothing for using null or an empty array, but the block itself must always be present and parseable):",
    "```json",
    '{"stateCard": {"focus": "...", "lastDecided": "...", "openBlockers": "..."}, "episodics": [{"name": "...", "description": "...", "body": "...", "supersedes": ["<old-slug>"]}], "playbooks": [{"name": "...", "description": "...", "body": "..."}], "summary": "one line describing what this dream did"}',
    "```",
  ];
  return lines.join("\n");
}

export interface ParsedDream {
  stateCard?: DreamStateCardInput;
  episodics: DreamEpisodicInput[];
  playbooks: DreamPlaybookInput[];
  summary: string;
}

function extractJsonBlock(text: string): Record<string, unknown> | undefined {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (matches.length === 0) return undefined;
  const raw = matches[matches.length - 1][1];
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function parseDreamReply(replyText: string): ParsedDream | undefined {
  const json = extractJsonBlock(replyText);
  if (!json) return undefined;

  let stateCard: DreamStateCardInput | undefined;
  const stateCardRaw = json.stateCard;
  if (stateCardRaw && typeof stateCardRaw === "object" && !Array.isArray(stateCardRaw)) {
    const rec = stateCardRaw as Record<string, unknown>;
    const candidate: DreamStateCardInput = {
      focus: typeof rec.focus === "string" && rec.focus.trim() ? rec.focus.trim() : undefined,
      lastDecided: typeof rec.lastDecided === "string" && rec.lastDecided.trim() ? rec.lastDecided.trim() : undefined,
      openBlockers: typeof rec.openBlockers === "string" && rec.openBlockers.trim() ? rec.openBlockers.trim() : undefined,
    };
    if (candidate.focus || candidate.lastDecided || candidate.openBlockers) stateCard = candidate;
  }

  const episodicsRaw = Array.isArray(json.episodics) ? json.episodics : [];
  const episodics: DreamEpisodicInput[] = episodicsRaw
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object" && !Array.isArray(e))
    .map((e) => ({
      name: typeof e.name === "string" ? e.name : "",
      description: typeof e.description === "string" ? e.description : "",
      body: typeof e.body === "string" ? e.body : "",
      supersedes: asStringArray(e.supersedes),
    }))
    .filter((e) => e.name.trim() && e.body.trim());

  const playbooksRaw = Array.isArray(json.playbooks) ? json.playbooks : [];
  const playbooks: DreamPlaybookInput[] = playbooksRaw
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object" && !Array.isArray(p))
    .map((p) => ({
      name: typeof p.name === "string" ? p.name : "",
      description: typeof p.description === "string" ? p.description : "",
      body: typeof p.body === "string" ? p.body : "",
    }))
    .filter((p) => p.name.trim() && p.body.trim());

  const summary = typeof json.summary === "string" ? json.summary : "";

  return { stateCard, episodics, playbooks, summary };
}

export async function saveDreamCandidate(cwd: string, dream: ParsedDream): Promise<void> {
  await writeDreamCandidate(cwd, dream.stateCard, dream.episodics, dream.playbooks, dream.summary || "Dream synthesis");
}
