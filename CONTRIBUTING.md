# Contributing to Grok Desktop

Thanks for considering it — this is an early-stage, unofficial community client for
xAI's `grok` CLI, so there's plenty to do.

## Development setup

```bash
git clone https://github.com/Stonewave-Tech-LLC/grok-desktop.git
cd grok-desktop
npm install
npm run tauri dev
```

You'll also need the `grok` CLI itself installed and logged in (`grok login`) to
exercise anything beyond the empty-state UI, since the app talks to a real `grok agent
stdio` subprocess.

## Project layout

- `src-tauri/src/acp/` — the ACP (Agent Client Protocol) client: JSON-RPC framing over
  the `grok agent stdio` subprocess. `process.rs` is protocol-generic; `types.rs` holds
  the wire types.
- `src-tauri/src/commands.rs` — Tauri commands the frontend calls; this is where
  grok-specific method names/params live.
- `src/store/sessions.ts` — the frontend state machine that folds streamed
  `session/update` events into per-session timelines.
- `src/components/` — UI. `ChatPane`/`ToolCallCard`/`PermissionCard` render the
  transcript; `ActivityDock` is the tmux-style subagent/background-task panel.
- `docs/protocol-notes/` — real captured ACP traffic. If you're adding support for a
  new tool-call kind or notification type, capture a fresh transcript rather than
  guessing at the shape — see the recon approach described there.

## Reporting protocol shape mismatches

grok's ACP wire format isn't formally versioned/documented field-by-field, so if
something renders as a raw JSON blob instead of a proper card, that almost always means
we haven't seen that shape yet, not that the app is broken. Open an issue with the raw
`docs/protocol-notes`-style transcript if you can, or the relevant snippet from the
in-app debug console.

## Pull requests

- Keep PRs focused — one logical change per PR.
- Match the existing code style (Rust: `cargo fmt`; TS: no enforced formatter yet,
  match surrounding code).
- Run `cargo check` (backend) and `npm run build` (frontend, includes a `tsc` typecheck)
  before opening a PR.
- Explain the *why* in the PR description, not just the *what*.

## Code of conduct

Be respectful. This is a small community project, not a support queue — patience and
good-faith collaboration go a long way.
