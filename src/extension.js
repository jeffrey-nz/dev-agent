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
  if (/^[~./]?[\w./\-]+\.\w+$/.test(s)) {
    let p = s.replace(/^~/, process.env.HOME || "");
    if (!path.isAbsolute(p) && workspaceRoot) p = path.join(workspaceRoot, p);
    return p;
  }
  const m = s.match(/(?:^|[\s"':`])([~./]?(?:[\w.-]+\/)+[\w.-]+\.\w{1,12})/);
  if (m) {
    let p = m[1].replace(/^~/, process.env.HOME || "");
    if (!path.isAbsolute(p) && workspaceRoot) p = path.join(workspaceRoot, p);
    return p;
  }
  return null;
}

const PROVIDERS = [
  { id: "copilot",    label: "Microsoft Copilot",    description: "Microsoft's AI assistant" },
  { id: "copilot365", label: "Microsoft 365 Copilot", description: "Enterprise Microsoft 365" },
  { id: "chatgpt",   label: "ChatGPT",               description: "OpenAI's ChatGPT" },
  { id: "gemini",    label: "Google Gemini",          description: "Google's AI assistant" },
  { id: "deepseek",  label: "DeepSeek",               description: "DeepSeek AI" },
  { id: "grok",      label: "xAI Grok",               description: "xAI's Grok assistant" },
];

const PROVIDER_LABELS = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.label]));

let sidebarProvider = null;
let agentSession = null;
let logger = null;
let selectedProviders = [];
let workspaceRoot = null;
let extensionCtx = null;
let statusBar = null;

function activate(context) {
  extensionCtx = context;
  logger = new SessionLogger(context.extensionPath);

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "devAgent.start";
  statusBar.text = "$(robot) Dev Agent";
  statusBar.tooltip = "Open Dev Agent";
  statusBar.show();
  context.subscriptions.push(statusBar);

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
    vscode.commands.registerCommand("devAgent.stop", () => {
      agentSession?.stop();
      setStatusIdle();
    }),
    vscode.commands.registerCommand("devAgent.selectProvider", selectProviderQuickPick),
    vscode.window.registerWebviewPanelSerializer("devAgent.chat", {
      async deserializeWebviewPanel(webviewPanel) {
        DevAgentPanel.revive(extensionCtx, webviewPanel, handleWebviewMessage);
      },
    }),
  );
}

function openChatPanel() {
  DevAgentPanel.createOrReveal(extensionCtx, handleWebviewMessage);
}

function handleSidebarMessage(msg) {
  if (msg.type === "open_panel") openChatPanel();
}

// ── Status bar helpers ─────────────────────────────────────────────────────

const PHASE_ICONS = {
  PLANNING:      "$(list-ordered)",
  ORCHESTRATING: "$(settings-gear)",
  RESEARCHING:   "$(search)",
  SCOPING:       "$(map)",
  EXECUTION:     "$(zap)",
  WRITING:       "$(edit)",
  VERIFYING:     "$(beaker)",
  REVIEWING:     "$(eye)",
  DEBUGGING:     "$(bug)",
};

function setStatusPhase(phase) {
  if (!statusBar) return;
  const icon = PHASE_ICONS[phase] ?? "$(sync~spin)";
  const label = phase.charAt(0) + phase.slice(1).toLowerCase();
  statusBar.text = `${icon} Dev Agent · ${label}`;
  statusBar.backgroundColor = undefined;
}

function setStatusDone() {
  if (!statusBar) return;
  statusBar.text = "$(pass) Dev Agent · Done";
  statusBar.backgroundColor = undefined;
  setTimeout(setStatusIdle, 4000);
}

function setStatusIdle() {
  if (!statusBar) return;
  statusBar.text = "$(robot) Dev Agent";
  statusBar.backgroundColor = undefined;
}

// ── Provider QuickPick ─────────────────────────────────────────────────────

async function selectProviderQuickPick() {
  const picked = await vscode.window.showQuickPick(
    PROVIDERS.map((p) => ({ label: p.label, description: p.description, id: p.id })),
    { placeHolder: "Choose an AI provider", title: "Dev Agent: Select Provider" },
  );
  if (!picked) return;
  selectedProviders = [picked.id];
  DevAgentPanel.currentPanel?.postMessage({
    type: "provider_selected_quickpick",
    id: picked.id,
    label: picked.label,
  });
}

// ── Bridge launch helper ───────────────────────────────────────────────────

const SETUP_PHASE_LABELS = {
  waiting_for_server: "Launching browser process…",
  starting:           "Browser connected · authenticating…",
  waiting_confirm:    "Waiting for confirmation…",
  lost_connection:    "Lost connection · retrying…",
  ready:              "Ready",
};

async function watchBridge(panel) {
  let lastSetupState = null;
  const ready = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "Dev Agent", cancellable: false },
    async (progress) => bridge.waitForReady((state) => {
      lastSetupState = state;
      const label = SETUP_PHASE_LABELS[state?.phase] ?? state?.phase ?? "Starting…";
      const elapsed = state?.elapsed ? ` (${state.elapsed}s)` : "";
      progress.report({ message: label + elapsed });
      panel?.postMessage({ type: "setup_state", state });
    }),
  );
  if (ready) {
    const label = selectedProviders.map((id) => PROVIDER_LABELS[id] ?? id).join(", ") || "bridge";
    panel?.postMessage({ type: "bridge_ready", providerLabel: label });
  } else {
    const phase = lastSetupState?.phase;
    const elapsed = lastSetupState?.elapsed;
    let failText = `Bridge did not become ready after ${elapsed ?? "?"}s.`;
    if (!lastSetupState?.serverUp && phase !== "lost_connection") {
      failText += " The browser process may not have started.";
    } else if (phase === "lost_connection") {
      failText += " Lost connection to the browser process.";
    } else {
      failText += " Check the bridge terminal for errors.";
    }
    panel?.postMessage({ type: "bridge_failed", text: failText });
  }
}

async function doLaunchBridge(providers, panel) {
  bridge.launch(providers);
  panel?.postMessage({
    type: "bridge_starting",
    providers: providers.map((id) => ({ id, label: PROVIDER_LABELS[id] ?? id })),
  });
  await watchBridge(panel);
}

// ── Webview message handler ────────────────────────────────────────────────

async function handleWebviewMessage(msg) {
  const panel = DevAgentPanel.currentPanel;

  switch (msg.type) {

    case "check_bridge": {
      const status = await bridge.checkStatus();
      if (!status.running) {
        panel?.postMessage({ type: "bridge_offline" });
      } else if (status.phase === "ready") {
        const label = selectedProviders.map((id) => PROVIDER_LABELS[id] ?? id).join(", ") || "bridge";
        panel?.postMessage({ type: "bridge_ready", providerLabel: label, alreadyRunning: true });
        if (workspaceRoot) {
          panel?.postMessage({
            type: "workspace_confirmed",
            name: path.basename(workspaceRoot),
            path: workspaceRoot,
          });
        }
      } else {
        // Bridge is running but still in setup (e.g. reconnecting mid-setup)
        panel?.postMessage({ type: "bridge_starting", providers: [] });
        panel?.postMessage({ type: "setup_state", state: { ...status.data, port: status.port } });
        watchBridge(panel);
      }
      break;
    }

    case "get_bridge_info": {
      const { binPath } = bridge.checkInstall();
      panel?.postMessage({ type: "bridge_info", cmd: `node "${binPath}"` });
      break;
    }

    case "launch_bridge": {
      selectedProviders = msg.providers ?? [];
      await doLaunchBridge(selectedProviders, panel);
      break;
    }

    case "confirm_provider":
      await bridge.confirmProvider();
      break;

    case "skip_provider":
      await bridge.skipProvider();
      break;

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
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
        openLabel: "Select project folder", title: "Select project folder",
      });
      if (uris?.[0]) {
        const p = uris[0].fsPath;
        panel?.postMessage({ type: "folder_chosen", folder: { name: path.basename(p), path: p } });
      }
      break;
    }

    case "create_folder": {
      const name = await vscode.window.showInputBox({
        prompt: "New folder name", placeHolder: "my-project",
        validateInput: (v) => v.trim() && /^[^<>:"/\\|?*]+$/.test(v.trim()) ? null : "Enter a valid folder name",
      });
      if (!name) break;
      const parentUris = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
        openLabel: "Choose parent location", title: "Where should the new folder be created?",
      });
      if (!parentUris?.[0]) break;
      const newPath = path.join(parentUris[0].fsPath, name.trim());
      try {
        fs.mkdirSync(newPath, { recursive: true });
        panel?.postMessage({ type: "folder_chosen", folder: { name: name.trim(), path: newPath } });
        await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(newPath), { forceNewWindow: false });
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

    case "open_file": {
      if (msg.path) vscode.window.showTextDocument(vscode.Uri.file(msg.path)).catch(() => {});
      break;
    }

    case "start_task": {
      if (agentSession?.isRunning()) {
        panel?.postMessage({ type: "system_message", text: "Already running.", level: "warn" });
        return;
      }
      const root = workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
      const chosenProvider = msg.provider || selectedProviders[0] || "copilot";

      let lastWritePath = null;
      const broadcast = (e) => {
        panel?.postMessage(e);
        sidebarProvider?.postMessage(e);

        if (e.type === "phase_change") setStatusPhase(e.phase);
        if (e.type === "session_end" || e.type === "task_complete") setStatusDone();

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

      agentSession = new AgentSession({ workspaceRoot: root, prompt: msg.prompt, provider: chosenProvider, onEvent: broadcast, logger });
      agentSession.run().catch((err) => {
        setStatusIdle();
        panel?.postMessage({ type: "system_message", text: `Error: ${err.message}`, level: "error" });
      });
      break;
    }

    case "stop":
      agentSession?.stop();
      setStatusIdle();
      break;

    case "reset":
      agentSession?.stop();
      selectedProviders = [];
      workspaceRoot = null;
      setStatusIdle();
      break;

    case "change_project":
      panel?.postMessage({ type: "show_project_screen" });
      break;

    case "select_provider_qp":
      await selectProviderQuickPick();
      break;
  }
}

function deactivate() {
  agentSession?.stop();
  logger?.end();
}

module.exports = { activate, deactivate };
