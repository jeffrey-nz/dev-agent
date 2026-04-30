const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
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
let workspaceRoot = null;   // set when user confirms a project
let extensionCtx = null;

function activate(context) {
  extensionCtx = context;
  logger = new SessionLogger(context.extensionPath);

  provider = new DevAgentViewProvider(context, handleWebviewMessage);

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

    // ── Project selection ────────────────────────────────────────────────────

    case "get_workspaces": {
      const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
        name: f.name,
        path: f.uri.fsPath,
      }));
      provider.postMessage({ type: "workspaces", folders });
      break;
    }

    case "browse_folder": {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Select project folder",
        title: "Select project folder",
      });
      if (uris?.[0]) {
        const p = uris[0].fsPath;
        provider.postMessage({ type: "folder_chosen", folder: { name: path.basename(p), path: p } });
      }
      break;
    }

    case "create_folder": {
      const name = await vscode.window.showInputBox({
        prompt: "New folder name",
        placeHolder: "my-project",
        validateInput: (v) =>
          v.trim() && /^[^<>:"/\\|?*]+$/.test(v.trim()) ? null : "Enter a valid folder name",
      });
      if (!name) break;

      const parentUris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Choose parent location",
        title: "Where should the new folder be created?",
      });
      if (!parentUris?.[0]) break;

      const newPath = path.join(parentUris[0].fsPath, name.trim());
      try {
        fs.mkdirSync(newPath, { recursive: true });
        provider.postMessage({ type: "folder_chosen", folder: { name: name.trim(), path: newPath } });

        // Optionally open the new folder as a workspace
        await vscode.commands.executeCommand(
          "vscode.openFolder",
          vscode.Uri.file(newPath),
          { forceNewWindow: false },
        );
      } catch (err) {
        provider.postMessage({ type: "system_message", text: `Could not create folder: ${err.message}`, level: "error" });
      }
      break;
    }

    case "confirm_workspace": {
      workspaceRoot = msg.path;
      provider.postMessage({ type: "workspace_confirmed", name: msg.name, path: msg.path });
      break;
    }

    // ── Chat ─────────────────────────────────────────────────────────────────

    case "start_task": {
      if (agentSession?.isRunning()) {
        provider.postMessage({ type: "system_message", text: "Already running.", level: "warn" });
        return;
      }
      const root = workspaceRoot
        ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        ?? process.cwd();
      const chosenProvider = msg.provider || selectedProviders[0] || "copilot";

      agentSession = new AgentSession({
        workspaceRoot: root,
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
      workspaceRoot = null;
      break;

    case "change_project":
      // Return to project selection without restarting the bridge
      provider.postMessage({ type: "show_project_screen" });
      break;
  }
}

function deactivate() {
  agentSession?.stop();
  logger?.end();
}

module.exports = { activate, deactivate };
