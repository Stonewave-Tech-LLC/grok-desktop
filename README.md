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
  commands — including inline diffs for edits, fed straight from grok's own
  before/after text (no unified-diff parsing needed).
- **Permission prompts** rendered inline as part of the conversation, built from
  whatever options the request actually offers rather than a hardcoded allow/deny.
- **An Activity dock** — grok's own subagents and background shell commands shown as
  live status cards (a GUI take on the CLI's own Tasks pane), instead of being
  invisible or buried in scrollback. Auto-opens the first time a session gets any.
- **Sessions** — new / switch / rename / delete for the current app run. Login is
  handled in-app too: a first-run screen drives `grok login --device-auth` and opens
  the browser for you.

## Status

Early and under active development. See [Roadmap](#roadmap) below for what's
deliberately not in yet.

## Getting started

You need the `grok` CLI installed and logged in first:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok login
```

Then build Grok Desktop from source (no prebuilt binaries are published yet — see
[Roadmap](#roadmap)):

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
- **`src/`** — React/TypeScript frontend (Vite, Tailwind, CodeMirror for code/diffs).
- **`docs/protocol-notes/`** — captured real-world ACP traffic from `grok agent stdio`,
  used to build the client instead of guessing at wire shapes. Might be useful if
  you're building your own ACP client against grok.

## Roadmap

Explicitly out of scope for the current build, so the gap between "done" and "planned"
stays honest:

- A standalone file tree / browser view (inline diffs in the chat cover the common
  case today; a dedicated Files tab for browsing the whole workspace is next)
- Session history that survives an app restart (sessions currently live for the app's
  run, backed by the live ACP connection, not yet reloaded from grok's on-disk store)
- Live streaming sub-transcripts for subagents (today: periodic progress + a final
  summary — that's all the protocol exposes on the parent's own event stream; see
  `docs/protocol-notes/`)
- Multi-window / multi-project tabs
- MCP server management UI
- Plugin browser
- Worktree management UI
- Voice mode
- Signed & notarized release builds (needs a paid Apple Developer Program / Windows
  code-signing cert — not set up yet)
- Auto-update

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

Built by [Stonewave Tech LLC](https://stonewavetech.com) × [Claude](https://claude.com)
(Anthropic).

## License

[MIT](LICENSE) — Copyright (c) 2026 Stonewave Tech LLC.
