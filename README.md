# cc-quick-history-inspector

A fast, local browser tool for digging through your Claude Code history. Reads the JSONL session logs and plan files Claude Code already writes to `~/.claude/`, and presents them as a searchable, filterable, chronological tree.

No build step, no external services, no telemetry. Just `node server.js` and a browser tab.

![one-line summary: project tree on the left, prompts/plans/assistant turns on the right, with granular per-tool filters and a search box at the top](docs/screenshot-placeholder.png)

## What it does

- Scans every `~/.claude/projects/<encoded>/*.jsonl` and surfaces the sessions in a tree grouped by project (resolved from the session's `cwd` so the names look like real paths).
- Pulls plans from `~/.claude/plans/*.md` and links them to the session that produced them via the session's `slug` field.
- Renders the session as a chronological timeline: your prompts, Claude's replies, Claude's tool calls, and the plan, all interleaved by timestamp.
- Strips the noisy synthetic blocks (`<system-reminder>`, `<command-name>`, `<task-notification>`, `<local-command-*>`, "Caveat:" preambles) from prompt text so you see what you actually typed.

## Features

- **Top search** — substring match across every prompt and plan; matches highlighted; tree filters down at the same time.
- **Project tree** — newest sessions first, project names from the real `cwd`. Sessions with a plan are tagged `◆`.
- **Chronological timeline** — prompt #1, Claude's response, plan, prompt #2, … sorted by timestamp.
- **Markdown toggle** — render plans with proper headings, tables, code blocks, etc. (default on, persisted).
- **Role distinction** — colored left-border + `ME` / `CLAUDE` / `NOISE` badges. Hide what you don't want.
- **Granular tool filters** — when "claude" is on, a second row appears with a checkbox per tool (`Bash`, `Edit`, `Write`, `Read`, every MCP tool, etc.) so you can mute the noisy ones and keep the prose. `text-only replies` is its own toggle.
- **Tool summaries** — each tool call shows a one-line preview of what it did (e.g. `Bash: Check plans dir — ls ~/.claude/plans/`).
- **Copy buttons** — every prompt, every assistant message (text + tool summaries combined), every plan has an inline icon copy button. Click → clipboard.
- **Keyboard** — `/` focuses the search, `Esc` clears it.
- **Persistence** — toggles and per-tool filter state are saved in `localStorage`.

## How it's wired

```
~/.claude/projects/<encoded>/*.jsonl   <- session logs
~/.claude/plans/*.md                   <- plan files

   server.js  ──>  /api/data    (full tree, all messages)
                   /api/plan    (plan content for one slug)
                   /            (index.html)

   index.html  <─  vanilla JS + marked.js (CDN)
```

- `server.js` — Node stdlib HTTP, zero deps. Reads files, parses JSONL line-by-line, strips synthetic content, classifies messages as `user` / `assistant` / `noise`, summarizes each `tool_use` (e.g. for `Bash` it surfaces `description + command`).
- `index.html` — single page. Renders the tree, the timeline, and the granular filter row. Markdown rendered via `marked` from a CDN. No bundler, no framework.
- Plans are correlated to sessions via the session's `slug` field, which matches the plan filename.

## Configuration

- Port: `PORT=8080 npm start` (default `5757`).
- Plans dir: `~/.claude/plans/`. Sessions dir: `~/.claude/projects/`. These paths are resolved at startup; restart the server to pick up brand-new sessions or plans.

## Privacy / safety

Everything runs locally. The server reads files under `~/.claude/`; nothing is sent over the network (the only outbound request is the `marked` CDN bundle, which can be vendored if you want fully offline operation). Bind address is implicit `localhost`.

## Roadmap (loose)

- 3D / decision-tree view of sessions and plans.
- Run commands from the inspector (re-fire a prompt in a new Claude Code session).
- Self-improvement loop: auto-suggest filter presets based on what you actually open.
- Vendor `marked` for offline-first.

## License

MIT.
