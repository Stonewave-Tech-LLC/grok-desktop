# Operator Memory — architecture

Status: v1 (state card + episodic capture + cockpit) and v2 (dream —
densify + learn) both shipped. Builds on the existing `.anvil/memory/` CRUD
+ `<!-- anvil:memory:begin -->` bridge (`memory.rs`). Not a replacement for
grok's native memory (`~/.grok/memory/**`, FTS5+vec0, `/flush`, `/dream`,
`memory_search`/`memory_get`) — that stays the recall substrate grok itself
searches. This is the curated layer on top, for the human running the forge
(Anvil + Forge Grok on the same Mac), because the native layer alone forgets
the things that actually matter: on the day this was written, this Mac's
workspace `MEMORY.md` was a 3-line dream-consolidation stub after days of
real Anvil work.

## Three clocks — keep them named, don't conflate them

1. **Compaction** — in-session context hygiene. Grok's own, entirely
   internal, not this system's concern at all.
2. **Flush** — session capture. Grok's `/flush` produces a genuine rich
   session summary (confirmed against x.ai's own docs, not a raw dump) at
   session boundaries. v1: Anvil promotes that already-graded text into a
   durable episodic entry instead of letting it evaporate into a toast.
3. **Dream** — cross-session densification + learning. What a *single*
   session can't see: recurring mistakes, workflows that converge across
   many sessions, operator preferences restated more than once. Modeled on
   Anthropic's managed-dreams shape (research preview,
   `platform.claude.com/docs/en/managed-agents/dreams`): input is the
   existing memory store plus session transcripts, output is a **new**
   memory store, reviewed before use — copy-on-write, because a dream can
   make memory *worse*, and rollback (not prevention) is the actual safety
   mechanism. Not a weight update; it writes playbooks/notes future sessions
   read, same as Letta's sleep-time-compute family. v2: Anvil's own version
   of this, over the curated layer, human-reviewed before anything attaches.

Compaction ≠ dream. v1 only ever built flush-promotion (capture). Treating
that as "the learning loop" was the actual gap — v2 fills it.

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
   failure mode this is designed to avoid. Grok's own `/flush` and `/dream`
   are the capture/consolidation engines, and they already emit
   `memory_flush_completed`/`memory_dream_completed`/`memory_session_saved`
   with a `result` string on flush. Promoting grok's *own already-graded*
   output into the durable, typed, bridged layer is not the same failure
   mode as asking the model to save something mid-conversation — the
   grading already happened, by the model that had full context, at a
   boundary grok itself chose. Also a deliberate no-op, confirmed twice now
   (v1 for `/flush`, v2 for `/dream`): **grok's own `/flush` and `/dream`
   are TUI-only and are not exposed to the app over ACP at all** — they run
   automatically on session end / before compaction / on dream gates, but
   can't be *triggered* remotely, and `/dream` operates on grok's own
   `~/.grok/memory/` store, not this curated layer, even if it could be.
   "Capture now" and "Dream" in the cockpit are therefore Anvil's own
   actions — never presented as if they were the native commands.

   **Copy-on-write is what makes Dream safe to ship at all.** Anthropic
   built it because they *expect* dreams to sometimes make memory worse —
   poisoned memory is an incident, and rollback is the product, not
   prevention. Anvil's dream never touches `.anvil/memory/` directly: it
   writes a candidate under the sibling `.anvil/dream/`, the cockpit shows
   what changed, a human explicitly Attaches or Discards. Auto-attach is
   future work, gated on having actually seen a dream that didn't poison —
   not a v2 decision to make speculatively.

   **Learning, not more fact cards.** Dream's `instructions`-equivalent
   here is the prompt itself: densify (merge duplicate episodics, convert
   relative dates to absolute, drop one-off trivia, promote standing facts
   into the state card) *and* learn (playbooks — recurring mistakes,
   converged workflows, operator preferences — only from a real pattern
   across multiple episodics, never invented from one occurrence). Playbook
   is a new type precisely so "learned" content stays visually and
   semantically distinct from "someone typed a fact card" in the cockpit.

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

6. **Cockpit, not library.** The Memory dock leads with: a pending dream
   review (when one exists — highest priority, it's a decision waiting),
   the state card, recent episodic captures, learned playbooks, and stale
   flags — a "what's known about this workspace, and what changed" view.
   The 6-type CRUD list still exists (nothing was thrown away) but is now
   the *body*, visually secondary, not the product.

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
  triggered by the notification events grok already sends, (b) a
  human-initiated "Capture now" (one explicit summarization turn, then
  promote the reply), and (c) a human-initiated "Dream" (one explicit
  synthesis turn, writes a reviewed candidate) — never a mechanical
  transcript dump, never an automatic mid-conversation save.
- No new LLM API key / external curator service. The curator model *is*
  grok-build, reached through the same ACP connection Anvil already holds —
  there is no separate summarization pipeline to keep alive or pay for.
  This holds for Dream too: no new inference path, same session/prompt call
  Capture Now already uses.
- No parallel project-status file. The state card *is* the CLAUDE.md
  `## Aktueller Zustand` pattern, brought natively into Anvil — not a
  competing format.
- No graph database, no vector store of its own. Grok's own FTS5+vec0 stays
  the retrieval engine; the bridge is still the only channel into it.
- No in-place memory mutation from a dream, ever. Write candidate → review
  → explicit Attach or Discard. No auto-attach in v2.

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
  with a "Capture now" action, recent episodic captures, stale flags, and
  the original typed-entry list demoted to a "Body" section below.
- `src/lib/memoryStaleness.ts`: the half-life table + `isStale()`, pure
  frontend, no Rust involved.

## v2 scope (what shipped — dream)

- `memory.rs`: new `DreamStateCard`/`DreamEpisodic`/`DreamPlaybook` input
  types, `DreamMetaFile` (on-disk, `status: pending|attached|discarded` +
  which old episodic slugs a dream supersedes), `DreamCandidateInfo`
  (frontend-facing read shape). Candidate lives at `.anvil/dream/` —
  deliberately a *sibling* of `.anvil/memory/`, not nested inside it,
  because `scan_scope` there treats every subdirectory as a memory type and
  would have surfaced the candidate's own files as bogus live entries.
  - `write_dream_candidate`: wipes any previous candidate, writes
    `STATE.md` (if proposed), `episodic/*.md` + `playbook/*.md` (reusing
    `render_entry`, the same renderer live entries use), `DREAM_META.json`.
  - `read_dream_candidate`: reuses `scan_scope` on the candidate dir for
    free (episodic/playbook subdirectories are exactly what it already
    expects), returns `None` if nothing's pending.
  - `attach_dream_candidate`: the *only* place a dream ever touches the
    live store — deletes superseded episodic files, copies candidate
    entries in, overwrites `STATE.md` if updated, regenerates index +
    bridge exactly like a normal write, marks the candidate `attached`.
  - `discard_dream_candidate`: marks `discarded`, leaves the files (audit
    trail) — the next `write_dream_candidate` call wipes it anyway.
- `src/lib/dream.ts`: `buildDreamPrompt()` (state card + full episodic
  bodies, explicit densify/promote/learn/never-fabricate instructions,
  asks for one trailing fenced ` ```json ` block); `parseDreamReply()`
  (defensive — finds the *last* fenced JSON block, validates every field,
  drops anything malformed instead of throwing; no candidate gets written
  if parsing fails, never garbage in the store).
- `MemoryPanel.tsx`: "Dream" button next to "Capture now" (disabled while a
  candidate is pending review — a fresh dream would silently wipe an
  unreviewed one); `DreamReviewPanel` (summary, counts, Attach/Discard) at
  the very top of the cockpit when a candidate exists; new "Learned"
  section listing live `playbook` entries, same treatment as "Recent
  episodic".

## Deliberately deferred (not this slice)

- Semantic search of the curated layer itself (grok's own hybrid search
  already covers recall once bridged — a second index would be the "fork a
  store grok never reads" mistake).
- Any Forge-side (Swift) change to make Forge Grok actually consult these
  files — contract is documented above, implementation is Neo's call on
  the Mac.
- Causal graph UI (`caused_by`/`supersedes` as structured fields rather
  than prose beyond the episodic `supersedes` list Dream already writes) —
  add if/when it's actually load-bearing, not speculatively.
- Auto-attach — explicitly gated on having seen a real dream that didn't
  poison memory, not a speculative v2/v3 decision.
- Global-scope dreaming (operator-wide playbooks like "Anvil metal, no
  Forge cyan" that aren't tied to one workspace) and programmatic reading
  of raw `~/.grok/sessions/**/chat_history.jsonl` transcripts — v2's dream
  prompt tells the session it *may* look at recent transcripts itself
  (it already has file tools; no new Rust JSONL parsing was built), and
  scopes state-card/episodic output to the current project only. Broaden
  when there's a real workspace-spanning pattern to learn from, not before.
