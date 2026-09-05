# Grok Desktop

A cross-platform desktop client for [xAI's `grok` CLI](https://x.ai) ("Grok Build") —
chat, streaming responses, tool calls, subagents, and background tasks in a real GUI
instead of a terminal.

> **Unofficial project.** Grok Desktop is a community client built by
> [Stonewave Tech](https://stonewavetech.com). It is not affiliated with, endorsed by,
> or sponsored by xAI. "Grok" is xAI's product; this app just talks to its CLI over the
> [Agent Client Protocol](https://agentclientprotocol.com) (the same integration model
> editors like Zed use).

## What it does

Grok Desktop spawns `grok agent stdio` and speaks ACP (JSON-RPC 2.0 over stdio) to it
directly — it's a real protocol client, not a terminal wrapper. That gets you:

- **Chat** with streaming responses, markdown and syntax-highlighted code rendering
  (CodeMirror, for JS/TS/Python/Rust/JSON/Markdown; other languages render plainly).
- **Tool calls** rendered inline as the agent reads files, edits code, and runs
  commands — including inline diffs for edits (fed straight from grok's own before/after
  text) and plain-language descriptions instead of raw shell commands.
- **Permission prompts** rendered inline as part of the conversation, built from
  whatever options the request actually offers rather than a hardcoded allow/deny —
  including dedicated cards for plan-mode approval and grok's multiple-choice
  question tool, which speak their own ACP `ext_method` wire shapes rather than the
  generic permission-response envelope.
- **Voice mode** (macOS) — click to dictate, live transcript shown inline in the
  composer, using the OS's own on-device speech recognition. Windows support is
  planned; see Roadmap.
- **An Activity dock** — grok's own subagents and background shell commands shown as
  live status cards, instead of being invisible or buried in scrollback. Auto-opens the
  first time a session gets any.
- **A Cost Cockpit and Workflow Dashboard** — live cumulative token/cost tracking per
  session, plus a real-time view into grok's own `/workflow` and `/goal` multi-agent
  runs (phases, active agents, budget) instead of just a status line.
- **Native Grok-Imagine integration** — generating stills overlay the chat (not a
  thumb in the tool log). **Imagine Studio** is a working set (latest + prompt
  families + edit/animate/vary/ref), not a dump grid. Model and permission mode
  switchers talk ACP `session/set_model` and `session/set_mode`.
- **Operator memory** — a state card, episodic captures, and a review-before-attach
  **Dream** pass (densify + learn, copy-on-write candidate at `.anvil/dream/`). Lives
  as markdown next to grok's own `~/.grok/memory/`; semantic recall stays grok's
  FTS5/embeddings. Auto-dream when idle is on by default; nothing attaches until
  you say so.
- **Sessions** that survive an app restart — new / switch / rename / delete, with
  history persisted locally and the backend connection reattached automatically on
  launch. Login is handled in-app too: a first-run screen drives `grok login
  --device-auth` and opens the browser for you.
- A floating, resizable Insights dock (Activity / Workflows / Assets / Memory) that
  overlays the chat instead of squeezing it, and a two-pane Settings modal.

## Status

Actively developed and used daily. The core chat/tool-call/permission loop, session
persistence, and the panels above are all solid. See [Roadmap](#roadmap) for what's
deliberately still out — mainly polish items (signed builds, a dedicated file browser,
Windows voice mode) rather than gaps in the core experience.

## Download

Product site: [anvil.stonewavetech.com](https://anvil.stonewavetech.com).

macOS (Apple Silicon) and Windows (x64) builds are published on
[Releases](https://github.com/Stonewave-Tech-LLC/grok-desktop/releases). Builds are
currently **unsigned**: macOS will warn about an unidentified developer on first launch
(right-click → Open) and Windows SmartScreen will flag an unknown publisher — expected
until a Developer ID / Windows Authenticode cert is in the Apple/Windows stores
(see Roadmap). Apple Development identities on a build Mac can sign a local `.app`
for that machine; they cannot notarize a public download.

## Getting started

You need the `grok` CLI installed and logged in first:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok login
```

Then build Grok Desktop from source:

**Prerequisites:** [Rust](https://rustup.rs), [Node.js](https://nodejs.org) 18+, and
the platform build tools [Tauri requires](https://v2.tauri.app/start/prerequisites/)
(Xcode Command Line Tools on macOS, `build-essential` + WebKitGTK on Linux, the Visual
Studio Build Tools + WebView2 on Windows).

```bash
git clone https://github.com/Stonewave-Tech-LLC/grok-desktop.git
cd grok-desktop
npm install
npm run tauri dev    # dev build
npm run tauri build  # release build
```

## Architecture

- **`src-tauri/`** — Rust/Tauri backend. Owns the `grok agent stdio` child process,
  frames newline-delimited JSON-RPC 2.0 over its stdin/stdout, and bridges it to the
  frontend as Tauri commands/events. See [`src-tauri/src/acp/`](src-tauri/src/acp/).
  `memory.rs` owns the Anvil Memory store independently of the ACP connection.
- **`src/`** — React/TypeScript frontend (Vite, Tailwind, CodeMirror for code/diffs).
- **`docs/protocol-notes/`** — captured real-world ACP traffic from `grok agent stdio`,
  used to build the client instead of guessing at wire shapes. Might be useful if
  you're building your own ACP client against grok.

## Roadmap

Explicitly out of scope for the current build, so the gap between "done" and "planned"
stays honest:

- A standalone file tree / browser view (inline diffs in the chat cover the common
  case today; a dedicated Files tab for browsing the whole workspace is next)
- Live streaming sub-transcripts for subagents (today: periodic progress + a final
  summary — that's all the protocol exposes on the parent's own event stream; see
  `docs/protocol-notes/`)
- Multi-window / multi-project tabs
- MCP server management UI
- Plugin browser
- Worktree management UI
- Voice mode on Windows (macOS is done — see What it does)
- Signed & notarized release builds (needs a paid Apple Developer Program **Developer
  ID Application** cert plus a Windows Authenticode cert — Apple Development
  identities are not enough to Gatekeeper-pass other people's Macs)
- Auto-update
- Intel macOS download (CI `macos-latest` is Apple Silicon; Intel is source-build)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

Built by [Stonewave Tech LLC](https://stonewavetech.com) × [Claude](https://claude.com)
(Anthropic).

## License

[MIT](LICENSE) — Copyright (c) 2026 Stonewave Tech LLC.
