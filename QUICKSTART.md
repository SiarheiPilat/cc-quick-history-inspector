# Quick start

## Requirements

- Node.js 18+ (anything modern is fine — uses stdlib only).
- Claude Code already installed and used at least once on this machine, so `~/.claude/projects/` and `~/.claude/plans/` exist with real data.

## Run it

```bash
git clone https://github.com/<your-user>/cc-quick-history-inspector.git
cd cc-quick-history-inspector
npm start
```

Then open http://localhost:5757 in your browser.

That's it. No `npm install` (zero deps), no build step.

## Common knobs

- **Different port:** `PORT=8080 npm start`
- **Refresh data:** the server reads files at request time, so just reload the browser. Brand-new sessions/plans created since startup will appear immediately.

## How to use the UI

- **Click a session in the left tree** to load its timeline on the right.
- **Type in the search box** to filter the tree and see global hits across every prompt. `/` focuses the box, `Esc` clears it.
- **Top-right toggles:**
  - `plans only` — only show sessions that produced a plan.
  - `markdown` — render plans as Markdown vs. raw text.
  - `me` / `claude` / `noise` — show/hide each role of message.
- **When `claude` is on**, a second row appears with a checkbox per tool (`Bash`, `Edit`, `Write`, every MCP tool you've used, …) plus `text-only replies`. Use `all` / `none` to bulk-toggle.
- **Hover any message or plan** to reveal a small icon copy button in the top-right corner. Click → text is on your clipboard. Plans copy as raw markdown; assistant messages copy text + every tool summary.

## Troubleshooting

- **"Pick a session on the left, or type to search."** — the API is still loading. Big histories take a second on first load. If it stays empty, check the terminal where `npm start` is running for errors, and that `~/.claude/projects/` actually has subfolders with `.jsonl` files.
- **Port already in use** — something else is on `5757`. Either stop it or use `PORT=8080 npm start`.
- **Plans not showing for a session** — the plan file's name must match the session's `slug` (e.g. `jiggly-snacking-dongarra.md`). If a plan was renamed by hand, the link is lost.

## Development

The whole tool is two files: `server.js` and `index.html`. Edit, save, refresh the browser. There is no build step.

If you change `server.js`, restart it (Ctrl+C in the terminal, then `npm start`).
