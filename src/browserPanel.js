const vscode = require("vscode");

class BrowserViewPanel {
  static currentPanel = null;
  static viewType = "devAgent.browser";

  static createOrShow(context, port) {
    if (BrowserViewPanel.currentPanel) {
      BrowserViewPanel.currentPanel._panel.reveal(vscode.ViewColumn.Two, true);
      BrowserViewPanel.currentPanel._setPort(port);
      return BrowserViewPanel.currentPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      BrowserViewPanel.viewType,
      "Browser · Dev Agent",
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      },
    );
    BrowserViewPanel.currentPanel = new BrowserViewPanel(context, panel, port);
    return BrowserViewPanel.currentPanel;
  }

  static dispose() {
    BrowserViewPanel.currentPanel?.dispose();
  }

  constructor(context, panel, port) {
    this._context = context;
    this._panel = panel;
    this._port = port ?? 3333;
    panel.webview.html = this._buildHtml();
    panel.onDidDispose(() => {
      BrowserViewPanel.currentPanel = null;
    }, null, context.subscriptions);
  }

  _setPort(port) {
    if (port === this._port) return;
    this._port = port;
    this._panel.webview.postMessage({ type: "set_port", port });
  }

  postMessage(msg) {
    this._panel.webview.postMessage(msg);
  }

  dispose() {
    this._panel.dispose();
  }

  _buildHtml() {
    const webview = this._panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "dist", "browser-panel-webview.js"),
    );
    const csp = [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      `script-src ${webview.cspSource}`,
      "img-src data: blob:",
      "connect-src http://localhost:* ws://localhost:*",
    ].join("; ");
    const initJson = JSON.stringify({ port: this._port });
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Browser · Dev Agent</title>
<script type="application/json" id="init-data">${initJson}</script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100vh;overflow:hidden;
  background:var(--vscode-editor-background,#1e1e1e);
  color:var(--vscode-editor-foreground,#ccc);
  font-family:var(--vscode-font-family,sans-serif);font-size:12px;
  display:flex;flex-direction:column}
#toolbar{
  display:flex;align-items:center;gap:6px;
  padding:4px 8px;height:34px;flex-shrink:0;
  border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.2));
  background:var(--vscode-sideBar-background,var(--vscode-editor-background,#252526));
}
#btn-refresh{
  background:transparent;border:none;cursor:pointer;
  color:var(--vscode-editor-foreground,#ccc);font-size:16px;
  padding:2px 5px;border-radius:3px;line-height:1;flex-shrink:0;
}
#btn-refresh:hover{background:var(--vscode-list-hoverBackground,rgba(255,255,255,.07))}
#url-bar{
  flex:1;background:var(--vscode-input-background,#3c3c3c);
  color:var(--vscode-input-foreground,#ccc);
  border:1px solid var(--vscode-input-border,rgba(128,128,128,.3));
  padding:3px 8px;border-radius:4px;font:inherit;font-size:12px;min-width:0;
}
#fps{font-size:10px;color:var(--vscode-descriptionForeground,#999);opacity:.5;
     white-space:nowrap;min-width:42px;text-align:right;flex-shrink:0}
#canvas-wrap{
  position:relative;flex:1;overflow:hidden;
  display:flex;align-items:center;justify-content:center;
  background:#111;
}
#screen{display:block;image-rendering:auto}
#overlay{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:10px;
  background:rgba(0,0,0,.55);backdrop-filter:blur(2px);
  transition:opacity .2s;
}
#overlay.hidden{display:none}
.ov-spinner{
  width:22px;height:22px;
  border:2px solid rgba(255,255,255,.15);
  border-top-color:rgba(255,255,255,.7);
  border-radius:50%;
  animation:spin .7s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}
#overlay-msg{color:rgba(255,255,255,.7);font-size:12px;letter-spacing:.02em}
#hint-bar{
  position:absolute;bottom:0;left:0;right:0;z-index:10;
  display:flex;align-items:center;gap:8px;padding:9px 14px;
  background:rgba(0,80,200,.82);backdrop-filter:blur(4px);
  border-top:1px solid rgba(255,255,255,.12);
  font-size:11px;color:rgba(255,255,255,.92);letter-spacing:.01em;
  animation:slideUp .22s ease;
}
#hint-bar.hidden{display:none}
.hint-arrow{font-size:14px;animation:nudge .9s ease-in-out infinite alternate;flex-shrink:0}
@keyframes nudge{from{transform:translateX(-4px)}to{transform:translateX(0)}}
@keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:none;opacity:1}}
</style>
</head>
<body>
<div id="toolbar">
  <button id="btn-refresh" title="Reconnect">↺</button>
  <input id="url-bar" type="text" readonly placeholder="Waiting for browser…"/>
  <span id="fps"></span>
</div>
<div id="canvas-wrap">
  <canvas id="screen"></canvas>
  <div id="overlay">
    <div class="ov-spinner"></div>
    <span id="overlay-msg">Connecting…</span>
  </div>
  <div id="hint-bar" class="hidden">
    <span class="hint-arrow">←</span>
    <span id="hint-text">Log in here, then click Confirm Ready in the Dev Agent panel</span>
  </div>
</div>
<script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

module.exports = { BrowserViewPanel };
