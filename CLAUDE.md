# dev-agent — Claude Code guide

This is the **front-end** VS Code extension in a three-repo agent system.
For the big picture, read [ARCHITECTURE.md](./ARCHITECTURE.md) first.

## What you'll actually edit

Almost all work in this repo lives in `src/`:

- **`panel.js`** — Webview HTML, CSS, and host-side message handlers. UI
  changes (chat bubbles, sidebar widgets, input area) start here.
- **`panel-webview.js`** — The script that runs inside the webview. Event
  rendering (tool calls, diffs, handoff cards, attachments) is here.
- **`agentSession.js`** — The bridge between the webview and `agent-core`.
  Instantiates the LangGraph pipeline, forwards events back to the
  webview. `FORWARDED_EVENTS` controls which events the webview sees.
- **`extension.js`** — VS Code activation, command registration, provider
  picker. Glue, not logic.

## What you almost never need to edit

- `bridgeLauncher.js` — boots/kills the bridge subprocess. Usually fine.
- `browserPanel.js` — a separate browser preview panel. Self-contained.
- `bin/dev-agent.mjs` — the standalone CLI entry. Reads `.env`, opens VS
  Code, points it at the extension.

## Build & run

```bash
npm install
npm run build          # one-shot esbuild bundle → dist/extension.cjs
npm run watch          # rebuild on save
```

Test in VS Code by pressing F5 with this folder open (launches Extension
Development Host).

To test the agent pipeline **without** VS Code:

```bash
node scripts/run-agent.mjs deepseek /tmp/test "build a hello world"
```

## sync-modules — the most important script

The extension bundles `agent-core` and `browser-ai-bridge` from
`node_modules/`. By default these come from GitHub. To iterate locally:

```bash
npm run sync-modules   # rsyncs sibling ../agent-core and ../browser-ai-bridge
```

**Run this after every edit to those sibling repos.** Otherwise the
extension still ships with the old bundled copy.

## Common pitfalls

- **CommonJS, not ESM.** This repo is `"type": "commonjs"` because the
  VS Code extension API requires it. Imports use `require`, not `import`.
  (The sibling repos are ESM — only this one is CJS.)
- **Events from `agent-core` need to be in `FORWARDED_EVENTS` in
  `agentSession.js`** or the webview never sees them. If you add a new
  event type in agent-core and it doesn't appear in the UI, check this
  list first.
- **The webview is sandboxed.** It cannot touch the filesystem, network,
  or VS Code APIs directly. Anything fancy has to go through
  `vscode.postMessage` to the extension host.
- **Don't read VS Code config from the webview.** All config access
  happens in `panel.js` / `extension.js` and is forwarded.

## Event protocol (panel ↔ extension)

Webview → extension:
- `{ type: "start_task", prompt, provider, images? }`
- `{ type: "stop_task" }`
- `{ type: "select_provider", provider }`

Extension → webview (a subset; full list in `agentSession.js`):
- `phase_change`, `system_message`, `tool_call_start`, `tool_call_end`
- `message_complete`, `file_modified`, `session_handoff`, `session_end`

## When things break

- **UI doesn't render an event** → check `FORWARDED_EVENTS` in
  `agentSession.js`, then check the renderer in `panel-webview.js`.
- **Bridge won't start** → check `bridgeLauncher.js` and look at the bridge
  log it writes to (`/tmp/bridge.log` or `logs/`).
- **Agent does the wrong thing** → that's an agent-core problem, not a
  dev-agent problem. See `../agent-core/CLAUDE.md`.

Per the project rule: **fix the pipeline, not target projects** — if the
agent produced bad code in a workspace, the fix goes in `agent-core`
prompts/nodes or `browser-ai-bridge` extraction, not in the workspace
files.
