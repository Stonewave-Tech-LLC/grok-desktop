// Dream: the third clock (docs/OPERATOR_MEMORY.md) — cross-session densify
// + learn, distinct from compaction (grok, in-session) and flush (grok
// captures, Anvil promotes — v1). grok-build's own `/dream` is TUI-only and
// isn't exposed over ACP (same finding as v1's Capture Now vs `/flush`), so
// this runs as one explicit turn on the current session instead — never
// presented as if it were the native command. Output is parsed defensively:
// a malformed or missing JSON block means no candidate gets written, never
// a crash or garbage in the store.
import type { ChatSession } from "../store/sessions";
import { useSessionStore } from "../store/sessions";
import type { AcpEvent, JsonValue } from "../types/acp";
import { tapAcpEvents } from "./acpTap";
import type { StateCard, DreamStateCardInput, DreamEpisodicInput, DreamPlaybookInput } from "./api";
import {
  listAnvilEntries,
  newSession,
  readAnvilEntry,
  readDreamCandidate,
  readStateCard,
  sendPrompt,
  writeDreamCandidate,
} from "./api";

export const AUTO_DREAM_MIN_EPISODICS = 5;
export const AUTO_DREAM_MIN_MS = 24 * 60 * 60 * 1000;

export function buildDreamPrompt(
  stateCard: StateCard,
  episodics: { slug: string; name: string; body: string }[],
  thoughts?: string,
): string {
  const lines: string[] = [
    "You are an out-of-band operator-memory curator. This is not a user-facing chat.",
    "Do not use tools. Do not search the filesystem. Densify and learn only from the material below.",
    "",
    "CURRENT STATE CARD:",
    `Focus: ${stateCard.focus || "—"}`,
    `Last decided: ${stateCard.lastDecided || "—"}`,
    `Open/Blockers: ${stateCard.openBlockers || "—"}`,
    "",
    'EPISODIC ENTRIES (most recent first, "[slug]" is the id to reference in "supersedes"):',
    ...(episodics.length ? episodics.map((e) => `- [${e.slug}] ${e.name}\n  ${e.body.replace(/\n/g, "\n  ")}`) : ["(none yet)"]),
  ];
  if (thoughts && thoughts.trim()) {
    lines.push(
      "",
      "THOUGHT TRACES from the live session (reasoning, NOT facts). Use only as evidence of recurring mistakes, converged workflows, or stated preferences. Never save a thought as an episodic or playbook on its own.",
      thoughts.trim(),
    );
  }
  lines.push(
    "",
    "Do this:",
    '1. Densify: merge duplicate or overlapping episodic entries into fewer, clearer ones. Convert relative dates ("yesterday", "this morning") to absolute ones using today\'s real date. Drop one-off trivia (e.g. "opened Settings").',
    "2. If something in the episodics is really a standing project fact now, propose it as a state-card update instead of keeping it as an episodic.",
    "3. Learn: only if you see a REAL recurring pattern across multiple episodics (or a pattern the thought traces corroborate) — a mistake that repeated, a workflow that converged, an operator preference stated more than once — propose a playbook. Never invent one from a single occurrence.",
    "4. Never fabricate. If nothing meaningfully changed, say so and propose nothing.",
    "",
    "Reply with a short rationale first, then EXACTLY one fenced JSON block:",
    "```json",
    '{"stateCard": {"focus": "...", "lastDecided": "...", "openBlockers": "..."}, "episodics": [{"name": "...", "description": "...", "body": "...", "supersedes": ["<old-slug>"]}], "playbooks": [{"name": "...", "description": "...", "body": "..."}], "summary": "one line describing what this dream did"}',
    "```",
  );
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

export function extractDreamReplyText(session: ChatSession): string | undefined {
  for (let i = session.timeline.length - 1; i >= 0; i--) {
    const item = session.timeline[i];
    if (item.sessionUpdate !== "agent_message_final") continue;
    const text = typeof item.raw.text === "string" ? item.raw.text : "";
    if (/```json/i.test(text)) return text;
  }
  for (let i = session.timeline.length - 1; i >= 0; i--) {
    const item = session.timeline[i];
    if (item.sessionUpdate === "agent_message_final" && typeof item.raw.text === "string") {
      return item.raw.text;
    }
  }
  return undefined;
}

function uniqueEpisodics<T extends { path: string; type: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of list) {
    if (e.type !== "episodic") continue;
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    out.push(e);
  }
  return out;
}

function asRecord(v: JsonValue): Record<string, JsonValue> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JsonValue>) : {};
}

function collectRecentThoughts(session: ChatSession | undefined, maxChars = 3500): string | undefined {
  if (!session) return undefined;
  const parts: string[] = [];
  let used = 0;
  for (let i = session.timeline.length - 1; i >= 0 && used < maxChars; i--) {
    const item = session.timeline[i];
    if (item.sessionUpdate !== "agent_thought_chunk") continue;
    const content = asRecord(item.raw.content);
    const text = typeof content.text === "string" ? content.text.trim() : "";
    if (!text) continue;
    const slice = text.length > 800 ? `${text.slice(0, 800)}…` : text;
    parts.push(slice);
    used += slice.length;
  }
  if (!parts.length) return undefined;
  return parts.reverse().join("\n---\n");
}

/// Shared by the cockpit button and the idle auto-trigger. Spawns a *throwaway*
/// yolo ACP session so the live chat never sees the curator turn (Anthropic
/// dreams are out-of-band; dumping this into the transcript was the bug).
/// Writes a candidate only — never attaches. `parentSessionId` is only used
/// to harvest thought traces as evidence, not as the prompt target.
export async function runOperatorDream(parentSessionId: string, cwd: string): Promise<boolean> {
  const list = uniqueEpisodics(await listAnvilEntries(cwd).catch(() => []));
  const stateCard = await readStateCard(cwd);
  const episodicFull = await Promise.all(list.map((e) => readAnvilEntry(e.path)));
  const parent = useSessionStore.getState().sessions[parentSessionId];
  const prompt = buildDreamPrompt(
    stateCard,
    episodicFull.map((e) => ({ slug: e.slug, name: e.name, body: e.body })),
    collectRecentThoughts(parent),
  );

  const { sessionId } = await newSession(cwd, true);
  let reply = "";
  const stopTap = tapAcpEvents((event: AcpEvent) => {
    if (event.kind !== "notification" || event.method !== "session/update") return;
    const params = asRecord(event.params);
    if (params.sessionId !== sessionId) return;
    const update = asRecord(params.update);
    const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
    if (kind !== "agent_message_chunk" && kind !== "agent_message_final") return;
    const content = asRecord(update.content);
    if (typeof content.text === "string") reply += content.text;
    else if (typeof update.text === "string") reply += update.text;
  });

  try {
    await sendPrompt(sessionId, prompt);
  } finally {
    stopTap();
  }

  const parsed = reply ? parseDreamReply(reply) : undefined;
  if (!parsed) return false;
  await saveDreamCandidate(cwd, parsed);
  return true;
}

export async function uniqueEpisodicCount(cwd: string): Promise<number> {
  const list = await listAnvilEntries(cwd).catch(() => []);
  return uniqueEpisodics(list).length;
}

export async function hasPendingDream(cwd: string): Promise<boolean> {
  const c = await readDreamCandidate(cwd).catch(() => undefined);
  return c?.status === "pending";
}
