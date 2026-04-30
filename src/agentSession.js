const { EventEmitter } = require("events");

class AgentSession extends EventEmitter {
  constructor({ workspaceRoot, prompt, provider, onEvent, logger }) {
    super();
    this._workspaceRoot = workspaceRoot;
    this._prompt = prompt;
    this._provider = provider;
    this._onEvent = onEvent;
    this._logger = logger;
    this._running = false;
    this._abortController = new AbortController();
  }

  isRunning() { return this._running; }

  async run() {
    this._running = true;
    this._abortController = new AbortController();

    this._logger?.start({ provider: this._provider, workspace: this._workspaceRoot });
    this._logger?.info(`Prompt: ${this._prompt}`);

    try {
      const { getBridgeClient } = await import("agent-core/src/providers/api/bridgeClient.js");
      const { eventBus } = await import("agent-core/src/web/eventBus.js");

      const emit = (data) => {
        this._logger?.event(data.type, data);
        this._onEvent?.(data);
      };

      const EVENT_TYPES = [
        "log", "system_message", "message_chunk", "message_complete",
        "phase_change", "turn_start", "thinking", "action_summary",
        "tool_call_start", "tool_call_end",
      ];
      EVENT_TYPES.forEach((t) => eventBus.on(t, (d) => emit({ type: t, ...d })));

      // Auto-finish when the agent asks for human feedback after completing a task.
      // Sending empty string causes runCopilotFlow to exit the loop cleanly.
      const onFeedback = ({ requestId }) => {
        setImmediate(() => eventBus.emit(`ws_response_${requestId}`, { value: "" }));
      };
      eventBus.on("prompt_feedback", onFeedback);

      const client = getBridgeClient();
      const alive = await client.health().then(() => true).catch(() => false);
      if (!alive) {
        emit({ type: "system_message", text: "Bridge is not responding.", level: "error" });
        return;
      }

      emit({ type: "system_message", text: `Session started with ${this._provider}.`, level: "info" });

      const { runCopilotFlow } = await import("agent-core/src/copilot/run/main/runCopilotFlow.js");

      const sessionInfo = {
        isNew: false,
        status: "approved",
        initialPrompt: this._prompt,
        sessionId: `vscode-${Date.now()}`,
      };

      await runCopilotFlow({
        providerName: this._provider,
        projectDir: this._workspaceRoot,
        sessionInfo,
        signal: this._abortController.signal,
      });

      EVENT_TYPES.forEach((t) => eventBus.removeAllListeners(t));
      eventBus.off("prompt_feedback", onFeedback);
      emit({ type: "session_end" });
    } catch (err) {
      if (err.name !== "AbortError") {
        this._logger?.error(err.message);
        this._onEvent?.({ type: "system_message", text: `Error: ${err.message}`, level: "error" });
      }
    } finally {
      this._running = false;
      this._logger?.end();
    }
  }

  stop() {
    this._abortController.abort();
    this._running = false;
  }
}

module.exports = { AgentSession };
