# dev-agent

VS Code extension that runs an autonomous AI coding agent inside the editor.
Drives a logged-in Chrome browser to ChatGPT / Gemini / DeepSeek / Grok /
Copilot — no API keys required.

This is the front end of a three-repo system. See
[ARCHITECTURE.md](./ARCHITECTURE.md) for how it connects to
[agent-core](https://github.com/jeffrey-nz/agent-core) and
[browser-ai-bridge](https://github.com/jeffrey-nz/browser-ai-bridge).

## Installation

```bash
git clone https://github.com/jeffrey-nz/dev-agent.git
cd dev-agent
npm install
npm run build
```

Open the workspace in VS Code. Press `Cmd+Shift+D` (or `Ctrl+Shift+D`) to
open the Dev Agent panel.

## Local development

The extension imports `agent-core` and `browser-ai-bridge` as GitHub
dependencies. For local iteration, check those repos out as siblings of
`dev-agent/` and run:

```bash
npm run sync-modules     # rsyncs ../agent-core and ../browser-ai-bridge into node_modules/
npm run watch            # rebuilds on save
```

After editing source in any of the three repos, run `npm run sync-modules`
again to pull the changes into the extension's bundle.

## Standalone agent runner

For testing the pipeline without VS Code:

```bash
node scripts/run-agent.mjs <provider> <workspace> <prompt>
# e.g.
node scripts/run-agent.mjs deepseek /tmp/test "Build a tic-tac-toe game"
```

Logs stream to stdout and `/tmp/agent-test.log`.

## Commands

| Command | Default keybinding | Description |
|---|---|---|
| `Dev Agent: Open` | `Cmd+Shift+D` | Open the chat panel |
| `Dev Agent: Stop` | `Cmd+Shift+.` | Cancel the active session |
| `Dev Agent: Select Provider` | — | Switch the active AI provider |
| `Dev Agent: Ask` | — | Send a one-shot prompt |

## How it works

1. You type a prompt in the panel webview.
2. `AgentSession` ([src/agentSession.js](./src/agentSession.js)) instantiates
   the `agent-core` LangGraph pipeline.
3. The pipeline calls `browser-ai-bridge` over HTTP at `localhost:3333` for
   every LLM turn.
4. The bridge drives a logged-in Chrome tab via Playwright and streams the
   response back.
5. Events (tool calls, file writes, phase changes) flow back to the webview
   in real time.

## Project structure

```
src/
├── extension.js          # VS Code activation, command registration
├── panel.js              # Webview HTML/CSS + extension-host wiring
├── panel-webview.js      # Webview-side script (chat UI, events)
├── agentSession.js       # Bridge: webview ↔ agent-core, event forwarding
├── browserPanel.js       # Browser preview panel
├── bridgeLauncher.js     # Starts/stops the bridge HTTP server
├── diffUtils.js          # File diff rendering helpers
└── logger.js             # Session transcript logging

bin/dev-agent.mjs         # Standalone CLI entry — boots bridge + opens VS Code
scripts/build.mjs         # esbuild bundler for the extension
scripts/run-agent.mjs     # Headless agent runner for testing
```

## Requirements

- Node.js >= 20
- VS Code >= 1.85
- Google Chrome (the bridge will launch it via CDP)
- Active logins to whichever AI providers you want to use

## License

MIT
