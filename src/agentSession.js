const { EventEmitter } = require("events");
const path = require("path");

class AgentSession extends EventEmitter {
  constructor({ workspaceRoot, prompt, provider, onEvent }) {
    super();
    this._workspaceRoot = workspaceRoot;
    this._prompt = prompt;
    this._provider = provider;
    this._onEvent = onEvent;
    this._running = false;
    this._abortController = new AbortController();
  }

  isRunning() { return this._running; }

  async run() {
    this._running = true;
    this._abortController = new AbortController();

    try {
      // Dynamically import ESM agent-core modules
      const { getBridgeClient } = await import("agent-core/src/providers/api/bridgeClient.js");
      const { eventBus } = await import("agent-core/src/web/eventBus.js");

      // Forward agent events to the webview panel
      const forwardEvent = (data) => this._onEvent?.(data);
      const EVENT_TYPES = [
        "log", "system_message", "message_chunk", "message_complete",
        "phase_change", "turn_start", "thinking", "action_summary",
        "tool_call_start", "tool_call_end", "session_end",
      ];
      EVENT_TYPES.forEach((t) => eventBus.on(t, (d) => forwardEvent({ type: t, ...d })));

      const client = getBridgeClient();

      // Ensure bridge is available
      try {
        await client.ping();
      } catch {
        this._onEvent?.({
          type: "system_message",
          text: "browser-ai-bridge is not running. Start it first.",
          level: "error",
        });
        return;
      }

      // Create a browser AI session
      const session = await client.createSession(this._provider, {});

      this._onEvent?.({ type: "system_message", text: `Starting session with ${this._provider}...`, level: "info" });

      // Import and run the agent pipeline
      const { runCopilotFlow } = await import("agent-core/src/copilot/run/main/runCopilotFlow.js");

      await runCopilotFlow({
        session,
        projectDir: this._workspaceRoot,
        prompt: this._prompt,
        signal: this._abortController.signal,
      });

      await client.closeSession(session.id).catch(() => {});

      EVENT_TYPES.forEach((t) => eventBus.removeAllListeners(t));

      this._onEvent?.({ type: "session_end" });
    } catch (err) {
      if (err.name !== "AbortError") {
        this._onEvent?.({ type: "system_message", text: `Error: ${err.message}`, level: "error" });
      }
    } finally {
      this._running = false;
    }
  }

  stop() {
    this._abortController.abort();
    this._running = false;
  }
}

module.exports = { AgentSession };
