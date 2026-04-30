const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

class DevAgentViewProvider {
  static viewType = "devAgent.mainView";

  constructor(context, onMessage) {
    this._context = context;
    this._onMessage = onMessage;
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this._context.extensionPath, "webview")),
      ],
    };

    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage(
      (msg) => this._onMessage(msg),
      null,
      this._context.subscriptions,
    );

    webviewView.onDidDispose(() => {
      this._view = null;
    });
  }

  postMessage(message) {
    this._view?.webview.postMessage(message);
  }

  reveal() {
    this._view?.show(true);
  }

  _getHtml() {
    const htmlPath = path.join(this._context.extensionPath, "webview", "index.html");
    if (fs.existsSync(htmlPath)) {
      return fs.readFileSync(htmlPath, "utf8");
    }
    return this._getFallbackHtml();
  }

  _getFallbackHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dev Agent</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); height: 100vh; display: flex; flex-direction: column; }
    #messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .message { padding: 8px 12px; border-radius: 6px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .message.agent { background: var(--vscode-editor-inactiveSelectionBackground); }
    .message.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; max-width: 80%; }
    .message.system { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .message.error { color: var(--vscode-errorForeground); }
    #input-row { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--vscode-panel-border); }
    #prompt { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 8px; border-radius: 4px; font-size: 13px; font-family: inherit; resize: none; }
    #send { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; }
    #send:hover { background: var(--vscode-button-hoverBackground); }
    #stop { background: var(--vscode-errorForeground); color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; display: none; }
  </style>
</head>
<body>
  <div id="messages"></div>
  <div id="input-row">
    <textarea id="prompt" rows="2" placeholder="Ask Dev Agent to do something..."></textarea>
    <button id="send">Send</button>
    <button id="stop">Stop</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const prompt = document.getElementById('prompt');
    const sendBtn = document.getElementById('send');
    const stopBtn = document.getElementById('stop');

    function addMessage(text, cls) {
      const div = document.createElement('div');
      div.className = 'message ' + cls;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    sendBtn.addEventListener('click', () => {
      const text = prompt.value.trim();
      if (!text) return;
      addMessage(text, 'user');
      vscode.postMessage({ type: 'start_task', prompt: text });
      prompt.value = '';
      sendBtn.style.display = 'none';
      stopBtn.style.display = '';
    });

    stopBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'stop' });
    });

    prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
    });

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg?.type) return;
      if (msg.type === 'log' || msg.type === 'message_complete') {
        addMessage(msg.text || msg.content || '', 'agent');
      } else if (msg.type === 'system_message') {
        addMessage(msg.text, msg.level === 'error' ? 'error' : 'system');
        if (msg.level !== 'error') { sendBtn.style.display = ''; stopBtn.style.display = 'none'; }
      } else if (msg.type === 'session_end' || msg.type === 'task_complete') {
        addMessage('✓ Done', 'system');
        sendBtn.style.display = '';
        stopBtn.style.display = 'none';
      }
    });
  </script>
</body>
</html>`;
  }
}

module.exports = { DevAgentViewProvider };
