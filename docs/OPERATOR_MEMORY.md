# Operator Memory — architecture

Status: v1 shipped (this doc), builds on the existing `.anvil/memory/` CRUD +
`<!-- anvil:memory:begin -->` bridge (`memory.rs`). Not a replacement for
grok's native memory (`~/.grok/memory/**`, FTS5+vec0, `/flush`, `/dream`,
`memory_search`/`memory_get`) — that stays the recall substrate grok itself
searches. This is the curated layer on top, for the human running the forge
(Anvil + Forge Grok on the same Mac), because the native layer alone forgets
the things that actually matter: on the day this was written, this Mac's
workspace `MEMORY.md` was a 3-line dream-consolidation stub after days of
real Anvil work.

## What already existed (don't refork this)

- Typed Markdown CRUD under `.anvil/memory/` (project, git-trackable) and
  `~/.anvil/memory/` (global) — 6 types (project/decision/issue/person/
  preference/reference), frontmatter + body, `list/read/write/delete`
  commands in `memory.rs`, a `MemoryPanel.tsx` list+detail UI.
- A generated bridge block (`<!-- anvil:memory:begin -->` … `:end`) upserted
  into grok's own `~/.grok/memory/{workspace}/MEMORY.md` (project) and
  `~/.grok/memory/MEMORY.md` (global) — this is *the* writer-to-recall path.
  It's regenerated wholesale on every write, never patched by hand.
- `compute_workspace_dir()` reproduces grok-build's own hash scheme
  (blake3, slug+hash8) so the bridge lands in the exact directory grok reads.
- A rules file (`~/.grok/rules/00-anvil-memory-usage.md`) telling grok to
  search proactively and not trust an empty `memory_search` — written
  whenever memory is enabled.
- `_x.ai/session_notification` kinds `memory_flush_started|completed`,
  `memory_dream_completed`, `memory_session_saved` already flow through
  `handleXaiNotification` in `store/sessions.ts` — today purely as a toast
  (`memoryStatusMessage`), the text is read once and discarded.

None of this needed to be replaced. The gap wasn't storage or the bridge —
it was *what* gets written, *when*, and *how it's surfaced*.

## The diamonds

1. **Two layers, one writer-to-recall path.** Grok memory is the search
   index / injection surface. Operator memory is the curated layer. The
   curator writes the curated layer and *bridges* a compact form into grok's
   own MEMORY.md through the hatch that already exists. Never fork a second
   store grok never reads; never make the UI a source of truth the agent
   ignores.

2. **Single writer, sleep-time curation.** The live coding session must
   never be asked to `/remember` trivia mid-turn — that's exactly the
   failure mode this is designed to avoid. Grok's own `/flush` (a genuine
   *rich session summary*, not a raw dump — confirmed against x.ai's own
   docs) and `/dream` (consolidation) are the capture engines, and they
   already emit `memory_flush_completed`/`memory_dream_completed`/
   `memory_session_saved` with a `result` string on flush. Those events are
   the entire curation trigger. Promoting grok's *own already-graded* output
   into the durable, typed, bridged layer is not the same failure mode as
   asking the model to save something mid-conversation — the grading already
   happened, by the model that had full context, at a boundary grok itself
   chose. Also a deliberate no-op: **grok's own `/flush` and `/dream` are
   TUI-only and are not exposed to the app over ACP** (confirmed — they run
   automatically on session end / before compaction / on dream gates, but
   can't be *triggered* remotely). "Flush this session" in the cockpit is
   therefore **not** a remote `/flush` — it's Anvil's own capture action
   (see below), explicitly not pretending to be the native one.

3. **Elara lesson.** Durable facts — identity, standing decisions, ongoing
   focus, how the operator wants to work — survive. One-off actions,
   transient bugs, verbatim brainstorm dumps don't. If this system ever
   starts saving "the user opened Settings," it has failed. This is why
   captured content always comes from something already graded (grok's own
   flush/dream text, or a deliberate "summarize this session" turn a human
   explicitly asked for) — never a mechanical dump of raw chat turns.

4. **The project layer is a state card, not a file browser.** The
   `## Aktueller Zustand` pattern (Focus / Last decided / Open-Blockers,
   auto last-commit) is the operator-grade project memory. Anvil now has one
   per workspace (`.anvil/memory/STATE.md`), git-trackable, rendered at the
   *top* of the project bridge block — it's the first thing grok reads, not
   one entry among many.

5. **Empty search ≠ empty memory; MEMORY.md is an index, depth lives in
   topic files.** Already covered by the existing rules file and
   `regenerate_index`. Extended, not re-litigated: the state card and
   episodic entries follow the same index-then-depth shape.

6. **Cockpit, not library.** The Memory dock now leads with: the state card,
   recent episodic captures, and stale flags — a "what's known about this
   workspace" view. The 6-type CRUD list still exists (nothing was thrown
   away) but is now the *body*, visually secondary, not the product.

7. **Staleness is signal, not silence.** Half-life per type (adapted from
   Claude's own `memory-reflect.py` model — project 45d, reference 90d,
   decision/preference 180d, person 365d; episodic and issue decay faster,
   14d/30d, since they're meant to be perishable or resolved). Flagged in
   the cockpit, never auto-deleted — an unflagged stale memory is worse than
   none, a deleted one is just gone.

8. **Causal, not a graph database.** No new causality machinery in v1 — the
   existing typed-entry shape already supports free-text cross-references
   (`caused_by`-style prose in a body is enough at this scale). Graphify is
   the semantic layer *over code*, not a blocker for this at all — this
   never touches or waits on a knowledge graph.

## What this is not (no-gos)

- Not a MemoryPanel restyle. Not a second notes app. Not a replacement for
  grok's native memory or its search tools.
- No live mid-turn "save to memory" tool exposed to the coding session —
  the only write paths are (a) promotion of grok's own flush/dream output,
  triggered by the notification events grok already sends, and (b) a
  human-initiated "Capture now," which asks the *current session* (which
  already has full context) to produce a graded summary in one explicit
  turn, then promotes that response — never a mechanical transcript dump.
- No new LLM API key / external curator service. The curator model *is*
  grok-build, reached through the same ACP connection Anvil already holds —
  there is no separate summarization pipeline to keep alive or pay for.
- No parallel project-status file. The state card *is* the CLAUDE.md
  `## Aktueller Zustand` pattern, brought natively into Anvil — not a
  competing format.
- No graph database, no vector store of its own. Grok's own FTS5+vec0 stays
  the retrieval engine; the bridge is still the only channel into it.

## Cross-host sharing (Anvil + Forge Grok, same Mac)

The store is plain files under `.anvil/memory/` (project) and
`~/.anvil/memory/` (global) — not a database Anvil owns exclusively. Any
process on the same Mac with filesystem access, including Forge Grok, can
read the same state card and typed entries directly, or via the same bridge
files grok-build already reads. That's *why* files-on-disk was kept as the
format instead of e.g. sqlite: zero new sync mechanism needed. Wiring
Forge's own rules/prompt to actually look at these paths is Forge-side work
(Swift, not this repo) — out of scope for this push, but the contract is:
`.anvil/memory/STATE.md` and `.anvil/memory/<type>/*.md` are the shared
surface, same shape Anvil itself reads and writes.

## v1 scope (what shipped)

- `memory.rs`: `StateCard` (focus/last-decided/open-blockers, `.anvil/memory/
  STATE.md`, last-commit computed live via `git log`, never stored),
  `read_state_card`/`write_state_card` commands. Project bridge rendering
  now composes the state card *and* typed entries in one block instead of
  just entries.
- Episodic entries reuse the *existing* `write_anvil_entry` command
  unmodified (`type: "episodic"` was never restricted in Rust — only the
  frontend's manual-entry form limited the type picker to the original 6).
  Frontend `captureEpisodic()` builds the slug/name/description and calls
  it — no new Rust write path for this at all.
- `store/sessions.ts`: `memory_flush_completed`/`memory_dream_completed`/
  `memory_session_saved` now promote their `result`/`summary` text (when
  present and substantial) into an episodic entry via `captureEpisodic`, in
  *addition* to the existing toast — nothing about the toast path changed.
- `MemoryPanel.tsx`: rebuilt as a cockpit — state card (editable) up top
  with a "Capture now" action (sends one explicit summarization turn to the
  *current* session, then promotes the reply), recent episodic captures,
  stale flags, and the original typed-entry list demoted to a "Body"
  section below. Metal/white-glow throughout, no warning-yellow.
- `src/lib/memoryStaleness.ts`: the half-life table + `isStale()`, pure
  frontend, no Rust involved.

## Deliberately deferred (not this slice)

- Semantic search of the curated layer itself (grok's own hybrid search
  already covers recall once bridged — a second index would be the "fork a
  store grok never reads" mistake).
- Any Forge-side (Swift) change to make Forge Grok actually consult these
  files — contract is documented above, implementation is Neo's call on
  the Mac.
- Causal graph UI (`caused_by`/`supersedes` as structured fields rather
  than prose) — add if/when it's actually load-bearing, not speculatively.
