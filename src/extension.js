const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const { AgentSession } = require("./agentSession");
const { DevAgentViewProvider, DevAgentPanel } = require("./panel");
const { SessionLogger } = require("./logger");
const { computeFileDiff } = require("./diffUtils");
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
  { id: "claude",    label: "Claude",                 description: "Anthropic's Claude" },
];

const PROVIDER_LABELS = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.label]));

let sidebarProvider = null;
let agentSession = null;
let logger = null;
let selectedProviders = [];
let workspaceRoot = null;
let extensionCtx = null;
let statusBar = null;

// ── Bridge status broadcast ───────────────────────────────────────────────
// The extension polls the bridge every 2 s and pushes status to all open
// panels. This is the primary connection mechanism — the webview's
// check_bridge message is kept as a fallback.

let _lastBridgeKey = null; // tracks last broadcast so we don't repeat
let _bridgeOfflineTicks = 0; // grace period: require 3 consecutive failures before offline broadcast
// Buffer session events so a reopened panel can replay the current session
let _sessionBuffer = null; // null = no session; array = session active or recently ended

async function broadcastBridgeStatus(status, targetPanel) {
  const panel = targetPanel ?? DevAgentPanel.currentPanel;

  if (!status.running) {
    const { binPath } = bridge.checkInstall();
    panel?.postMessage({ type: "bridge_offline" });
    panel?.postMessage({ type: "bridge_info", cmd: `node "${binPath}"` });
    sidebarProvider?.postMessage({ type: "bridge_offline" });
  } else if (status.phase === "ready") {
    // Sync selectedProviders from the bridge's actual active providers
    if (selectedProviders.length === 0) {
      const active = await bridge.getActiveProviders().catch(() => []);
      if (active.length > 0) selectedProviders = active;
    }
    const providerList = selectedProviders.map((id) => ({ id, label: PROVIDER_LABELS[id] ?? id }));
    const label = providerList.map((p) => p.label).join(", ") || "bridge";
    panel?.postMessage({ type: "bridge_ready", providerLabel: label, providers: providerList, alreadyRunning: true });
    sidebarProvider?.postMessage({ type: "bridge_ready", providerLabel: label });
    if (workspaceRoot) {
      panel?.postMessage({
        type: "workspace_confirmed",
        name: path.basename(workspaceRoot),
        path: workspaceRoot,
      });
    }
  } else {
    panel?.postMessage({ type: "bridge_starting", providers: [] });
    panel?.postMessage({ type: "setup_state", state: { ...status.data, port: status.port } });
    sidebarProvider?.postMessage({ type: "bridge_starting" });
  }
}

function startBridgeWatcher(context) {
  let autoOpened = false;

  async function poll() {
    const status = await bridge.checkStatus().catch(() => ({ running: false }));
    const key = status.running ? status.phase : "offline";
    // Always keep initialState fresh so the next panel creation is correct
    DevAgentPanel.initialState = {
      bridgeReady:     status.running && status.phase === "ready",
      bridgePort:      bridge.resolvePort(),
      bridgePhase:     status.running ? status.phase : "offline",
      availableProviders: status.running && status.data?.availableProviders || [],
    };

    // Auto-open panel as soon as the bridge HTTP server is up (any phase), not just ready.
    // The panel drives provider selection + login confirmation from there.
    const bridgeUp = status.running && ["waiting_provider_selection", "waiting_confirm", "ready"].includes(status.phase);
    if (!autoOpened && bridgeUp && !DevAgentPanel.currentPanel) {
      autoOpened = true;
      openChatPanel();
    }

    if (status.running) {
      _bridgeOfflineTicks = 0;
    } else {
      _bridgeOfflineTicks++;
      if (_bridgeOfflineTicks < 3) return; // ~6s grace period before declaring offline
    }

    if (key === _lastBridgeKey) return;
    _lastBridgeKey = key;
    broadcastBridgeStatus(status);
  }

  poll(); // check immediately on activation
  const timer = setInterval(poll, 2000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

// Send the bridge port to a panel so its direct fetch uses the right port.
function sendBridgePort(panel) {
  const port = bridge.resolvePort();
  panel?.postMessage({ type: "bridge_port", port });
}

// Call when a new panel is created so it gets status right away without
// waiting for the 2-second poller cycle.
function pushToPanelNow(panel) {
  sendBridgePort(panel);
  bridge.checkStatus()
    .then((status) => broadcastBridgeStatus(status, panel))
    .catch(() => broadcastBridgeStatus({ running: false }, panel));
}

async function activate(context) {
  extensionCtx = context;
  logger = new SessionLogger(context.extensionPath);

  // Pre-check bridge status so _buildHtml() can embed it — panels created
  // during activate (revive) will start in the correct screen immediately.
  try {
    const initStatus = await bridge.checkStatus();
    const isReady = initStatus.running && initStatus.phase === "ready";
    if (isReady && selectedProviders.length === 0) {
      const active = await bridge.getActiveProviders().catch(() => []);
      if (active.length > 0) selectedProviders = active;
    }
    DevAgentPanel.initialState = {
      bridgeReady: isReady,
      bridgePort:  bridge.resolvePort(),
      bridgeProviders: isReady ? selectedProviders.map((id) => ({ id, label: PROVIDER_LABELS[id] ?? id })) : [],
    };
  } catch {
    DevAgentPanel.initialState = { bridgeReady: false, bridgePort: bridge.resolvePort(), bridgeProviders: [] };
  }

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
    vscode.commands.registerCommand("devAgent.debugSnapshot", () => {
      const panel = DevAgentPanel.currentPanel;
      if (!panel) {
        vscode.window.showWarningMessage("Dev Agent panel is not open.");
        return;
      }
      panel.postMessage({ type: "debug_snapshot_request" });
    }),
    vscode.window.registerWebviewPanelSerializer("devAgent.chat", {
      async deserializeWebviewPanel(webviewPanel) {
        const instance = DevAgentPanel.revive(extensionCtx, webviewPanel, handleWebviewMessage);
        // Push bridge status immediately to the revived panel (don't wait for the poller)
        setTimeout(() => pushToPanelNow(instance), 400);
      },
    }),
  );

  // Start watching bridge status — proactively pushes to panels on change
  startBridgeWatcher(context);
}

async function openChatPanel() {
  try {
    const status = await bridge.checkStatus();
    const isReady = status.running && status.phase === "ready";
    if (isReady && selectedProviders.length === 0) {
      const active = await bridge.getActiveProviders().catch(() => []);
      if (active.length > 0) selectedProviders = active;
    }
    DevAgentPanel.initialState = {
      bridgeReady: isReady,
      bridgePort:  bridge.resolvePort(),
      bridgeProviders: isReady ? selectedProviders.map((id) => ({ id, label: PROVIDER_LABELS[id] ?? id })) : [],
    };
  } catch {
    DevAgentPanel.initialState = { bridgeReady: false, bridgePort: bridge.resolvePort(), bridgeProviders: [] };
  }
  DevAgentPanel.createOrReveal(extensionCtx, handleWebviewMessage);
  // Reset key so the watcher's next poll re-broadcasts bridge status to the new panel.
  _lastBridgeKey = null;
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
  const provLabel = selectedProviders.length > 0 ? ` · ${PROVIDER_LABELS[selectedProviders[0]] ?? selectedProviders[0]}` : '';
  statusBar.text = `${icon} Dev Agent · ${label}${provLabel}`;
  statusBar.backgroundColor = undefined;
}

function setStatusDone() {
  if (!statusBar) return;
  statusBar.text = "$(pass) Dev Agent · Done";
  statusBar.backgroundColor = undefined;
  setTimeout(setStatusIdle, 4000);

  // Notify if the panel is not visible (user may be working elsewhere)
  const panelVisible = DevAgentPanel.currentPanel?._panel?.visible ?? false;
  if (!panelVisible) {
    vscode.window.showInformationMessage(
      "Dev Agent: Task complete",
      "Open Chat"
    ).then(action => {
      if (action === "Open Chat") {
        DevAgentPanel.currentPanel?._panel?.reveal(vscode.ViewColumn.One);
      }
    });
  }
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

// ── Bridge launch helper (for VS Code-initiated launches) ──────────────────

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
    // Reset cache so the poller broadcasts the new ready state
    _lastBridgeKey = null;
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

// ── Webview message handler ────────────────────────────────────────────────
// senderPanel is the DevAgentPanel instance that sent the message (set in
// the per-panel closure registered in DevAgentPanel's constructor). Using
// the sender directly avoids the DevAgentPanel.currentPanel race condition
// where two panels can exist simultaneously with the wrong one as current.

async function handleWebviewMessage(msg, senderPanel) {
  // Use the sender if provided; fall back to currentPanel for legacy paths
  const panel = senderPanel ?? DevAgentPanel.currentPanel;

  switch (msg.type) {

    case "panel_ready": {
      // Webview signals it's loaded and ready — push current bridge status immediately
      pushToPanelNow(panel);
      // Replay buffered session so a reopened panel catches up
      if (_sessionBuffer && _sessionBuffer.length > 0) {
        panel?.postMessage({ type: "session_replay", messages: _sessionBuffer });
      }
      break;
    }

    case "check_bridge": {
      // Fallback manual check — primary connection now uses direct fetch
      pushToPanelNow(panel);
      break;
    }

    case "bridge_connected_direct": {
      // Webview connected to bridge via direct fetch — update sidebar/status bar
      const label = selectedProviders.map((id) => PROVIDER_LABELS[id] ?? id).join(", ") || "Connected";
      sidebarProvider?.postMessage({ type: "bridge_ready", providerLabel: label });
      _lastBridgeKey = "ready";
      break;
    }

    case "provider_chosen": {
      // Webview tells us which provider the user picked during setup
      if (msg.id) {
        selectedProviders = [msg.id];
        const label = PROVIDER_LABELS[msg.id] ?? msg.id;
        sidebarProvider?.postMessage({ type: "bridge_ready", providerLabel: label });
      }
      break;
    }

    case "get_bridge_info": {
      const { binPath } = bridge.checkInstall();
      panel?.postMessage({ type: "bridge_info", cmd: `node "${binPath}"` });
      break;
    }

    case "launch_bridge": {
      // VS Code-initiated launch (kept for fallback; primary flow is CLI)
      selectedProviders = msg.providers ?? [];
      bridge.launch(selectedProviders);
      panel?.postMessage({
        type: "bridge_starting",
        providers: selectedProviders.map((id) => ({ id, label: PROVIDER_LABELS[id] ?? id })),
      });
      _lastBridgeKey = null; // let poller detect when it's ready
      watchBridge(panel);
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
      if (!msg.path) break;
      // Resolve relative paths against the current workspace root
      let filePath = msg.path;
      if (!path.isAbsolute(filePath) && workspaceRoot) {
        filePath = path.join(workspaceRoot, filePath);
      }
      vscode.window.showTextDocument(vscode.Uri.file(filePath)).catch(() => {
        vscode.window.showWarningMessage(`Dev Agent: File not found — ${filePath}`);
      });
      break;
    }

    case "start_task": {
      if (agentSession?.isRunning()) {
        panel?.postMessage({ type: "system_message", text: "Already running.", level: "warn" });
        return;
      }
      const root = workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
      const chosenProvider = msg.provider || selectedProviders[0] || "copilot";

      // Unique tag so the webview can discard session_end events from aborted sessions
      const taskId = `task-${Date.now()}`;
      _sessionBuffer = [{ type: "task_started", taskId }];
      panel?.postMessage({ type: "task_started", taskId });

      let lastWritePath = null;
      let lastWriteOldContent = undefined; // content before the write (null = new file)
      const broadcast = (e) => {
        // Tag session_end/task_complete so stale events from aborted sessions are ignored
        const msg2 = (e.type === "session_end" || e.type === "task_complete")
          ? { ...e, _taskId: taskId }
          : e;
        if (_sessionBuffer !== null) _sessionBuffer.push(msg2);
        // Use currentPanel (not captured panel) so events reach a reopened panel
        (DevAgentPanel.currentPanel ?? panel)?.postMessage(msg2);
        sidebarProvider?.postMessage(e);

        if (e.type === "phase_change") setStatusPhase(e.phase);
        if (e.type === "session_end" || e.type === "task_complete") setStatusDone();

        if (e.type === "tool_call_start" && isWriteTool(e.tool)) {
          lastWritePath = resolveToolPath(e.paramsSummary, root);
          if (lastWritePath) {
            try { lastWriteOldContent = fs.readFileSync(lastWritePath, "utf8"); }
            catch { lastWriteOldContent = null; } // null = file didn't exist (new file)
          }
        } else if (e.type === "tool_call_start") {
          lastWritePath = null;
          lastWriteOldContent = undefined;
        }
        if (e.type === "tool_call_end" && !e.isError && lastWritePath) {
          try {
            const newContent = fs.readFileSync(lastWritePath, "utf8");
            const relPath = path.relative(root, lastWritePath);
            const ext = path.extname(lastWritePath).slice(1);
            const diff = computeFileDiff(lastWriteOldContent, newContent, lastWritePath, relPath, ext);
            const diffMsg = { type: "file_diff", ...diff };
            if (_sessionBuffer !== null) _sessionBuffer.push(diffMsg);
            (DevAgentPanel.currentPanel ?? panel)?.postMessage(diffMsg);
          } catch {}
          lastWritePath = null;
          lastWriteOldContent = undefined;
        }
      };

      agentSession = new AgentSession({ workspaceRoot: root, prompt: msg.prompt, provider: chosenProvider, onEvent: broadcast, logger, images: Array.isArray(msg.images) ? msg.images : [] });
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
      _lastBridgeKey = null; // force re-broadcast on next poll
      setStatusIdle();
      break;

    case "stop_bridge":
      agentSession?.stop();
      bridge.stopBridge();
      selectedProviders = [];
      workspaceRoot = null;
      _lastBridgeKey = null;
      setStatusIdle();
      break;

    case "debug_snapshot": {
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
      const snapPath = `/tmp/dev-agent-debug-${ts}.html`;
      try {
        // Write the HTML snapshot
        fs.writeFileSync(snapPath, msg.html || "<html><body>Empty snapshot</body></html>");
        // Write the state JSON alongside it
        if (msg.state) {
          fs.writeFileSync(snapPath.replace(".html", ".json"), JSON.stringify(msg.state, null, 2));
        }
        vscode.window.showInformationMessage(
          `Debug snapshot → ${snapPath}`,
          "Open in Browser",
        ).then((choice) => {
          if (choice === "Open in Browser") {
            vscode.env.openExternal(vscode.Uri.file(snapPath));
          }
        });
      } catch (err) {
        vscode.window.showErrorMessage(`Debug snapshot failed: ${err.message}`);
      }
      break;
    }

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
