const { EventEmitter } = require("events");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

class AgentSession extends EventEmitter {
  constructor({ workspaceRoot, prompt, provider, providerMode, onEvent, logger, images }) {
    super();
    this._workspaceRoot = workspaceRoot;
    this._prompt = prompt;
    this._provider = provider;
    this._providerMode = providerMode || null;
    this._onEvent = onEvent;
    this._logger = logger;
    this._images = images || [];
    this._running = false;
    this._abortController = new AbortController();
  }

  isRunning() { return this._running; }

  // Ensure the workspace has its own git repo so the agent never touches a
  // parent repo. Also clears any stale index.lock that would block git ops.
  _prepareWorkspace() {
    fs.mkdirSync(this._workspaceRoot, { recursive: true });
    const gitDir = path.join(this._workspaceRoot, ".git");
    if (!fs.existsSync(gitDir)) {
      execSync("git init", { cwd: this._workspaceRoot, stdio: "ignore" });
      execSync('git commit --allow-empty -m "init"', {
        cwd: this._workspaceRoot,
        stdio: "ignore",
        env: { ...process.env, GIT_AUTHOR_NAME: "Dev Agent", GIT_AUTHOR_EMAIL: "agent@local", GIT_COMMITTER_NAME: "Dev Agent", GIT_COMMITTER_EMAIL: "agent@local" },
      });
    }
    // Remove stale lock if present
    const lockFile = path.join(gitDir, "index.lock");
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
  }

  async run() {
    this._running = true;
    this._abortController = new AbortController();

    this._logger?.start({ provider: this._provider, workspace: this._workspaceRoot });
    this._logger?.info(`Prompt: ${this._prompt}`);

    let handlers = new Map();
    let onFeedback = null;
    let eventBus = null;

    try {
      this._prepareWorkspace();

      const { getBridgeClient } = await import("agent-core/src/providers/api/bridgeClient.js");
      ({ eventBus } = await import("agent-core/src/web/eventBus.js"));

      const emit = (data) => {
        this._logger?.event(data.type, data);
        this._onEvent?.(data);
      };

      // Strip ANSI codes from text before forwarding to the UI
      const stripAnsi = (s) => typeof s === "string" ? s.replace(/\x1b\[[0-9;]*m/g, "") : s;

      // Forward only the events the UI actually uses; skip raw 'log' (ANSI-heavy terminal output).
      // message_chunk is not forwarded — the panel only shows message_complete.
      const FORWARDED_EVENTS = [
        "system_message", "message_complete",
        "phase_change", "tool_call_start", "tool_call_end",
        "browser_context_update", "copilot365_segment_boundary",
        "session_handoff", "session_role_update",
      ];
      FORWARDED_EVENTS.forEach((t) => {
        const handler = (d) => {
          const cleaned = { ...d, type: t };
          // For system_message, preserve the original severity so the UI can style
          // warnings differently from errors. The event payload uses 'type' for severity
          // (e.g. "warning", "error") but spread above overwrites 'type' with the event name.
          if (t === "system_message" && d.type && d.type !== t) {
            cleaned.level = d.type; // "warning", "error", "info"
          }
          if (cleaned.text) cleaned.text = stripAnsi(cleaned.text);
          if (cleaned.content) cleaned.content = stripAnsi(cleaned.content);
          emit(cleaned);
        };
        handlers.set(t, handler);
        eventBus.on(t, handler);
      });

      // Auto-finish when the agent asks for human feedback — sending "" exits the loop
      onFeedback = ({ requestId }) => {
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
        // Skip automatic npm-test verification + rollback — the user controls
        // when to run tests. Rollback on a missing test script would destroy
        // a perfectly good agent output silently.
        _benchmarkRun: true,
        ...(this._images.length ? { images: this._images } : {}),
      };

      await runCopilotFlow({
        providerName: this._provider,
        providerMode: this._providerMode,
        projectDir: this._workspaceRoot,
        sessionInfo,
        signal: this._abortController.signal,
      });
    } catch (err) {
      if (err.name !== "AbortError") {
        this._logger?.error(err.message);
        this._onEvent?.({ type: "system_message", text: `Error: ${err.message}`, level: "error" });
      }
    } finally {
      // Clean up eventBus listeners regardless of how we exited
      if (eventBus) {
        handlers.forEach((handler, t) => eventBus.off(t, handler));
        if (onFeedback) eventBus.off("prompt_feedback", onFeedback);
      }
      this._running = false;
      this._logger?.end();
      // Always notify the UI so it can re-show the Send button
      this._onEvent?.({ type: "session_end" });
    }
  }

  stop() {
    this._abortController.abort();
    this._running = false;
  }
}

module.exports = { AgentSession };
