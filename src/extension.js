const vscode = require("vscode");
const { AgentSession } = require("./agentSession");
const { DevAgentPanel } = require("./panel");

let panel = null;
let agentSession = null;

function activate(context) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  context.subscriptions.push(
    vscode.commands.registerCommand("devAgent.start", () => {
      if (!panel) {
        panel = new DevAgentPanel(context, workspaceRoot, (event) => {
          handlePanelEvent(event, workspaceRoot);
        });
        panel.onDispose(() => { panel = null; });
      } else {
        panel.reveal();
      }
    }),

    vscode.commands.registerCommand("devAgent.ask", async () => {
      const prompt = await vscode.window.showInputBox({ prompt: "Ask Dev Agent" });
      if (prompt && panel) {
        handlePanelEvent({ type: "start_task", prompt }, workspaceRoot);
      }
    }),

    vscode.commands.registerCommand("devAgent.stop", () => {
      agentSession?.stop();
    }),
  );

  // Auto-open the panel on startup
  vscode.commands.executeCommand("devAgent.start");
}

async function handlePanelEvent(event, workspaceRoot) {
  if (event.type === "start_task") {
    if (agentSession?.isRunning()) {
      panel?.postMessage({ type: "system_message", text: "Agent is already running.", level: "warn" });
      return;
    }

    agentSession = new AgentSession({
      workspaceRoot,
      prompt: event.prompt,
      provider: event.provider || "copilot",
      onEvent: (e) => panel?.postMessage(e),
    });

    try {
      await agentSession.run();
    } catch (err) {
      panel?.postMessage({ type: "system_message", text: `Error: ${err.message}`, level: "error" });
    }
  } else if (event.type === "stop") {
    agentSession?.stop();
  }
}

function deactivate() {
  agentSession?.stop();
  panel?.dispose();
}

module.exports = { activate, deactivate };
