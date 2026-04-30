const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

const PROVIDERS = [
  { id: "copilot",    label: "Microsoft Copilot" },
  { id: "copilot365", label: "Microsoft 365 Copilot" },
  { id: "chatgpt",   label: "ChatGPT" },
  { id: "gemini",    label: "Google Gemini" },
  { id: "deepseek",  label: "DeepSeek" },
  { id: "grok",      label: "xAI Grok" },
];

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

    webviewView.onDidDispose(() => { this._view = null; });
  }

  postMessage(message) {
    this._view?.webview.postMessage(message);
  }

  reveal() {
    this._view?.show(true);
  }

  _getHtml() {
    const htmlPath = path.join(this._context.extensionPath, "webview", "index.html");
    if (fs.existsSync(htmlPath)) return fs.readFileSync(htmlPath, "utf8");
    return this._buildHtml();
  }

  _buildHtml() {
    const providerCards = PROVIDERS.map((p) => `
      <label class="provider-card" data-id="${p.id}">
        <input type="checkbox" name="provider" value="${p.id}" checked />
        <span class="provider-name">${p.label}</span>
      </label>`).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dev Agent</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Setup screen ── */
    #view-setup {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 16px;
      gap: 14px;
      overflow-y: auto;
    }
    #view-setup h2 {
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    #view-setup p {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }

    .provider-grid {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .select-all-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0 6px;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 2px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
    }
    .select-all-row input { cursor: pointer; }

    .provider-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 5px;
      cursor: pointer;
      transition: border-color 0.1s, background 0.1s;
      user-select: none;
    }
    .provider-card:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .provider-card input[type="checkbox"] { cursor: pointer; }
    .provider-card.selected {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-editor-selectionBackground);
    }
    .provider-name { font-size: 12px; font-weight: 500; }

    .setup-actions { display: flex; flex-direction: column; gap: 8px; }
    #status-msg {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      min-height: 18px;
      text-align: center;
    }
    #status-msg.error { color: var(--vscode-errorForeground); }

    button {
      border: none;
      border-radius: 4px;
      padding: 8px 14px;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
    }
    #btn-launch {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    #btn-launch:hover { background: var(--vscode-button-hoverBackground); }
    #btn-launch:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ── Chat screen ── */
    #view-chat {
      display: none;
      flex: 1;
      flex-direction: column;
      overflow: hidden;
    }
    #view-chat.active { display: flex; }

    #chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    #provider-badge {
      font-weight: 600;
      color: var(--vscode-editor-foreground);
    }
    #btn-reset {
      background: none;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      padding: 2px 6px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 3px;
    }
    #btn-reset:hover { background: var(--vscode-list-hoverBackground); }

    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .message {
      padding: 7px 11px;
      border-radius: 6px;
      font-size: 12px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .message.agent { background: var(--vscode-editor-inactiveSelectionBackground); }
    .message.user {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      align-self: flex-end;
      max-width: 85%;
    }
    .message.system { color: var(--vscode-descriptionForeground); font-size: 11px; font-style: italic; }
    .message.error { color: var(--vscode-errorForeground); font-size: 11px; }
    .message.thinking { color: var(--vscode-descriptionForeground); font-size: 11px; font-style: italic; opacity: 0.75; }

    #input-row {
      display: flex;
      gap: 6px;
      padding: 10px 12px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    #prompt {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 7px 9px;
      border-radius: 4px;
      font-size: 12px;
      font-family: inherit;
      resize: none;
    }
    #prompt:focus { outline: 1px solid var(--vscode-focusBorder); }
    #btn-send {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      padding: 7px 13px;
    }
    #btn-send:hover { background: var(--vscode-button-hoverBackground); }
    #btn-stop {
      background: transparent;
      color: var(--vscode-errorForeground);
      border: 1px solid var(--vscode-errorForeground);
      padding: 7px 10px;
      display: none;
    }
    #btn-stop:hover { background: var(--vscode-inputValidation-errorBackground); }
  </style>
</head>
<body>

  <!-- Setup screen -->
  <div id="view-setup">
    <div>
      <h2>Dev Agent</h2>
      <p style="margin-top:6px">Select the AI providers to open in the browser, then launch the automation bridge.</p>
    </div>

    <div class="provider-grid">
      <label class="select-all-row">
        <input type="checkbox" id="chk-all" checked />
        All providers
      </label>
      ${providerCards}
    </div>

    <div class="setup-actions">
      <div id="status-msg"></div>
      <button id="btn-launch">Launch bridge</button>
    </div>
  </div>

  <!-- Chat screen -->
  <div id="view-chat">
    <div id="chat-header">
      <span>Provider: <span id="provider-badge">—</span></span>
      <button id="btn-reset">&#8592; Change providers</button>
    </div>
    <div id="messages"></div>
    <div id="input-row">
      <textarea id="prompt" rows="2" placeholder="Ask Dev Agent to do something…"></textarea>
      <button id="btn-send">Send</button>
      <button id="btn-stop">Stop</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    /* ── refs ── */
    const viewSetup  = document.getElementById('view-setup');
    const viewChat   = document.getElementById('view-chat');
    const chkAll     = document.getElementById('chk-all');
    const btnLaunch  = document.getElementById('btn-launch');
    const statusMsg  = document.getElementById('status-msg');
    const messages   = document.getElementById('messages');
    const prompt     = document.getElementById('prompt');
    const btnSend    = document.getElementById('btn-send');
    const btnStop    = document.getElementById('btn-stop');
    const btnReset   = document.getElementById('btn-reset');
    const provBadge  = document.getElementById('provider-badge');
    const provCards  = document.querySelectorAll('.provider-card');
    const provChecks = document.querySelectorAll('input[name="provider"]');

    /* ── provider selection ── */
    function syncAllCheck() {
      const any = [...provChecks].some(c => c.checked);
      const all = [...provChecks].every(c => c.checked);
      chkAll.checked = all;
      chkAll.indeterminate = any && !all;
    }
    function updateCardState(card) {
      card.classList.toggle('selected', card.querySelector('input').checked);
    }
    provCards.forEach(card => {
      updateCardState(card);
      card.addEventListener('click', () => {
        const chk = card.querySelector('input');
        chk.checked = !chk.checked;
        updateCardState(card);
        syncAllCheck();
      });
      card.querySelector('input').addEventListener('click', (e) => e.stopPropagation());
    });
    chkAll.addEventListener('change', () => {
      provChecks.forEach(c => { c.checked = chkAll.checked; });
      provCards.forEach(updateCardState);
    });

    function selectedProviders() {
      return [...provChecks].filter(c => c.checked).map(c => c.value);
    }

    /* ── launch ── */
    btnLaunch.addEventListener('click', () => {
      const providers = selectedProviders();
      if (!providers.length) {
        setStatus('Select at least one provider.', true);
        return;
      }
      btnLaunch.disabled = true;
      setStatus('Starting bridge…');
      vscode.postMessage({ type: 'launch_bridge', providers });
    });

    /* ── chat ── */
    function addMessage(text, cls) {
      if (!text) return;
      const div = document.createElement('div');
      div.className = 'message ' + cls;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    btnSend.addEventListener('click', () => {
      const text = prompt.value.trim();
      if (!text) return;
      addMessage(text, 'user');
      const provider = selectedProviders()[0] || 'copilot';
      vscode.postMessage({ type: 'start_task', prompt: text, provider });
      prompt.value = '';
      btnSend.style.display = 'none';
      btnStop.style.display = '';
    });

    btnStop.addEventListener('click', () => {
      vscode.postMessage({ type: 'stop' });
    });

    prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); btnSend.click(); }
    });

    btnReset.addEventListener('click', () => {
      showSetup();
      vscode.postMessage({ type: 'reset' });
    });

    /* ── screen transitions ── */
    function setStatus(text, isError = false) {
      statusMsg.textContent = text;
      statusMsg.className = isError ? 'error' : '';
    }

    function showSetup() {
      viewSetup.style.display = '';
      viewChat.classList.remove('active');
      btnLaunch.disabled = false;
      setStatus('');
    }

    function showChat(providerLabel) {
      viewSetup.style.display = 'none';
      viewChat.classList.add('active');
      provBadge.textContent = providerLabel || 'bridge';
    }

    /* ── incoming messages from extension ── */
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg?.type) return;

      switch (msg.type) {
        case 'bridge_already_running':
          showChat(msg.providerLabel || 'bridge (already running)');
          addMessage('Bridge is already running — ready.', 'system');
          break;

        case 'bridge_starting':
          setStatus(msg.text || 'Starting bridge…');
          break;

        case 'bridge_ready':
          showChat(msg.providerLabel || 'bridge');
          addMessage('Bridge ready — you can start a task.', 'system');
          break;

        case 'bridge_failed':
          btnLaunch.disabled = false;
          setStatus(msg.text || 'Bridge failed to start.', true);
          break;

        case 'log':
        case 'message_complete':
          addMessage(msg.text || msg.content || '', 'agent');
          break;

        case 'thinking':
          addMessage(msg.text || 'Thinking…', 'thinking');
          break;

        case 'system_message':
          addMessage(msg.text, msg.level === 'error' ? 'error' : 'system');
          if (msg.level !== 'error') {
            btnSend.style.display = '';
            btnStop.style.display = 'none';
          }
          break;

        case 'session_end':
        case 'task_complete':
          addMessage('Done.', 'system');
          btnSend.style.display = '';
          btnStop.style.display = 'none';
          break;
      }
    });

    /* ask extension for bridge status on load */
    vscode.postMessage({ type: 'check_bridge' });
  </script>
</body>
</html>`;
  }
}

module.exports = { DevAgentViewProvider };
