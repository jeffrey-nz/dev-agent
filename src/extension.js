const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const { AgentSession } = require("./agentSession");
const { DevAgentViewProvider, DevAgentPanel } = require("./panel");
const { SessionLogger } = require("./logger");
const bridge = require("./bridgeLauncher");

function isWriteTool(name) {
  return /write|creat|patch|edit|updat|modif|apply|put/i.test(name || "");
}

function resolveToolPath(paramsSummary, workspaceRoot) {
  if (!paramsSummary) return null;
  const s = paramsSummary.trim();
  // Whole string looks like a path
  if (/^[~./]?[\w./\-]+\.\w+$/.test(s)) {
    let p = s.replace(/^~/, process.env.HOME || "");
    if (!path.isAbsolute(p) && workspaceRoot) p = path.join(workspaceRoot, p);
    return p;
  }
  // Extract path-like fragment from description
  const m = s.match(/(?:^|[\s"':`])([~./]?(?:[\w.-]+\/)+[\w.-]+\.\w{1,12})/);
  if (m) {
    let p = m[1].replace(/^~/, process.env.HOME || "");
    if (!path.isAbsolute(p) && workspaceRoot) p = path.join(workspaceRoot, p);
    return p;
  }
  return null;
}

const PROVIDER_LABELS = {
  copilot:    "Microsoft Copilot",
  copilot365: "Microsoft 365 Copilot",
  chatgpt:    "ChatGPT",
  gemini:     "Google Gemini",
  deepseek:   "DeepSeek",
  grok:       "xAI Grok",
};

let sidebarProvider = null;
let agentSession = null;
let logger = null;
let selectedProviders = [];
let workspaceRoot = null;
let extensionCtx = null;

function activate(context) {
  extensionCtx = context;
  logger = new SessionLogger(context.extensionPath);

  sidebarProvider = new DevAgentViewProvider(context, handleSidebarMessage);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DevAgentViewProvider.viewType,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand("devAgent.start", () => openChatPanel()),
    vscode.commands.registerCommand("devAgent.ask", async () => {
      openChatPanel();
      const text = await vscode.window.showInputBox({ prompt: "Ask Dev Agent" });
      if (text) handleWebviewMessage({ type: "start_task", prompt: text });
    }),
    vscode.commands.registerCommand("devAgent.stop", () => agentSession?.stop()),
  );
}

function openChatPanel() {
  DevAgentPanel.createOrReveal(extensionCtx, handleWebviewMessage);
}

function handleSidebarMessage(msg) {
  if (msg.type === "open_panel") openChatPanel();
}

async function handleWebviewMessage(msg) {
  const panel = DevAgentPanel.currentPanel;

  switch (msg.type) {

    case "check_bridge": {
      const running = await bridge.isRunning();
      if (running) {
        const label = selectedProviders.map((id) => PROVIDER_LABELS[id] ?? id).join(", ") || "bridge";
        panel?.postMessage({ type: "bridge_ready", providerLabel: label, alreadyRunning: true });
        // If workspace is already chosen, skip straight to chat
        if (workspaceRoot) {
          panel?.postMessage({
            type: "workspace_confirmed",
            name: path.basename(workspaceRoot),
            path: workspaceRoot,
          });
        }
      }
      break;
    }

    case "launch_bridge": {
      selectedProviders = msg.providers ?? [];
      bridge.launch(selectedProviders);

      panel?.postMessage({
        type: "bridge_starting",
        providers: selectedProviders.map((id) => ({ id, label: PROVIDER_LABELS[id] ?? id })),
      });

      const ready = await bridge.waitForReady((state) => {
        panel?.postMessage({ type: "setup_state", state });
      });

      if (ready) {
        const label = selectedProviders.map((id) => PROVIDER_LABELS[id] ?? id).join(", ") || "bridge";
        panel?.postMessage({ type: "bridge_ready", providerLabel: label });
      } else {
        panel?.postMessage({
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
      if (folders.length === 1) {
        workspaceRoot = folders[0].path;
        panel?.postMessage({ type: "workspace_confirmed", name: folders[0].name, path: folders[0].path });
      } else {
        panel?.postMessage({ type: "workspaces", folders });
      }
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
        panel?.postMessage({ type: "folder_chosen", folder: { name: path.basename(p), path: p } });
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
        panel?.postMessage({ type: "folder_chosen", folder: { name: name.trim(), path: newPath } });
        await vscode.commands.executeCommand(
          "vscode.openFolder",
          vscode.Uri.file(newPath),
          { forceNewWindow: false },
        );
      } catch (err) {
        panel?.postMessage({ type: "system_message", text: `Could not create folder: ${err.message}`, level: "error" });
      }
      break;
    }

    case "confirm_workspace": {
      workspaceRoot = msg.path;
      panel?.postMessage({ type: "workspace_confirmed", name: msg.name, path: msg.path });
      break;
    }

    // ── Chat ─────────────────────────────────────────────────────────────────

    case "open_file": {
      if (msg.path) {
        vscode.window.showTextDocument(vscode.Uri.file(msg.path)).catch(() => {});
      }
      break;
    }

    case "start_task": {
      if (agentSession?.isRunning()) {
        panel?.postMessage({ type: "system_message", text: "Already running.", level: "warn" });
        return;
      }
      const root = workspaceRoot
        ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        ?? process.cwd();
      const chosenProvider = msg.provider || selectedProviders[0] || "copilot";

      let lastWritePath = null;
      const broadcast = (e) => {
        panel?.postMessage(e);
        sidebarProvider?.postMessage(e);
        if (e.type === "tool_call_start" && isWriteTool(e.tool)) {
          lastWritePath = resolveToolPath(e.paramsSummary, root);
        } else if (e.type === "tool_call_start") {
          lastWritePath = null;
        }
        if (e.type === "tool_call_end" && !e.isError && lastWritePath) {
          try {
            const raw = fs.readFileSync(lastWritePath, "utf8");
            const truncated = raw.length > 8000;
            panel?.postMessage({
              type: "file_preview",
              filePath: lastWritePath,
              relPath: path.relative(root, lastWritePath),
              ext: path.extname(lastWritePath).slice(1),
              content: truncated ? raw.slice(0, 8000) : raw,
              truncated,
              lines: raw.split("\n").length,
            });
          } catch {}
          lastWritePath = null;
        }
      };

      agentSession = new AgentSession({
        workspaceRoot: root,
        prompt: msg.prompt,
        provider: chosenProvider,
        onEvent: broadcast,
        logger,
      });
      agentSession.run().catch((err) => {
        panel?.postMessage({ type: "system_message", text: `Error: ${err.message}`, level: "error" });
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
      panel?.postMessage({ type: "show_project_screen" });
      break;
  }
}

function deactivate() {
  agentSession?.stop();
  logger?.end();
}

module.exports = { activate, deactivate };
