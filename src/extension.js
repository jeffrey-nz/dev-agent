const vscode = require("vscode");
const { AgentSession } = require("./agentSession");
const { DevAgentViewProvider } = require("./panel");
const { SessionLogger } = require("./logger");
const bridge = require("./bridgeLauncher");

const PROVIDER_LABELS = {
  copilot:    "Microsoft Copilot",
  copilot365: "Microsoft 365 Copilot",
  chatgpt:    "ChatGPT",
  gemini:     "Google Gemini",
  deepseek:   "DeepSeek",
  grok:       "xAI Grok",
};

let provider = null;
let agentSession = null;
let logger = null;
let selectedProviders = [];

function activate(context) {
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionPath;

  logger = new SessionLogger(context.extensionPath);

  provider = new DevAgentViewProvider(context, (msg) =>
    handleWebviewMessage(msg, workspaceRoot),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DevAgentViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand("devAgent.start", () =>
      vscode.commands.executeCommand("devAgent.mainView.focus"),
    ),
    vscode.commands.registerCommand("devAgent.ask", async () => {
      const text = await vscode.window.showInputBox({ prompt: "Ask Dev Agent" });
      if (text) handleWebviewMessage({ type: "start_task", prompt: text });
    }),
    vscode.commands.registerCommand("devAgent.stop", () => agentSession?.stop()),
  );
}

async function handleWebviewMessage(msg) {
  switch (msg.type) {

    case "check_bridge": {
      const running = await bridge.isRunning();
      if (running) {
        const label = selectedProviders.map((id) => PROVIDER_LABELS[id] ?? id).join(", ") || "bridge";
        provider.postMessage({ type: "bridge_ready", providerLabel: label, alreadyRunning: true });
      }
      break;
    }

    case "launch_bridge": {
      selectedProviders = msg.providers ?? [];
      bridge.launch(selectedProviders);

      provider.postMessage({
        type: "bridge_starting",
        providers: selectedProviders.map((id) => ({ id, label: PROVIDER_LABELS[id] ?? id })),
      });

      const ready = await bridge.waitForReady((state) => {
        provider.postMessage({ type: "setup_state", state });
      });

      if (ready) {
        const label = selectedProviders.map((id) => PROVIDER_LABELS[id] ?? id).join(", ") || "bridge";
        provider.postMessage({ type: "bridge_ready", providerLabel: label });
      } else {
        provider.postMessage({
          type: "bridge_failed",
          text: "Bridge did not become ready within 2 minutes. Check the terminal for errors.",
        });
      }
      break;
    }

    case "confirm_provider":
      await bridge.confirmProvider();
      break;

    case "skip_provider":
      await bridge.skipProvider();
      break;

    case "start_task": {
      if (agentSession?.isRunning()) {
        provider.postMessage({ type: "system_message", text: "Already running.", level: "warn" });
        return;
      }
      const chosenProvider = msg.provider || selectedProviders[0] || "copilot";
      agentSession = new AgentSession({
        workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
        prompt: msg.prompt,
        provider: chosenProvider,
        onEvent: (e) => provider.postMessage(e),
        logger,
      });
      agentSession.run().catch((err) => {
        provider.postMessage({ type: "system_message", text: `Error: ${err.message}`, level: "error" });
      });
      break;
    }

    case "stop":
      agentSession?.stop();
      break;

    case "reset":
      agentSession?.stop();
      selectedProviders = [];
      break;
  }
}

function deactivate() {
  agentSession?.stop();
  logger?.end();
}

module.exports = { activate, deactivate };
