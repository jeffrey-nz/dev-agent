const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

// ─── Sidebar widget ────────────────────────────────────────────────────────

class DevAgentViewProvider {
  static viewType = "devAgent.mainView";

  constructor(context, onMessage) {
    this._context = context;
    this._onMessage = onMessage;
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._buildSidebarHtml();
    webviewView.webview.onDidReceiveMessage(this._onMessage, null, this._context.subscriptions);
    webviewView.onDidDispose(() => { this._view = null; });
  }

  postMessage(msg) { this._view?.webview.postMessage(msg); }

  _buildSidebarHtml() {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:12px;
     color:var(--vscode-editor-foreground);
     background:var(--vscode-sideBar-background,var(--vscode-editor-background));
     height:100vh;display:flex;flex-direction:column;padding:0;overflow:hidden}
.sb-top{padding:16px 14px 12px;border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.2))}
.sb-brand{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.sb-brand-icon{font-size:18px;line-height:1}
.sb-brand-name{font-size:13px;font-weight:700;letter-spacing:-.2px}
.btn{background:var(--vscode-button-background);color:var(--vscode-button-foreground);
     border:none;border-radius:4px;padding:6px 12px;font:inherit;cursor:pointer;
     font-size:12px;width:100%;text-align:center;transition:background .12s}
.btn:hover{background:var(--vscode-button-hoverBackground)}
.sb-status{display:flex;align-items:center;gap:7px;padding:10px 14px 0}
.sb-dot{width:7px;height:7px;border-radius:50%;background:var(--vscode-descriptionForeground);opacity:.35;flex-shrink:0;transition:background .3s}
.sb-dot.running{background:#2ecc8a;opacity:1;animation:pulse .9s infinite}
.sb-dot.done{background:#4caf50;opacity:1}
.sb-dot.bridge-on{background:#2ecc8a;opacity:1}
.sb-dot.bridge-wait{background:#e5a100;opacity:1;animation:pulse 1.2s infinite}
.sb-dot.bridge-off{background:var(--vscode-descriptionForeground);opacity:.4}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.sb-phase{font-size:11px;color:var(--vscode-descriptionForeground);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-tool{font-size:10px;color:var(--vscode-descriptionForeground);
         opacity:.7;padding:2px 14px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
         display:none}
.sb-section{padding:8px 14px 4px}
.sb-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
          color:var(--vscode-descriptionForeground);margin-bottom:4px}
.sb-value{font-size:11px;color:var(--vscode-editor-foreground);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-sub{font-size:10px;color:var(--vscode-descriptionForeground);
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
hr{border:none;border-top:1px solid var(--vscode-panel-border,rgba(128,128,128,.2));margin:8px 0}
</style></head><body>
<div class="sb-top">
  <div class="sb-brand"><span class="sb-brand-icon">🤖</span><span class="sb-brand-name">Dev Agent</span></div>
  <button class="btn" id="o">Open Chat ↗</button>
</div>
<div class="sb-status">
  <div class="sb-dot bridge-off" id="bridgedot"></div>
  <span class="sb-phase" id="bridgephase" style="color:var(--vscode-descriptionForeground)">Connecting…</span>
</div>
<hr/>
<div class="sb-status" style="padding-top:8px">
  <div class="sb-dot" id="dot"></div>
  <span class="sb-phase" id="phase">Idle</span>
</div>
<div class="sb-tool" id="tool"></div>
<hr/>
<div class="sb-section">
  <div class="sb-label">Project</div>
  <div class="sb-value" id="proj">—</div>
</div>
<div class="sb-section">
  <div class="sb-label">Provider</div>
  <div class="sb-value" id="prov">—</div>
</div>
<script>
const v = acquireVsCodeApi();
document.getElementById('o').onclick = () => v.postMessage({type:'open_panel'});
const PC = {PLANNING:'#7c6af7',ORCHESTRATING:'#7c6af7',RESEARCHING:'#4da6ff',
            SCOPING:'#4da6ff',EXECUTION:'#2ecc8a',WRITING:'#2ecc8a',
            VERIFYING:'#e5a100',REVIEWING:'#e5a100',DEBUGGING:'#e54545'};
const dot=document.getElementById('dot'), phase=document.getElementById('phase'),
      tool=document.getElementById('tool');
const bdot=document.getElementById('bridgedot'), bphase=document.getElementById('bridgephase');
window.addEventListener('message', e => {
  const m = e.data;
  if (m.type === 'bridge_ready') {
    bdot.className = 'sb-dot bridge-on';
    bphase.textContent = 'Bridge: ' + (m.providerLabel || 'Connected');
    bphase.style.color = '#2ecc8a';
    document.getElementById('prov').textContent = m.providerLabel || '—';
  }
  if (m.type === 'bridge_offline') {
    bdot.className = 'sb-dot bridge-off';
    bphase.textContent = 'Bridge offline';
    bphase.style.color = '';
  }
  if (m.type === 'bridge_starting') {
    bdot.className = 'sb-dot bridge-wait';
    bphase.textContent = 'Bridge starting…';
    bphase.style.color = '#e5a100';
  }
  if (m.type === 'phase_change') {
    dot.className = 'sb-dot running';
    phase.textContent = m.phase || 'Running';
    phase.style.color = PC[m.phase] || '';
  }
  if (m.type === 'tool_call_start' && m.tool) {
    tool.style.display = 'block';
    tool.textContent = '⚙ ' + (m.paramsSummary ? m.paramsSummary.slice(0,40) : m.tool);
  }
  if (m.type === 'tool_call_end') { tool.style.display = 'none'; }
  if (m.type === 'session_end' || m.type === 'task_complete') {
    dot.className = 'sb-dot done'; phase.textContent = 'Done'; phase.style.color = '#4caf50';
    tool.style.display = 'none';
    setTimeout(() => { dot.className = 'sb-dot'; phase.textContent = 'Idle'; phase.style.color = ''; }, 5000);
  }
  if (m.type === 'workspace_confirmed') document.getElementById('proj').textContent = m.name || '—';
});
</script></body></html>`;
  }
}

// ─── Main panel ────────────────────────────────────────────────────────────

class DevAgentPanel {
  static currentPanel = null;
  static initialState = { bridgeReady: false, bridgePort: 3333 };

  static revive(context, webviewPanel, onMessage) {
    DevAgentPanel.currentPanel = new DevAgentPanel(context, webviewPanel, onMessage);
    return DevAgentPanel.currentPanel;
  }

  static createOrReveal(context, onMessage) {
    if (DevAgentPanel.currentPanel) {
      DevAgentPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return { panel: DevAgentPanel.currentPanel, isNew: false };
    }
    const panel = vscode.window.createWebviewPanel(
      "devAgent.chat", "Dev Agent", vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      },
    );
    DevAgentPanel.currentPanel = new DevAgentPanel(context, panel, onMessage);
    return { panel: DevAgentPanel.currentPanel, isNew: true };
  }

  constructor(context, panel, onMessage) {
    this._context = context;
    this._panel = panel;
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    };
    panel.webview.html = this._buildHtml();
    panel.webview.onDidReceiveMessage((msg) => onMessage(msg, this), null, context.subscriptions);
    panel.onDidDispose(() => { DevAgentPanel.currentPanel = null; }, null, context.subscriptions);
  }

  postMessage(msg) { this._panel?.webview.postMessage(msg); }
  reveal() { this._panel?.reveal(vscode.ViewColumn.One); }

  _buildHtml() {
    const initJson = JSON.stringify(DevAgentPanel.initialState);
    const webview = this._panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'panel-webview.js')
    );
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src ${webview.cspSource}; img-src data: blob:; connect-src http://localhost:*;`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Dev Agent</title>
<script type="application/json" id="init-data">${initJson}</script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --r:6px;
  --fg:var(--vscode-editor-foreground);
  --bg:var(--vscode-editor-background);
  --bd:var(--vscode-panel-border,var(--vscode-widget-border,rgba(128,128,128,.2)));
  --mu:var(--vscode-descriptionForeground);
  --in-bg:var(--vscode-input-background);
  --in-fg:var(--vscode-input-foreground);
  --in-bd:var(--vscode-input-border,var(--bd));
  --btn:var(--vscode-button-background);
  --btn-fg:var(--vscode-button-foreground);
  --btn-h:var(--vscode-button-hoverBackground);
  --foc:var(--vscode-focusBorder);
  --hov:var(--vscode-list-hoverBackground);
  --err:var(--vscode-errorForeground);
  --cp:#7c6af7;--cr:#4da6ff;--ce:#2ecc8a;--cv:#e5a100;--cd:#e54545;--ck:#4caf50;
}
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--fg);
     background:var(--bg);height:100vh;display:flex;flex-direction:column;overflow:hidden}

/* ── shared ── */
.hidden{display:none!important}
button{border:none;border-radius:var(--r);cursor:pointer;font:inherit;transition:background .12s,opacity .14s}
.btn-p{background:var(--btn);color:var(--btn-fg);padding:8px 18px}
.btn-p:hover{background:var(--btn-h)}
.btn-p:disabled{opacity:.45;cursor:not-allowed}
.btn-g{background:transparent;color:var(--mu);border:1px solid var(--bd);font-size:12px;padding:6px 12px}
.btn-g:hover{background:var(--hov);color:var(--fg)}
.btn-d{background:transparent;color:var(--err);border:1px solid var(--err);padding:7px 14px}
.btn-d:hover{background:color-mix(in srgb,var(--err) 10%,transparent)}

/* ── wizard step indicator ── */
.wizard{display:flex;align-items:center;justify-content:center;gap:0;margin-bottom:28px}
.wz-step{display:flex;flex-direction:column;align-items:center;gap:5px}
.wz-dot{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;
        font-size:11px;font-weight:700;border:2px solid var(--bd);background:var(--bg);
        color:var(--mu);transition:all .25s}
.wz-label{font-size:10px;font-weight:600;color:var(--mu);text-transform:uppercase;
          letter-spacing:.06em;white-space:nowrap}
.wz-step.active .wz-dot{border-color:var(--foc);background:color-mix(in srgb,var(--foc) 14%,transparent);
                         color:var(--foc);box-shadow:0 0 0 3px color-mix(in srgb,var(--foc) 12%,transparent)}
.wz-step.active .wz-label{color:var(--foc);font-weight:700}
.wz-step.done .wz-dot{border-color:var(--ck);background:var(--ck);color:#fff}
.wz-step.done .wz-label{color:var(--ck)}
.wz-line{flex:1;height:2px;background:var(--bd);min-width:32px;max-width:60px;margin:0 4px;
         align-self:flex-start;margin-top:11px;transition:background .25s}
.wz-line.done{background:var(--ck)}

/* ── screen 1: connect ── */
#scr-connect{flex:1;display:flex;flex-direction:column;align-items:center;
             justify-content:center;padding:40px 24px}
.cnc-wrap{width:100%;max-width:380px;text-align:center;display:flex;
          flex-direction:column;align-items:center}
.cnc-logo{font-size:40px;margin-bottom:14px}
.cnc-title{font-size:22px;font-weight:700;margin-bottom:32px;letter-spacing:-.4px}
.cnc-spinner{width:30px;height:30px;border:3px solid var(--bd);border-top-color:var(--foc);
             border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 12px}
.cnc-hint{font-size:13px;color:var(--mu);margin-bottom:0}
.cnc-badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;
           padding:4px 12px;border-radius:20px;margin-bottom:18px}
.cnc-badge.offline{background:color-mix(in srgb,var(--mu) 10%,transparent);color:var(--mu)}
.cnc-badge.error{background:color-mix(in srgb,var(--err) 10%,transparent);color:var(--err)}
.cnc-desc{font-size:13px;color:var(--mu);line-height:1.6;margin-bottom:22px}
.cnc-main-btn{font-size:13px;padding:9px 26px;margin-bottom:18px}
.cnc-cmd{font-size:11px;font-family:var(--vscode-editor-font-family,monospace);
         color:var(--mu);background:color-mix(in srgb,var(--fg) 5%,transparent);
         border:1px solid var(--bd);padding:7px 12px;border-radius:var(--r);
         margin-bottom:20px;word-break:break-all;text-align:left;width:100%}
.cnc-poll{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--mu);
          justify-content:center;margin-top:4px}
.cnc-pulse{width:6px;height:6px;border-radius:50%;background:var(--mu);opacity:.4;
           animation:pulse .9s infinite;flex-shrink:0}

/* ── screen 2: confirm ── */
#scr-confirm{flex:1;display:flex;flex-direction:column;overflow:hidden}
.setup-wrap{flex:1;overflow-y:auto;padding:20px 32px;display:flex;flex-direction:column;
            gap:10px;max-width:600px;width:100%;margin:0 auto}
.setup-hdr{padding:28px 32px 0;max-width:600px;width:100%;margin:0 auto;flex-shrink:0}
.setup-hdr strong{display:block;font-size:15px;font-weight:700;margin-bottom:5px}
.setup-hdr p{font-size:13px;color:var(--mu);line-height:1.5}

/* ── provider selection screen ── */
#scr-provider{flex:1;display:flex;flex-direction:column;overflow:hidden}
.psel-wrap{flex:1;overflow-y:auto;padding:20px 32px;display:flex;flex-direction:column;
           gap:8px;max-width:600px;width:100%;margin:0 auto}
.psel-card{
  display:flex;align-items:center;gap:14px;
  padding:13px 18px;
  border:2px solid var(--bd);border-radius:8px;
  cursor:pointer;background:transparent;
  width:100%;text-align:left;font:inherit;color:var(--fg);
  transition:border-color .12s,background .12s,transform .08s;
}
.psel-card:hover{border-color:var(--foc);background:var(--hov);transform:translateX(2px)}
.psel-card-dot{width:11px;height:11px;border-radius:50%;flex-shrink:0;transition:box-shadow .15s}
.psel-card:hover .psel-card-dot{box-shadow:0 0 0 4px color-mix(in srgb,currentColor 20%,transparent)}
.psel-card-name{font-size:14px;font-weight:600;flex:1}
.psel-card-arr{font-size:13px;color:var(--mu);flex-shrink:0;opacity:.5}

/* bridge launch progress */
#bridge-launch{
  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:14px;padding:32px;text-align:center;
}
.bl-spinner{width:32px;height:32px;border:3px solid var(--bd);border-top-color:var(--foc);
            border-radius:50%;animation:spin .7s linear infinite}
.bl-stage{font-size:13px;font-weight:600;color:var(--fg)}
.bl-detail{font-size:12px;color:var(--mu);min-height:18px}
.bl-elapsed{font-size:11px;color:var(--mu);opacity:.5}
.bl-port{font-size:11px;font-family:var(--vscode-editor-font-family,monospace);
         color:var(--mu);opacity:.5}
#bridge-launch.error .bl-spinner{display:none}
#bridge-launch.error .bl-stage{color:var(--err)}
#bridge-launch.error::before{content:'⚠';font-size:28px}
.pcard{border:1px solid var(--bd);border-radius:var(--r);overflow:hidden}
.pcard-head{display:flex;align-items:center;gap:10px;padding:12px 16px}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;transition:background .2s}
.dot.waiting{background:var(--mu);opacity:.3}
.dot.pending{background:#e5a100}
.dot.confirmed{background:#4caf50}
.dot.skipped{background:var(--err);opacity:.6}
.pcard-name{font-size:13px;font-weight:500;flex:1}
.pcard-tag{font-size:12px;color:var(--mu)}
.pcard-body{padding:0 16px 14px;display:flex;flex-direction:column;gap:9px}
.det-y{font-size:12px;color:#4caf50}
.det-n{font-size:12px;color:#e5a100}
.conf-hint{font-size:12px;color:var(--mu);line-height:1.5}
.conf-btns{display:flex;gap:8px}
.btn-conf{background:color-mix(in srgb,#4caf50 14%,transparent);color:#4caf50;
          border:1px solid #4caf50;border-radius:var(--r);padding:5px 13px;
          font:inherit;cursor:pointer;font-size:12px;transition:background .12s}
.btn-conf:hover{background:color-mix(in srgb,#4caf50 24%,transparent)}
.btn-skip{background:transparent;color:var(--mu);border:1px solid var(--bd);
          border-radius:var(--r);padding:5px 11px;font:inherit;cursor:pointer;font-size:12px;
          transition:background .12s}
.btn-skip:hover{background:var(--hov)}

/* ── screen 3: project ── */
#scr-project{flex:1;display:flex;flex-direction:column;overflow:hidden}
.proj-wrap{flex:1;overflow-y:auto;padding:20px 32px;display:flex;flex-direction:column;
           gap:8px;max-width:600px;width:100%;margin:0 auto}
.proj-lbl{font-size:10px;color:var(--mu);text-transform:uppercase;
          letter-spacing:.07em;padding:4px 0 2px;font-weight:700}
.proj-card{display:flex;align-items:center;gap:12px;padding:12px 16px;
           border:1px solid var(--bd);border-radius:var(--r);
           cursor:pointer;transition:border-color .12s,background .12s}
.proj-card:hover{background:var(--hov);border-color:var(--foc)}
.pi{font-size:17px;flex-shrink:0}
.pinfo{flex:1;min-width:0}
.pname{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ppath{font-size:11px;color:var(--mu);white-space:nowrap;overflow:hidden;
       text-overflow:ellipsis;margin-top:2px;font-family:var(--vscode-editor-font-family,monospace)}
.parr{font-size:14px;color:var(--mu);flex-shrink:0}
.proj-acts{display:flex;gap:10px;padding:12px 32px 16px;border-top:1px solid var(--bd);
           max-width:600px;width:100%;margin:0 auto}
.btn-act{display:flex;align-items:center;gap:7px;padding:9px 14px;background:transparent;
         border:1px solid var(--bd);border-radius:var(--r);color:var(--fg);
         font:inherit;font-size:12px;cursor:pointer;transition:background .12s,border-color .12s;
         flex:1;justify-content:center}
.btn-act:hover{background:var(--hov);border-color:var(--foc)}

/* ══════════════════════════════════════
   SCREEN 4 — full-width chat
══════════════════════════════════════ */
#scr-chat{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative}

/* ── context header bar ── */
#chat-hdr{
  display:flex;align-items:center;justify-content:space-between;
  padding:0 14px;height:36px;flex-shrink:0;
  border-bottom:1px solid var(--bd);
  background:var(--vscode-sideBar-background,color-mix(in srgb,var(--bg) 94%,#000 6%));
  gap:8px;
}
.hdr-ctx{display:flex;align-items:center;gap:2px;flex:1;min-width:0;overflow:hidden}
.hdr-item{font-size:11px;color:var(--mu);white-space:nowrap;overflow:hidden;
          text-overflow:ellipsis;max-width:180px}
.hdr-sep{font-size:11px;color:var(--mu);opacity:.4;padding:0 5px;flex-shrink:0}
.hdr-btn{background:transparent;color:var(--mu);padding:3px 8px;border-radius:4px;
         font-size:11px;font-weight:500;border:none;cursor:pointer;white-space:nowrap;
         flex-shrink:0;transition:background .1s,color .1s}
.hdr-btn:hover{background:var(--hov);color:var(--fg)}
.hdr-btn.active{background:color-mix(in srgb,var(--foc) 12%,transparent);color:var(--fg)}
.hdr-actions{display:flex;align-items:center;gap:2px;flex-shrink:0}
.hdr-primary{background:var(--btn);color:var(--btn-fg);padding:3px 10px;border-radius:4px;
             font-size:11px;font-weight:600;border:none;cursor:pointer;
             transition:background .12s}
.hdr-primary:hover{background:var(--btn-h)}

/* ── session dropdown ── */
#sessions-drop{
  position:absolute;top:36px;left:0;width:240px;
  background:var(--vscode-sideBar-background,var(--bg));
  border:1px solid var(--bd);border-top:none;border-radius:0 0 6px 6px;
  box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:100;overflow:hidden;
  max-height:320px;overflow-y:auto;
}
#session-list{padding:4px}
.sb-empty{font-size:11px;color:var(--mu);text-align:center;padding:16px 8px;opacity:.55;font-style:italic}
.sitem{
  display:flex;align-items:flex-start;gap:7px;padding:7px 8px;border-radius:4px;
  cursor:pointer;background:transparent;border:1px solid transparent;
  width:100%;text-align:left;transition:background .1s;font:inherit;
}
.sitem:hover:not(.active):not(:disabled){background:var(--hov)}
.sitem.active{
  background:color-mix(in srgb,var(--foc) 12%,transparent);
  border-color:color-mix(in srgb,var(--foc) 22%,transparent);
}
.sitem:disabled{opacity:.45;cursor:not-allowed}
.s-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:4px}
.s-dot.running{background:var(--ce);animation:pulse .9s infinite}
.s-dot.done{background:var(--ck)}
.s-dot.error{background:var(--cd)}
.s-dot.stopped{background:var(--mu);opacity:.5}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.s-body{flex:1;min-width:0}
.s-prompt{font-size:12px;line-height:1.35;color:var(--fg);
          display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
          overflow:hidden;margin-bottom:2px}
.s-meta{font-size:10px;color:var(--mu);opacity:.8}

/* ── provider chip (in input footer) ── */
.inp-area{padding:10px 18px 13px;border-top:1px solid var(--bd);flex-shrink:0;position:relative}
.inp-row{display:flex;gap:8px;align-items:flex-end;margin-bottom:6px}
#prompt{flex:1;background:var(--in-bg);color:var(--in-fg);
        border:1px solid var(--in-bd);padding:9px 12px;
        border-radius:var(--r);font:inherit;font-size:13px;resize:none;
        line-height:1.5;min-height:42px;max-height:160px;overflow-y:auto}
#prompt:focus{outline:1px solid var(--foc);outline-offset:-1px}
.inp-foot{display:flex;align-items:center;gap:7px}
.prov-chip{
  display:flex;align-items:center;gap:5px;
  padding:4px 10px 4px 8px;border-radius:20px;
  border:1px solid var(--bd);
  background:transparent;color:var(--mu);
  font:inherit;font-size:11px;font-weight:500;
  cursor:pointer;white-space:nowrap;flex-shrink:0;
  transition:all .15s;
}
.prov-chip:hover{border-color:var(--foc);color:var(--fg)}
.prov-chip.connected{
  background:color-mix(in srgb,var(--prov-color,var(--ce)) 12%,transparent);
  border-color:color-mix(in srgb,var(--prov-color,var(--ce)) 40%,transparent);
  color:var(--fg);
}
.prov-chip-dot{width:7px;height:7px;border-radius:50%;background:var(--mu);opacity:.3;flex-shrink:0;transition:background .2s,opacity .2s}
.prov-chip.connected .prov-chip-dot{background:var(--prov-color,var(--ce));opacity:1}
.prov-chip-caret{font-size:9px;opacity:.5;transition:transform .15s}
.prov-chip.open .prov-chip-caret{transform:rotate(180deg)}
.inp-hint-txt{font-size:10px;color:var(--mu);opacity:.4;white-space:nowrap;flex-shrink:0}

/* ── provider dropdown (pops up from input) ── */
#prov-drop{
  position:absolute;bottom:calc(100% + 4px);left:18px;min-width:200px;
  background:var(--vscode-sideBar-background,var(--bg));
  border:1px solid var(--bd);border-radius:6px;
  box-shadow:0 -4px 20px rgba(0,0,0,.2);z-index:200;
  padding:4px;
}
.pi-hdr{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
        color:var(--mu);padding:6px 10px 4px}
.pi-item{
  display:flex;align-items:center;gap:9px;width:100%;text-align:left;
  padding:8px 10px;border-radius:4px;font:inherit;font-size:12px;
  background:transparent;border:none;cursor:pointer;color:var(--fg);
  transition:background .1s;
}
.pi-item:hover{background:var(--hov)}
.pi-item.active{background:color-mix(in srgb,var(--foc) 10%,transparent);color:var(--foc);font-weight:600}
.pi-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:var(--mu);opacity:.35}
.pi-item.active .pi-dot{opacity:1}
.pi-check{margin-left:auto;font-size:12px;color:var(--foc);opacity:0}
.pi-item.active .pi-check{opacity:1}

/* ── settings dropdown ── */
#settings-drop{
  position:absolute;top:36px;right:0;width:200px;
  background:var(--vscode-sideBar-background,var(--bg));
  border:1px solid var(--bd);border-top:none;border-radius:0 0 6px 6px;
  box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:100;
  padding:4px;
}
.drop-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;
           padding:7px 10px;border-radius:4px;font:inherit;font-size:12px;
           background:transparent;color:var(--fg);border:none;cursor:pointer;
           transition:background .1s}
.drop-item:hover{background:var(--hov)}
.drop-sep{height:1px;background:var(--bd);margin:4px 0}

/* ── main chat area ── */
#chat-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}

/* ── phase bar ── */
#phase-bar{
  flex-shrink:0;padding:8px 18px 7px;border-bottom:1px solid var(--bd);
  background:color-mix(in srgb,var(--bg) 93%,var(--foc) 7%);
}
.phase-steps{display:flex;align-items:flex-start;margin-bottom:8px;max-width:440px}
.phase-step{display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;position:relative}
.sdot{width:20px;height:20px;border-radius:50%;border:2px solid var(--bd);background:var(--bg);
      display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;
      transition:all .3s;z-index:1;flex-shrink:0}
.phase-step.done .sdot{background:var(--ck);border-color:var(--ck);color:#fff}
.phase-step.active .sdot{
  border-color:var(--sc);background:color-mix(in srgb,var(--sc) 15%,transparent);
  color:var(--sc);box-shadow:0 0 0 3px color-mix(in srgb,var(--sc) 15%,transparent)}
.slabel{font-size:9px;font-weight:500;color:var(--mu);text-align:center;white-space:nowrap}
.phase-step.active .slabel{color:var(--sc);font-weight:700}
.phase-step.done .slabel{color:var(--ck)}
.sline{flex:1;height:2px;background:var(--bd);margin-top:9px;transition:background .4s}
.sline.done{background:var(--ck)}
.phase-status{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--mu)}
.spinner{display:inline-block;width:11px;height:11px;border:2px solid var(--bd);
         border-top-color:var(--foc);border-radius:50%;animation:spin .65s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}
#phase-lbl{flex:1}
.tool-chip{display:none;align-items:center;gap:4px;padding:2px 8px;
           background:var(--hov);border-radius:20px;font-size:11px;color:var(--mu);
           max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}

/* ── messages ── */
#messages{flex:1;overflow-y:auto;padding:20px 28px;
          display:flex;flex-direction:column;gap:2px;scroll-behavior:smooth}

/* welcome */
#welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
         text-align:center;padding:40px 28px;color:var(--mu)}
.w-logo{font-size:36px;margin-bottom:14px}
.w-title{font-size:18px;font-weight:700;color:var(--fg);margin-bottom:7px;letter-spacing:-.3px}
.w-sub{font-size:12px;line-height:1.6;margin-bottom:26px;max-width:300px}
.w-examples{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;max-width:500px;width:100%}
.w-ex{text-align:left;padding:10px 13px;background:transparent;
      border:1px solid var(--bd);border-radius:var(--r);color:var(--mu);
      font:inherit;font-size:12px;cursor:pointer;line-height:1.4;
      transition:border-color .12s,background .12s,color .12s}
.w-ex:hover{background:var(--hov);border-color:var(--foc);color:var(--fg)}

/* timestamps */
.mtime{font-size:10px;color:var(--mu);opacity:.5;flex-shrink:0}
.msend{font-size:11px;font-weight:600;color:var(--mu)}

/* user bubble */
.msg-u{display:flex;flex-direction:column;align-items:flex-end;gap:4px;margin:16px 0 4px}
.muh{display:flex;align-items:center;gap:8px}
.mub{background:var(--btn);color:var(--btn-fg);padding:9px 14px;
     border-radius:14px 14px 3px 14px;font-size:13px;line-height:1.6;
     white-space:pre-wrap;word-break:break-word;max-width:78%}

/* agent message */
.msg-a{display:flex;align-items:flex-start;gap:11px;margin:18px 0 6px}
.av-a{width:26px;height:26px;border-radius:50%;
      background:color-mix(in srgb,var(--cp) 85%,#000 15%);
      color:#fff;display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;flex-shrink:0;margin-top:1px;letter-spacing:-.3px}
.mab-md{flex:1;font-size:13px;line-height:1.65;min-width:0;color:var(--fg)}

/* markdown */
.mab-md .md-p{margin:0 0 4px}
.mab-md .md-br{height:6px}
.mab-md h1{font-size:16px;font-weight:700;margin:14px 0 5px}
.mab-md h2{font-size:15px;font-weight:700;margin:12px 0 4px}
.mab-md h3{font-size:14px;font-weight:700;margin:10px 0 4px}
.mab-md h1.md-h:first-child,.mab-md h2.md-h:first-child,.mab-md h3.md-h:first-child{margin-top:0}
.mab-md ul,.mab-md ol{padding-left:22px;margin:4px 0 8px}
.mab-md ul{list-style-type:disc}
.mab-md ol{list-style-type:decimal}
.mab-md li{margin:3px 0;line-height:1.6}
.mab-md strong{font-weight:700}
.mab-md em{font-style:italic}
.ic{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;
    background:color-mix(in srgb,var(--fg) 10%,transparent);
    padding:1px 5px;border-radius:3px;word-break:break-all}

/* code blocks */
.cb{border:1px solid var(--bd);border-radius:6px;margin:8px 0;overflow:hidden;
    background:var(--vscode-textCodeBlock-background,color-mix(in srgb,var(--fg) 4%,var(--bg)))}
.cb-hdr{display:flex;align-items:center;justify-content:space-between;padding:5px 12px;
        border-bottom:1px solid var(--bd);
        background:color-mix(in srgb,var(--fg) 4%,transparent);min-height:28px}
.cb-lang{font-size:11px;color:var(--mu);font-family:var(--vscode-editor-font-family,monospace)}
.cb-copy{background:transparent;color:var(--mu);border:1px solid var(--bd);
         padding:2px 8px;border-radius:4px;font-size:11px;cursor:pointer;transition:background .12s,color .12s}
.cb-copy:hover{background:var(--hov);color:var(--fg)}
.cb-pre{overflow-x:auto;padding:12px 14px;margin:0}
.cb-pre code{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;
             white-space:pre;color:var(--fg);line-height:1.55}

/* file preview */
.fp-card{border:1px solid var(--bd);border-left:3px solid var(--ce);border-radius:6px;
         overflow:hidden;margin:10px 0;animation:tIn .16s ease;max-width:660px}
.fp-hdr{display:flex;align-items:center;gap:8px;padding:7px 12px;
        background:color-mix(in srgb,var(--ce) 6%,transparent);border-bottom:1px solid var(--bd)}
.fp-icon{font-size:14px;flex-shrink:0}
.fp-path{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;
         font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fp-meta{font-size:10px;color:var(--mu);flex-shrink:0;white-space:nowrap}
.fp-actions{display:flex;gap:5px;align-items:center;flex-shrink:0}
.fp-btn{background:transparent;color:var(--mu);border:1px solid var(--bd);
        padding:2px 8px;border-radius:4px;font-size:11px;cursor:pointer;transition:background .12s,color .12s}
.fp-btn:hover{background:var(--hov);color:var(--fg)}
.fp-body{overflow-x:auto;max-height:240px;overflow-y:auto}
.fp-pre{padding:10px 14px;margin:0}
.fp-pre code{font-family:var(--vscode-editor-font-family,monospace);font-size:11px;
             white-space:pre;color:var(--fg);line-height:1.5}
.fp-trunc{font-size:10px;color:var(--mu);padding:4px 14px 7px;font-style:italic;border-top:1px solid var(--bd)}

/* system / error */
.msg-sys{font-size:11px;color:var(--mu);font-style:italic;text-align:center;padding:2px 0;opacity:.65}
.msg-err{font-size:12px;color:var(--err);display:flex;align-items:center;gap:6px;
         padding:7px 12px;background:color-mix(in srgb,var(--err) 8%,transparent);
         border:1px solid color-mix(in srgb,var(--err) 22%,transparent);
         border-radius:var(--r);margin:3px 0}

/* phase dividers */
.pdiv{display:flex;align-items:center;gap:10px;margin:12px 0 4px;opacity:.8}
.pdiv.repeat{opacity:.3;margin:5px 0 2px}
.pdiv.repeat .pdlabel{font-size:9px;padding:1px 8px}
.pdline{flex:1;height:1px;background:var(--bd)}
.pdlabel{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;
         padding:2px 10px;border-radius:20px;border:1px solid transparent;white-space:nowrap}

/* tool cards */
.tcrd{display:flex;align-items:center;gap:7px;padding:5px 11px;border-radius:5px;
      border:1px solid var(--bd);border-left:3px solid var(--tc,var(--bd));
      background:color-mix(in srgb,var(--tc,var(--bd)) 5%,var(--bg));
      font-size:12px;max-width:440px;margin:2px 0;animation:tIn .16s ease}
@keyframes tIn{from{opacity:0;transform:translateX(-4px)}to{opacity:1;transform:none}}
.tcrd.pending{opacity:.6}
.tcrd.error{--tc:var(--err)}
.tc-ico{font-size:12px;flex-shrink:0}
.tc-name{font-size:10px;color:var(--mu);flex-shrink:0;min-width:46px;
         text-transform:uppercase;letter-spacing:.04em}
.tc-file{font-size:12px;font-family:var(--vscode-editor-font-family,monospace);
         flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-st{font-size:11px;flex-shrink:0;color:var(--mu)}

/* read-group */
.rg-card{border:1px solid var(--bd);border-left:3px solid var(--cr);border-radius:5px;
         background:color-mix(in srgb,var(--cr) 5%,var(--bg));
         font-size:12px;max-width:440px;margin:2px 0;animation:tIn .16s ease}
.rg-hdr{display:flex;align-items:center;gap:7px;padding:5px 11px;
        cursor:pointer;user-select:none;border-radius:5px}
.rg-hdr:hover{background:color-mix(in srgb,var(--cr) 8%,transparent)}
.rg-caret{font-size:10px;color:var(--mu);margin-left:auto;transition:transform .2s;flex-shrink:0}
.rg-card.open .rg-caret{transform:rotate(180deg)}
.rg-list{display:none;flex-direction:column;gap:1px;padding:2px 11px 8px 38px}
.rg-card.open .rg-list{display:flex}
.rg-item{font-size:11px;font-family:var(--vscode-editor-font-family,monospace);
         color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 0}

/* typing */
#typing{display:none;align-items:center;gap:9px;padding:5px 0;font-size:12px;color:var(--mu)}
.tdots{display:flex;gap:4px;align-items:center}
.tdots span{width:5px;height:5px;border-radius:50%;background:var(--mu);animation:tb .9s infinite}
.tdots span:nth-child(2){animation-delay:.18s}
.tdots span:nth-child(3){animation-delay:.36s}
@keyframes tb{0%,60%,100%{transform:translateY(0);opacity:.3}30%{transform:translateY(-5px);opacity:1}}

/* done banner */
.done-banner{display:flex;align-items:center;justify-content:center;gap:8px;
             padding:9px 16px;margin:8px 0;border-radius:var(--r);
             background:color-mix(in srgb,var(--ck) 10%,transparent);
             border:1px solid color-mix(in srgb,var(--ck) 26%,transparent);
             color:var(--ck);font-size:13px;font-weight:600}


</style>
</head>
<body>

<!-- ─── screen 1: connect ─── -->
<div id="scr-connect">
  <div class="cnc-wrap">
    <div class="cnc-logo">🤖</div>
    <div class="cnc-title">Dev Agent</div>

    <!-- connecting state (shown on load) -->
    <div id="cnc-connecting">
      <div class="cnc-spinner"></div>
      <div class="cnc-hint" id="cnc-debug">Connecting to bridge…</div>
    </div>

    <!-- waiting state (bridge found but still in setup) -->
    <div id="cnc-waiting" class="hidden">
      <div class="cnc-spinner"></div>
      <div class="cnc-hint">Bridge is starting up…</div>
      <div class="cnc-hint" style="margin-top:6px;font-size:11px;opacity:.7">Starting Chrome and connecting…</div>
    </div>

    <!-- offline state -->
    <div id="cnc-offline" class="hidden">
      <div class="cnc-badge offline">Bridge not running</div>
      <p class="cnc-desc">Run this in a terminal to start the bridge:</p>
      <div class="cnc-cmd" id="cnc-cmd">dev-agent</div>
      <div class="cnc-poll">
        <span class="cnc-pulse"></span>
        <span id="cnc-poll-lbl">Checking…</span>
      </div>
    </div>

    <!-- error state -->
    <div id="cnc-error" class="hidden">
      <div class="cnc-badge error">⚠ Bridge error</div>
      <p class="cnc-desc" id="cnc-err-txt"></p>
      <button class="btn-g" id="btn-cnc-retry" style="font-size:12px;padding:6px 16px">Try again</button>
    </div>
  </div>
</div>

<!-- ─── screen: provider selection (setup) ─── -->
<div id="scr-provider" class="hidden">
  <div class="setup-hdr">
    <div class="wizard">
      <div class="wz-step done"><div class="wz-dot">✓</div><div class="wz-label">Bridge</div></div>
      <div class="wz-line done"></div>
      <div class="wz-step active"><div class="wz-dot">2</div><div class="wz-label">AI</div></div>
      <div class="wz-line"></div>
      <div class="wz-step"><div class="wz-dot">3</div><div class="wz-label">Login</div></div>
      <div class="wz-line"></div>
      <div class="wz-step"><div class="wz-dot">4</div><div class="wz-label">Project</div></div>
    </div>
    <strong>Choose your AI</strong>
    <p>Select which AI to use for this session.</p>
  </div>
  <div class="psel-wrap" id="psel-list"></div>
</div>

<!-- ─── screen 2: browser confirmation ─── -->
<div id="scr-confirm" class="hidden">
  <div class="setup-hdr">
    <div class="wizard">
      <div class="wz-step done"><div class="wz-dot">✓</div><div class="wz-label">Bridge</div></div>
      <div class="wz-line done"></div>
      <div class="wz-step done"><div class="wz-dot">✓</div><div class="wz-label">AI</div></div>
      <div class="wz-line done"></div>
      <div class="wz-step active"><div class="wz-dot">3</div><div class="wz-label">Login</div></div>
      <div class="wz-line"></div>
      <div class="wz-step"><div class="wz-dot">4</div><div class="wz-label">Project</div></div>
    </div>
    <strong>Log in to Chrome</strong>
    <p>The browser panel on the right shows the AI site. Log in if needed, then confirm.</p>
  </div>
  <!-- shown while bridge process is starting -->
  <div id="bridge-launch">
    <div class="bl-spinner"></div>
    <div class="bl-stage" id="bl-stage">Launching browser process…</div>
    <div class="bl-detail" id="bl-detail">Opening Chrome and starting the automation server</div>
    <div class="bl-elapsed" id="bl-elapsed"></div>
    <div class="bl-port" id="bl-port"></div>
  </div>
  <!-- shown once providers need confirming -->
  <div class="setup-wrap hidden" id="pcard-list"></div>
</div>

<!-- ─── screen 3: project selection ─── -->
<div id="scr-project" class="hidden">
  <div class="setup-hdr">
    <div class="wizard">
      <div class="wz-step done"><div class="wz-dot">✓</div><div class="wz-label">Bridge</div></div>
      <div class="wz-line done"></div>
      <div class="wz-step done"><div class="wz-dot">✓</div><div class="wz-label">AI</div></div>
      <div class="wz-line done"></div>
      <div class="wz-step done"><div class="wz-dot">✓</div><div class="wz-label">Login</div></div>
      <div class="wz-line done"></div>
      <div class="wz-step active"><div class="wz-dot">4</div><div class="wz-label">Project</div></div>
    </div>
    <strong>Select a project</strong>
    <p>Choose a workspace folder to work in.</p>
  </div>
  <div class="proj-wrap" id="proj-body">
    <div class="proj-lbl">Loading…</div>
  </div>
  <div class="proj-acts">
    <button class="btn-act" id="btn-browse">📂&nbsp; Browse for folder…</button>
    <button class="btn-act" id="btn-new-folder">✨&nbsp; Create new folder…</button>
  </div>
</div>

<!-- ─── screen 4: full-width chat ─── -->
<div id="scr-chat" class="hidden">

  <!-- context header bar -->
  <div id="chat-hdr">
    <div class="hdr-ctx">
      <button class="hdr-btn" id="btn-sessions">Sessions ▾</button>
      <span class="hdr-sep">·</span>
      <span class="hdr-item" id="hdr-proj">—</span>
    </div>
    <div class="hdr-actions">
      <button class="hdr-primary" id="btn-new-chat">＋ New</button>
      <button class="hdr-btn" id="btn-settings" title="Settings">⋮</button>
    </div>
  </div>

  <!-- session dropdown -->
  <div id="sessions-drop" class="hidden">
    <div id="session-list"></div>
  </div>

  <!-- settings dropdown -->
  <div id="settings-drop" class="hidden">
    <button class="drop-item" id="btn-sb-proj">📂 Change project…</button>
    <button class="drop-item" id="btn-sb-prov">↩ Reconnect bridge</button>
  </div>

  <!-- main area -->
  <div id="chat-main">

    <!-- phase progress (hidden when idle) -->
    <div id="phase-bar" class="hidden">
      <div class="phase-steps" id="phase-steps"></div>
      <div class="phase-status">
        <span class="spinner"></span>
        <span id="phase-lbl">Starting…</span>
        <div class="tool-chip" id="tool-chip"></div>
      </div>
    </div>

    <!-- messages + welcome -->
    <div id="messages">
      <div id="welcome">
        <div class="w-logo">🤖</div>
        <div class="w-title">What can I help you build?</div>
        <div class="w-sub">Describe a task and the agent will plan, code, and verify it.</div>
        <div class="w-examples">
          <button class="w-ex" data-prompt="Add dark mode support to the app">Add dark mode support</button>
          <button class="w-ex" data-prompt="Write unit tests for the main module">Write unit tests</button>
          <button class="w-ex" data-prompt="Fix all TypeScript errors in the project">Fix TypeScript errors</button>
          <button class="w-ex" data-prompt="Refactor the API layer to use async/await">Refactor to async/await</button>
        </div>
      </div>
      <div id="typing">
        <div class="tdots"><span></span><span></span><span></span></div>
        <span>Thinking…</span>
      </div>
    </div>

    <!-- input -->
    <div class="inp-area">
      <div class="inp-row">
        <textarea id="prompt" rows="2" placeholder="Ask Dev Agent to do something…"></textarea>
      </div>
      <div class="inp-foot">
        <button id="btn-prov" class="prov-chip">
          <span class="prov-chip-dot"></span>
          <span id="prov-name">No provider</span>
          <span class="prov-chip-caret">▾</span>
        </button>
        <div style="flex:1"></div>
        <span class="inp-hint-txt">⏎ send</span>
        <button class="btn-p" id="btn-send">Send ▶</button>
        <button class="btn-d hidden" id="btn-stop">■ Stop</button>
      </div>
      <div id="prov-drop" class="hidden"></div>
    </div>

  </div><!-- #chat-main -->

</div><!-- #scr-chat -->

<script src="${scriptUri}"></script>
</body>
</html>`;
  }
}

module.exports = { DevAgentViewProvider, DevAgentPanel };
