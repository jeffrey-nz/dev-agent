# Architecture

The agent pipeline spans three repositories that talk to each other over local
HTTP and Node imports. This document is the front door — read it before diving
into any individual repo.

## The three repos

| Repo | Role | Process | Entry |
|---|---|---|---|
| [**dev-agent**](https://github.com/jeffrey-nz/dev-agent) | VS Code extension + standalone CLI runner | VS Code extension host | `src/extension.js`, `bin/dev-agent.mjs`, `scripts/run-agent.mjs` |
| [**agent-core**](https://github.com/jeffrey-nz/agent-core) | LangGraph pipeline that does the actual planning, coding, verification | In-process (imported by dev-agent) | `src/agent/index.js` (`runAgent`), `src/copilot/run/main/runCopilotFlow.js` (`runCopilotFlow`) |
| [**browser-ai-bridge**](https://github.com/jeffrey-nz/browser-ai-bridge) | Local HTTP server that drives logged-in Chrome tabs via Playwright/CDP | Standalone Node server on `localhost:3333` | `src/index.js` → `src/server.js` |

## Data flow

```
┌────────────────────────────┐
│ VS Code chat panel         │   user types a prompt
│ (dev-agent webview)        │
└──────────────┬─────────────┘
               │ postMessage
               ▼
┌────────────────────────────┐
│ AgentSession               │   bridges webview ↔ agent-core
│ (dev-agent/src)            │   forwards events to UI
└──────────────┬─────────────┘
               │ in-process import
               ▼
┌────────────────────────────┐
│ runCopilotFlow / runAgent  │   LangGraph workflow:
│ (agent-core/src)           │   intent → research → plan
│                            │   → coder ↔ verifier ↔ critic
└──────────────┬─────────────┘
               │ HTTP POST /api/ask
               ▼
┌────────────────────────────┐
│ /api/ask route             │   marshals to engine.sendPromptAndWait
│ (browser-ai-bridge)        │   or sendPromptWithFile if images present
└──────────────┬─────────────┘
               │ Playwright CDP
               ▼
┌────────────────────────────┐
│ Logged-in Chrome tab       │   ChatGPT / Gemini / DeepSeek / etc.
└────────────────────────────┘
```

## How the three repos depend on each other

- **dev-agent** imports `agent-core` as a npm dep (GitHub URL).
- **agent-core** calls `browser-ai-bridge` over HTTP via `src/providers/api/`.
- **browser-ai-bridge** has no dependencies on the other two — it's a pure
  service.

For local development, dev-agent uses a `sync-modules` script that rsyncs
both upstream repos into its `node_modules/`. That lets you edit any of the
three repos and immediately see the effect after rebuilding the extension.

## Key boundaries

| Boundary | Protocol | Where to look |
|---|---|---|
| Webview ↔ Extension host | `postMessage` JSON | [dev-agent/src/panel-webview.js](https://github.com/jeffrey-nz/dev-agent/blob/master/src/panel-webview.js), [dev-agent/src/panel.js](https://github.com/jeffrey-nz/dev-agent/blob/master/src/panel.js) |
| Extension ↔ agent-core | Direct ES module calls + event forwarding | [dev-agent/src/agentSession.js](https://github.com/jeffrey-nz/dev-agent/blob/master/src/agentSession.js) |
| agent-core ↔ bridge | HTTP POST `/api/ask` (JSON, may include `images[]`) | [agent-core/src/providers/api/interaction.js](https://github.com/jeffrey-nz/agent-core/blob/master/src/providers/api/interaction.js), [browser-ai-bridge/src/routes/ask.js](https://github.com/jeffrey-nz/browser-ai-bridge/blob/main/src/routes/ask.js) |
| bridge ↔ Chrome | Playwright CDP, attaching to user's signed-in browser | [browser-ai-bridge/src/ai/](https://github.com/jeffrey-nz/browser-ai-bridge/tree/main/src/ai) |

## When something breaks, ask "which layer?"

The pipeline rule (`memory/feedback_pipeline.md`): **fixes go in the pipeline,
not in target projects**. Trace failures to the responsible repo:

- **Bad output from the LLM** — extraction or prompt issue → `agent-core` (`src/agent/graph/nodes/*`, `src/utils/projectDirectives.js`) or `browser-ai-bridge` extract code
- **Browser session stalled / tab leak** → `browser-ai-bridge` (`src/session/*`, `src/ai/<provider>/`)
- **UI bug, wrong event rendered** → `dev-agent` (`src/panel-webview.js`, `src/agentSession.js`)
- **Pipeline orchestration (wrong node ran, infinite loop)** → `agent-core` (`src/agent/graph/workflow.js`, transitions)

## Quick reference

| Task | Command | Repo |
|---|---|---|
| Start the bridge | `npm start` | browser-ai-bridge |
| Run audit (verify selectors still work) | `npm run audit -- --provider Gemini` | browser-ai-bridge |
| Run agent standalone | `node scripts/run-agent.mjs <provider> <workspace> <prompt>` | dev-agent |
| Build VS Code extension | `npm run build` | dev-agent |
| Sync local source into extension `node_modules` | `npm run sync-modules` | dev-agent |
| Run unit tests | `npm test` | browser-ai-bridge (others: TBD) |
