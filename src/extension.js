const vscode = require("vscode");
const { AgentSession } = require("./agentSession");
const { DevAgentViewProvider } = require("./panel");

let provider = null;
let agentSession = null;

function activate(context) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  provider = new DevAgentViewProvider(context, (event) => {
    handlePanelEvent(event, workspaceRoot);
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DevAgentViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),

    vscode.commands.registerCommand("devAgent.start", () => {
      vscode.commands.executeCommand("devAgent.mainView.focus");
    }),

    vscode.commands.registerCommand("devAgent.ask", async () => {
      const prompt = await vscode.window.showInputBox({ prompt: "Ask Dev Agent" });
      if (prompt) {
        handlePanelEvent({ type: "start_task", prompt }, workspaceRoot);
      }
    }),

    vscode.commands.registerCommand("devAgent.stop", () => {
      agentSession?.stop();
    }),
  );
}

async function handlePanelEvent(event, workspaceRoot) {
  if (event.type === "start_task") {
    if (agentSession?.isRunning()) {
      provider?.postMessage({ type: "system_message", text: "Agent is already running.", level: "warn" });
      return;
    }

    agentSession = new AgentSession({
      workspaceRoot,
      prompt: event.prompt,
      provider: event.provider || "copilot",
      onEvent: (e) => provider?.postMessage(e),
    });

    try {
      await agentSession.run();
    } catch (err) {
      provider?.postMessage({ type: "system_message", text: `Error: ${err.message}`, level: "error" });
    }
  } else if (event.type === "stop") {
    agentSession?.stop();
  }
}

function deactivate() {
  agentSession?.stop();
}

module.exports = { activate, deactivate };
