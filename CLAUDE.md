# cc-quick-history-inspector — project rules

## UI conventions

- **Copy buttons everywhere.** Any block of content that a user might want to grab — prompts, assistant outputs, plans, code blocks, search results — must have a small inline copy button (top-right corner of the block) that copies the raw text to the clipboard via `navigator.clipboard.writeText`. Visual feedback on click (e.g. icon flips to a checkmark for ~1s). This is a baseline expectation; do not ship a new content surface without one.

## Tech

- Zero-build, vanilla. `server.js` (Node stdlib http, no deps) + `index.html` (vanilla JS, marked.js from CDN). Don't introduce a bundler or framework without a strong reason.
- Run: `npm start` → `http://localhost:5757`. Override port with `PORT=...`.

## Data

- Sessions are read from `~/.claude/projects/<encoded>/*.jsonl`. Plans from `~/.claude/plans/*.md`, correlated to a session via the session's `slug` field.
- Project display names use the session's `cwd`, not the encoded folder name (the encoding is lossy).
- Noise stripping: synthetic blocks (`<system-reminder>`, `<command-*>`, `<task-notification>`, `<local-command-*>`, "Caveat:" preambles) are removed from user text before display. Whatever remains empty after stripping is tagged `noise` and hidden unless the user toggles it on.
