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
     height:100vh;display:flex;flex-direction:column;overflow:hidden}
.sb-top{padding:14px 14px 13px;border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.15))}
.sb-brand{display:flex;align-items:center;gap:7px;margin-bottom:11px}
.sb-mark{font-size:14px;line-height:1;opacity:.7;color:var(--vscode-focusBorder,#58a6ff)}
.sb-name{font-size:13px;font-weight:700;letter-spacing:-.3px}
.btn{
  background:var(--vscode-button-background);color:var(--vscode-button-foreground);
  border:none;border-radius:6px;padding:7px 12px;font:inherit;cursor:pointer;
  font-size:12px;width:100%;text-align:center;transition:opacity .12s;font-weight:500;
}
.btn:hover{opacity:.85}
.row{display:flex;align-items:center;gap:8px;padding:10px 14px 0}
.dot{width:7px;height:7px;border-radius:50%;background:var(--vscode-descriptionForeground);opacity:.2;flex-shrink:0;transition:all .3s}
.dot.on{background:#3fb950;opacity:1}
.dot.wait{background:#d29922;opacity:1;animation:p .9s infinite}
.dot.run{background:#58a6ff;opacity:1;animation:p .9s infinite}
.dot.done{background:#3fb950;opacity:1}
@keyframes p{0%,100%{opacity:1}50%{opacity:.2}}
.lbl{font-size:11px;color:var(--vscode-descriptionForeground);flex:1;
     white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tool-lbl{
  font-size:10px;color:var(--vscode-descriptionForeground);opacity:.55;
  padding:3px 14px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  font-family:var(--vscode-editor-font-family,monospace);display:none;
}
hr{border:none;border-top:1px solid var(--vscode-panel-border,rgba(128,128,128,.12));margin:9px 0}
.kv{padding:5px 14px}
.k{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
   color:var(--vscode-descriptionForeground);margin-bottom:3px;opacity:.7}
.v{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
</style></head><body>
<div class="sb-top">
  <div class="sb-brand"><span class="sb-mark">◉</span><span class="sb-name">Dev Agent</span></div>
  <button class="btn" id="o">Open panel →</button>
</div>
<div class="row"><div class="dot" id="bd"></div><span class="lbl" id="bl">Offline</span></div>
<div class="row" style="padding-top:6px"><div class="dot" id="d"></div><span class="lbl" id="p">Idle</span></div>
<div class="tool-lbl" id="t"></div>
<hr/>
<div class="kv"><div class="k">Project</div><div class="v" id="pr">—</div></div>
<div class="kv"><div class="k">Provider</div><div class="v" id="pv">—</div></div>
<script>
const v=acquireVsCodeApi();
document.getElementById('o').onclick=()=>v.postMessage({type:'open_panel'});
const bd=document.getElementById('bd'),bl=document.getElementById('bl');
const d=document.getElementById('d'),p=document.getElementById('p'),t=document.getElementById('t');
window.addEventListener('message',e=>{
  const m=e.data;
  if(m.type==='bridge_ready'){
    bd.className='dot on'; bl.textContent='Ready · '+(m.providerLabel||'');
    document.getElementById('pv').textContent=m.providerLabel||'—';
  }
  if(m.type==='bridge_offline'){bd.className='dot';bl.textContent='Offline';}
  if(m.type==='bridge_starting'){bd.className='dot wait';bl.textContent='Starting…';}
  if(m.type==='phase_change'){d.className='dot run';p.textContent=m.phase||'Running';}
  if(m.type==='tool_call_start'&&m.tool){
    t.style.display='block';
    t.textContent='↳ '+(m.paramsSummary?m.paramsSummary.slice(0,42):m.tool);
  }
  if(m.type==='tool_call_end'){t.style.display='none';}
  if(m.type==='session_end'||m.type==='task_complete'){
    d.className='dot done';p.textContent='Done';t.style.display='none';
    setTimeout(()=>{d.className='dot';p.textContent='Idle';},5000);
  }
  if(m.type==='workspace_confirmed')document.getElementById('pr').textContent=m.name||'—';
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
  --fg:var(--vscode-editor-foreground,#d4d4d4);
  --bg:var(--vscode-editor-background,#1e1e1e);
  --bd:var(--vscode-panel-border,rgba(128,128,128,.18));
  --mu:var(--vscode-descriptionForeground,#888);
  --hov:var(--vscode-list-hoverBackground,rgba(255,255,255,.06));
  --sel:var(--vscode-list-activeSelectionBackground,rgba(255,255,255,.08));
  --in-bg:var(--vscode-input-background,#2d2d2d);
  --in-fg:var(--vscode-input-foreground,#cccccc);
  --in-bd:var(--vscode-input-border,rgba(128,128,128,.25));
  --btn:var(--vscode-button-background,#0078d4);
  --btn-fg:var(--vscode-button-foreground,#fff);
  --btn-h:var(--vscode-button-hoverBackground,#1484d9);
  --foc:var(--vscode-focusBorder,#007fd4);
  --acc:var(--vscode-focusBorder,#58a6ff);
  --ok:#3fb950;
  --warn:#d29922;
  --err:var(--vscode-errorForeground,#f85149);
  --sidebar:var(--vscode-sideBar-background,#252526);
  --mono:var(--vscode-editor-font-family,'Menlo','Cascadia Code','Consolas',monospace);
  --r:6px;
  /* Phase colors */
  --cp:#7c6af7;--cr:#4da6ff;--ce:#2ecc8a;--cv:#e5a100;--cd:#e54545;--ck:#3fb950;
}
body{font-family:var(--vscode-font-family,sans-serif);font-size:13px;color:var(--fg);
     background:var(--bg);height:100vh;display:flex;flex-direction:column;overflow:hidden}

/* ── shared ─────────────────────────────────────────────────────────────── */
.hidden{display:none!important}
button{border:none;border-radius:var(--r);cursor:pointer;font:inherit;
       transition:background .1s,opacity .12s,color .1s}
a{color:var(--acc)}

/* ── setup screens shared ─────────────────────────────────────────────── */
.setup-screen{flex:1;display:flex;flex-direction:column;overflow:hidden}
.setup-hdr{padding:24px 24px 18px;flex-shrink:0;border-bottom:1px solid var(--bd)}
.sh-step{
  font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;
  color:var(--acc);margin-bottom:8px;opacity:.8;
  display:flex;align-items:center;gap:5px;
}
.sh-step-dot{width:5px;height:5px;border-radius:50%;background:var(--acc);opacity:.6}
.sh-title{font-size:17px;font-weight:700;margin-bottom:5px;letter-spacing:-.4px}
.sh-sub{font-size:12px;color:var(--mu);line-height:1.6}

/* ── connect screen ───────────────────────────────────────────────────── */
#scr-connect{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 24px}
.cnc-wrap{width:100%;max-width:340px;display:flex;flex-direction:column;gap:10px}
.cnc-mark{font-size:26px;margin-bottom:4px;color:var(--acc);opacity:.7;line-height:1}
.cnc-title{font-size:20px;font-weight:700;letter-spacing:-.4px;margin-bottom:16px}
.cnc-spinner{width:16px;height:16px;border:2px solid var(--bd);border-top-color:var(--mu);
             border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
.cnc-row{display:flex;align-items:center;gap:9px;color:var(--mu);font-size:12px}
.cnc-label{font-size:12px;color:var(--mu);margin-bottom:6px}
.cnc-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;
           padding:3px 10px;border-radius:20px;margin-bottom:12px;
           background:rgba(128,128,128,.12);color:var(--mu);border:1px solid var(--bd)}
.cnc-badge.err{background:color-mix(in srgb,var(--err) 10%,transparent);
               color:var(--err);border-color:color-mix(in srgb,var(--err) 30%,transparent)}
.cnc-cmd{font-family:var(--mono);font-size:12px;color:var(--mu);
         background:var(--in-bg);border:1px solid var(--bd);
         padding:8px 12px;border-radius:var(--r);margin-bottom:12px;
         display:flex;align-items:center;gap:8px;word-break:break-all}
.cnc-dollar{color:var(--ok);font-weight:700;flex-shrink:0}
.cnc-poll{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--mu)}
.cnc-pulse{width:6px;height:6px;border-radius:50%;background:var(--mu);opacity:.35;
           animation:pulse .9s infinite;flex-shrink:0}
.btn-outline{background:transparent;color:var(--mu);border:1px solid var(--bd);
             padding:6px 14px;font-size:12px;border-radius:var(--r)}
.btn-outline:hover{background:var(--hov);color:var(--fg)}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:.35}50%{opacity:.9}}

/* ── provider selection ───────────────────────────────────────────────── */
#scr-provider{flex:1;display:flex;flex-direction:column;overflow:hidden}
.psel-list{flex:1;overflow-y:auto;padding:10px 16px;display:flex;flex-direction:column;gap:6px}
.psel-card{
  display:flex;align-items:center;gap:12px;
  padding:12px 14px;width:100%;text-align:left;
  background:color-mix(in srgb,var(--fg) 3%,transparent);
  color:var(--fg);font:inherit;
  border:1px solid var(--bd);border-radius:8px;cursor:pointer;
  transition:background .12s,border-color .12s;
}
.psel-card:hover{
  background:var(--hov);
  border-color:color-mix(in srgb,var(--acc) 35%,transparent);
}
.psel-card-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.psel-card-name{font-size:13px;font-weight:500;flex:1}
.psel-card-arr{font-size:14px;color:var(--mu);opacity:.35}

/* ── bridge launch / confirm screen ──────────────────────────────────── */
#scr-confirm{flex:1;display:flex;flex-direction:column;overflow:hidden}
#bridge-launch{
  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:12px;padding:32px;text-align:center;
}
.bl-spinner{width:22px;height:22px;border:2px solid var(--bd);border-top-color:var(--mu);
            border-radius:50%;animation:spin .7s linear infinite}
.bl-stage{font-size:13px;font-weight:600;color:var(--fg)}
.bl-detail{font-size:12px;color:var(--mu)}
.bl-elapsed{font-size:11px;color:var(--mu);opacity:.5}
.bl-port{font-size:11px;font-family:var(--mono);color:var(--mu);opacity:.4}
#bridge-launch.error .bl-spinner{display:none}
#bridge-launch.error .bl-stage{color:var(--err)}
.setup-list{flex:1;overflow-y:auto;padding:12px 28px;display:flex;flex-direction:column;gap:10px}
.pcard{border:1px solid var(--bd);border-radius:var(--r);overflow:hidden}
.pcard-head{display:flex;align-items:center;gap:10px;padding:10px 14px}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;transition:background .2s}
.dot.waiting{background:var(--mu);opacity:.25}
.dot.pending{background:var(--warn)}
.dot.confirmed{background:var(--ok)}
.dot.skipped{background:var(--mu);opacity:.4}
.pcard-name{font-size:13px;font-weight:500;flex:1}
.pcard-tag{font-size:11px;color:var(--mu)}
.pcard-body{padding:0 14px 12px;display:flex;flex-direction:column;gap:8px}
.pcard-body.hidden{display:none}
.det-y{font-size:12px;color:var(--ok)}
.det-n{font-size:12px;color:var(--warn)}
.conf-hint{font-size:12px;color:var(--mu);line-height:1.5}
.conf-btns{display:flex;gap:8px}
.btn-conf{background:color-mix(in srgb,var(--ok) 12%,transparent);color:var(--ok);
          border:1px solid color-mix(in srgb,var(--ok) 35%,transparent);
          border-radius:var(--r);padding:5px 14px;font:inherit;cursor:pointer;font-size:12px}
.btn-conf:hover{background:color-mix(in srgb,var(--ok) 20%,transparent)}
.btn-skip{background:transparent;color:var(--mu);border:1px solid var(--bd);
          border-radius:var(--r);padding:5px 12px;font:inherit;cursor:pointer;font-size:12px}
.btn-skip:hover{background:var(--hov)}

/* ── project selection ────────────────────────────────────────────────── */
#scr-project{flex:1;display:flex;flex-direction:column;overflow:hidden}
.proj-list{flex:1;overflow-y:auto;padding:10px 16px;display:flex;flex-direction:column;gap:6px}
.proj-lbl{font-size:10px;color:var(--mu);text-transform:uppercase;
          letter-spacing:.07em;padding:4px 2px 6px;font-weight:700;opacity:.7}
.proj-card{
  display:flex;align-items:center;gap:12px;padding:11px 14px;
  cursor:pointer;transition:background .12s,border-color .12s;
  border:1px solid var(--bd);border-radius:8px;
  background:color-mix(in srgb,var(--fg) 3%,transparent);
}
.proj-card:hover{
  background:var(--hov);
  border-color:color-mix(in srgb,var(--acc) 35%,transparent);
}
.pinfo{flex:1;min-width:0}
.pname{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ppath{font-size:11px;color:var(--mu);white-space:nowrap;overflow:hidden;
       text-overflow:ellipsis;margin-top:3px;font-family:var(--mono);opacity:.7}
.parr{font-size:14px;color:var(--mu);opacity:.3}
.pi{font-size:15px;flex-shrink:0}
.proj-acts{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--bd);flex-shrink:0}
.btn-act{background:transparent;border:1px solid var(--bd);color:var(--mu);
         font:inherit;font-size:12px;cursor:pointer;padding:7px 14px;border-radius:7px;
         flex:1;transition:background .1s,color .1s,border-color .1s}
.btn-act:hover{background:var(--hov);color:var(--fg);border-color:var(--mu)}

/* ══════════════════════════════════════════════════════════════════════
   CHAT SCREEN
══════════════════════════════════════════════════════════════════════ */
#scr-chat{flex:1;display:flex;flex-direction:column;overflow:hidden}

/* ── header ─────────────────────────────────────────────────────────── */
#chat-hdr{
  display:grid;grid-template-columns:auto 1fr auto;align-items:center;
  padding:0 8px;height:40px;flex-shrink:0;
  border-bottom:1px solid var(--bd);
  background:var(--sidebar);
  position:relative;gap:4px;
}
.hdr-brand{display:flex;align-items:center;gap:6px;flex-shrink:0;padding:0 4px}
.hdr-logo{font-size:13px;color:var(--acc);opacity:.9;line-height:1;flex-shrink:0}
.hdr-name{font-size:12px;font-weight:700;letter-spacing:-.2px;color:var(--fg);opacity:.75;white-space:nowrap}
.hdr-divider{width:1px;height:14px;background:var(--bd);flex-shrink:0;margin:0 2px}
.hdr-left{display:flex;align-items:center;gap:2px;min-width:0;overflow:hidden}
.hdr-right{display:flex;align-items:center;gap:2px;flex-shrink:0}
.hdr-btn{
  background:transparent;color:var(--mu);
  padding:3px 7px;border-radius:var(--r);
  font-size:11px;font-weight:500;border:none;cursor:pointer;
  white-space:nowrap;flex-shrink:0;
  transition:background .1s,color .1s;
  display:flex;align-items:center;gap:4px;
  max-width:160px;overflow:hidden;
}
.hdr-btn:hover,.hdr-btn.active{background:var(--hov);color:var(--fg)}
.hdr-btn-proj{
  background:transparent;border:none;color:var(--mu);
  padding:3px 7px;border-radius:var(--r);cursor:pointer;
  font:inherit;font-size:11px;
  display:flex;align-items:center;gap:5px;
  min-width:0;overflow:hidden;
  transition:background .1s,color .1s;
}
.hdr-btn-proj:hover,.hdr-btn-proj.active{background:var(--hov);color:var(--fg)}
.hdr-proj{font-size:11px;color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.hdr-drop-arr{font-size:9px;opacity:.4;flex-shrink:0}
.hdr-session-badge{
  font-size:10px;font-weight:600;
  padding:0px 5px;border-radius:10px;
  background:color-mix(in srgb,var(--mu) 14%,transparent);
  color:var(--mu);flex-shrink:0;min-width:0;
}
.hdr-session-badge:empty{display:none}
.hdr-sep{font-size:11px;color:var(--mu);opacity:.2;padding:0 2px;flex-shrink:0}
.hdr-icon-btn{
  background:transparent;border:none;color:var(--mu);
  width:28px;height:28px;border-radius:var(--r);cursor:pointer;
  font-size:13px;display:flex;align-items:center;justify-content:center;
  transition:background .1s,color .1s;flex-shrink:0;
}
.hdr-icon-btn:hover{background:var(--hov);color:var(--fg)}
.hdr-icon-btn.active{background:color-mix(in srgb,var(--cp) 14%,transparent);color:var(--cp)}

/* ── notes drawer ───────────────────────────────────────────────────── */
#notes-drawer{
  position:absolute;top:0;right:0;bottom:0;width:260px;
  background:var(--sidebar);border-left:1px solid var(--bd);
  display:flex;flex-direction:column;z-index:50;
  transform:translateX(100%);transition:transform .18s ease;pointer-events:none;
}
#notes-drawer.open{transform:translateX(0);pointer-events:auto}
#notes-hdr{
  display:flex;align-items:center;padding:0 10px;height:36px;flex-shrink:0;
  border-bottom:1px solid var(--bd);gap:6px;
}
#notes-hdr-lbl{font-size:11px;font-weight:600;color:var(--mu);opacity:.75;flex:1;letter-spacing:.02em}
#notes-close{background:transparent;border:none;color:var(--mu);cursor:pointer;
             font-size:14px;padding:2px 5px;border-radius:4px;line-height:1;transition:background .1s}
#notes-close:hover{background:var(--hov);color:var(--fg)}
#notes-list{flex:1;overflow-y:auto;padding:8px 10px 16px;
            display:flex;flex-direction:column;gap:8px}
#notes-list::-webkit-scrollbar{width:3px}
#notes-list::-webkit-scrollbar-thumb{background:var(--bd);border-radius:2px}
#notes-empty{font-size:11px;color:var(--mu);opacity:.45;text-align:center;
             padding:28px 12px;font-style:italic}
.note-chip{
  border:1px solid var(--bd);border-radius:7px;overflow:hidden;
  animation:msgIn .14s ease;flex-shrink:0;
}
.note-chip.plan{border-left:2px solid var(--cp)}
.note-chip.review{border-left:2px solid var(--cv)}
.note-chip-hdr{
  display:flex;align-items:center;gap:6px;padding:5px 8px;cursor:pointer;
  user-select:none;transition:background .1s;
}
.note-chip.plan  .note-chip-hdr{background:color-mix(in srgb,var(--cp) 7%,transparent)}
.note-chip.review .note-chip-hdr{background:color-mix(in srgb,var(--cv) 8%,transparent)}
.note-chip.plan  .note-chip-hdr:hover{background:color-mix(in srgb,var(--cp) 12%,transparent)}
.note-chip.review .note-chip-hdr:hover{background:color-mix(in srgb,var(--cv) 13%,transparent)}
.note-chip.open .note-chip-hdr{border-bottom:1px solid var(--bd)}
.note-chip-icon{font-size:11px;flex-shrink:0}
.note-chip.plan  .note-chip-icon{color:var(--cp)}
.note-chip.review .note-chip-icon{color:var(--cv)}
.note-chip-label{font-size:10px;font-weight:700;flex:1;letter-spacing:.03em}
.note-chip.plan  .note-chip-label{color:var(--cp)}
.note-chip.review .note-chip-label{color:var(--cv)}
.note-chip-seq{font-size:9px;font-family:var(--mono);color:var(--mu);opacity:.4}
.note-chip-caret{font-size:8px;color:var(--mu);opacity:.4;transition:transform .15s;flex-shrink:0}
.note-chip.open .note-chip-caret{transform:rotate(180deg)}
.note-chip-body{display:none;padding:8px 10px;font-size:11px;line-height:1.6;
                color:var(--fg);overflow-x:auto;max-height:320px;overflow-y:auto}
.note-chip.open .note-chip-body{display:block}
.note-chip-body::-webkit-scrollbar{width:3px;height:3px}
.note-chip-body::-webkit-scrollbar-thumb{background:var(--bd);border-radius:2px}
#notes-badge{
  font-size:9px;font-weight:700;padding:1px 4px;border-radius:8px;
  background:color-mix(in srgb,var(--cp) 20%,transparent);color:var(--cp);
  min-width:14px;text-align:center;line-height:1.4;display:none;
}
#notes-badge.show{display:inline-block}

.hdr-new-btn{
  background:transparent;border:1px solid var(--bd);color:var(--mu);
  padding:3px 8px;border-radius:var(--r);cursor:pointer;
  font:inherit;font-size:11px;font-weight:600;
  display:flex;align-items:center;gap:4px;
  transition:background .1s,color .1s,border-color .1s;white-space:nowrap;
}
.hdr-new-btn:hover{background:var(--hov);color:var(--fg);border-color:var(--mu)}

/* ── dropdowns ───────────────────────────────────────────────────────── */
#sessions-drop{
  position:absolute;top:40px;left:0;width:270px;z-index:200;
  background:var(--sidebar);border:1px solid var(--bd);border-top:none;
  border-radius:0 0 8px 8px;box-shadow:0 12px 32px rgba(0,0,0,.3);
  max-height:320px;overflow-y:auto;
}
#session-list{padding:6px}
.sb-empty{font-size:11px;color:var(--mu);text-align:center;padding:20px 8px;opacity:.6;font-style:italic}
.sitem{
  display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:5px;
  cursor:pointer;background:transparent;border:1px solid transparent;
  width:100%;text-align:left;font:inherit;transition:background .1s;
}
.sitem:hover:not(.active):not(:disabled){background:var(--hov)}
.sitem.active{background:var(--sel);border-color:var(--bd)}
.sitem:disabled{opacity:.35;cursor:not-allowed}
.s-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:4px}
.s-dot.running{background:var(--acc);animation:pulse .9s infinite}
.s-dot.done{background:var(--ok)}
.s-dot.error{background:var(--err)}
.s-dot.stopped{background:var(--mu);opacity:.4}
.s-body{flex:1;min-width:0}
.s-prompt{font-size:12px;color:var(--fg);font-weight:500;
          display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
          overflow:hidden;line-height:1.4;margin-bottom:3px}
.s-meta{font-size:10px;color:var(--mu);opacity:.7}
#settings-drop{
  position:absolute;top:40px;right:0;width:200px;z-index:200;
  background:var(--sidebar);border:1px solid var(--bd);border-top:none;
  border-radius:0 0 8px 8px;box-shadow:0 12px 32px rgba(0,0,0,.3);
  padding:6px;
}
.drop-item{display:flex;align-items:center;width:100%;text-align:left;
           padding:7px 10px;border-radius:5px;font:inherit;font-size:12px;
           background:transparent;color:var(--fg);border:none;cursor:pointer;
           transition:background .1s;gap:7px}
.drop-item:hover{background:var(--hov)}
.drop-sep{height:1px;background:var(--bd);margin:4px 0}
.drop-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
             color:var(--mu);padding:6px 10px 2px;}

/* ── phase bar ────────────────────────────────────────────────────────── */
#phase-bar{
  flex-shrink:0;padding:0 12px;height:34px;border-bottom:1px solid var(--bd);
  display:flex;align-items:center;gap:8px;font-size:11px;color:var(--mu);
  background:color-mix(in srgb,var(--bg) 94%,var(--acc) 6%);
}
.ph-spinner{
  width:11px;height:11px;
  border:1.5px solid color-mix(in srgb,var(--acc) 25%,transparent);
  border-top-color:var(--acc);
  border-radius:50%;animation:spin .65s linear infinite;flex-shrink:0;opacity:.8;
}
#phase-lbl{font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.01em}
.phase-elapsed{font-family:var(--mono);font-size:10px;opacity:.35;margin-left:1px}
.tool-chip{
  display:none;align-items:center;font-family:var(--mono);font-size:10px;
  color:var(--mu);max-width:160px;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;flex-shrink:0;opacity:.7;
}
.phase-gap{flex:1}
#phase-stats{
  display:flex;align-items:center;gap:8px;flex-shrink:0;
  font-family:var(--mono);font-size:10px;color:var(--mu);opacity:.5;
}
.pstat{display:flex;align-items:center;gap:2px}
.pstat-val{font-weight:700}

/* ── session delta (lines added/removed total) ── */
.session-delta{display:flex;align-items:center;gap:3px;font-family:var(--mono);font-size:10px;flex-shrink:0}
.sd-add{color:var(--ok);font-weight:600}
.sd-rem{color:var(--err);font-weight:600}

/* ── browser context meter ── */
#ctx-meter{
  display:none;align-items:center;gap:5px;flex-shrink:0;
  font-family:var(--mono);font-size:10px;color:var(--mu);opacity:.65;
}
#ctx-meter.show{display:flex}
.ctx-bar{
  width:36px;height:4px;border-radius:2px;overflow:hidden;
  background:color-mix(in srgb,var(--mu) 15%,transparent);flex-shrink:0;
}
.ctx-fill{height:100%;border-radius:2px;transition:width .4s ease,background .4s;
          background:var(--ok)}
.ctx-fill.warn{background:var(--warn,#d29922)}
.ctx-fill.crit{background:var(--err)}
.ctx-lbl{font-size:10px;opacity:.7;white-space:nowrap}

/* ── browser session rotation banner ── */
.session-rotate{
  display:flex;align-items:center;gap:8px;padding:7px 10px;
  margin:10px 0 4px;border-radius:7px;
  background:color-mix(in srgb,var(--acc) 6%,transparent);
  border:1px solid color-mix(in srgb,var(--acc) 18%,var(--bd));
  font-size:11px;color:var(--mu);flex-shrink:0;
}
.sr-icon{font-size:13px;color:var(--acc);opacity:.8;flex-shrink:0;line-height:1}
.sr-body{flex:1;min-width:0}
.sr-title{font-weight:600;color:var(--fg);opacity:.75;font-size:11px}
.sr-meta{font-size:10px;opacity:.5;font-family:var(--mono);margin-top:1px}

/* ── phase timeline pills ─────────────────────────────────────────────── */
#phase-pills{
  display:flex;align-items:center;gap:0;
  padding:0 12px;height:26px;flex-shrink:0;overflow:hidden;
  border-bottom:1px solid var(--bd);
  background:color-mix(in srgb,var(--bg) 97%,var(--acc) 3%);
}
.pp-sep{font-size:10px;color:var(--mu);opacity:.2;padding:0 3px;user-select:none}
.pp-item{
  display:flex;align-items:center;gap:4px;padding:2px 6px;
  border-radius:4px;font-size:10px;white-space:nowrap;
  color:var(--mu);opacity:.32;
  transition:opacity .2s,background .15s;
}
.pp-item.done{opacity:.7;color:var(--pc,var(--mu))}
.pp-item.active{
  opacity:1;color:var(--pc,var(--fg));font-weight:600;
  background:color-mix(in srgb,var(--pc,var(--acc)) 10%,transparent);
}
.pp-check{font-size:9px;color:inherit;flex-shrink:0}
.pp-num{font-size:9px;font-family:var(--mono);opacity:.5;flex-shrink:0}
.pp-pulse{
  width:5px;height:5px;border-radius:50%;
  background:var(--pc,var(--acc));
  animation:pulse .9s infinite;flex-shrink:0;
}
.pp-label{
  font-size:10px;font-weight:600;letter-spacing:.04em;
  text-transform:uppercase;font-family:var(--mono);
}
.pp-dur{font-size:9px;font-family:var(--mono);opacity:.55}
.pp-dur.pp-live{opacity:.85}

/* ── activity strip (file/command chips) ─────────────────────────────── */
/* activity sidebar — left column showing changed files */
#chat-body{display:flex;flex:1;overflow:hidden;min-width:0}
#activity-strip{
  display:flex;flex-direction:column;gap:3px;
  width:116px;flex-shrink:0;
  padding:8px 7px 12px;
  border-right:1px solid var(--bd);
  overflow-y:auto;overflow-x:hidden;
  background:color-mix(in srgb,var(--bg) 98%,var(--ok) 2%);
}
#activity-strip.hidden{display:none}
#activity-strip::-webkit-scrollbar{width:3px}
#activity-strip::-webkit-scrollbar-thumb{background:var(--bd);border-radius:2px}
.as-label{
  font-size:10px;font-weight:700;text-transform:uppercase;
  letter-spacing:.07em;color:var(--mu);opacity:.35;
  font-family:var(--mono);padding:0 2px;margin-bottom:2px;flex-shrink:0;
}
#activity-chips{display:flex;flex-direction:column;gap:3px}
.ac-chip{
  display:flex;align-items:center;gap:5px;
  padding:3px 7px 3px 6px;border-radius:5px;
  background:color-mix(in srgb,var(--fg) 5%,transparent);
  border:1px solid var(--bd);
  font-family:var(--mono);font-size:11px;
  white-space:nowrap;cursor:pointer;
  transition:background .1s,border-color .12s;
  animation:chipIn .18s ease;
}
.ac-chip:hover{background:var(--hov);border-color:color-mix(in srgb,var(--mu) 45%,transparent)}
.ac-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;opacity:.85}
.ac-name{
  color:var(--fg);opacity:.8;max-width:60px;
  overflow:hidden;text-overflow:ellipsis;font-size:11px;
}
.ac-stats{display:flex;align-items:center;gap:2px;flex-shrink:0}
.ac-add{color:var(--ok);font-size:10px;font-weight:600}
.ac-rem{color:var(--err);font-size:10px;font-weight:600}
.ac-new{
  color:var(--acc);font-size:10px;font-weight:700;
  background:color-mix(in srgb,var(--acc) 12%,transparent);
  padding:0 4px;border-radius:3px;
}
.as-more{font-size:10px;color:var(--mu);opacity:.55;white-space:nowrap;font-family:var(--mono);padding:2px}
@keyframes chipIn{from{opacity:0;transform:scale(.88) translateY(2px)}to{opacity:1;transform:none}}

/* diff flash when chip clicked */
@keyframes diffFlash{0%,100%{outline:none}20%{outline:2px solid var(--ok)}}
.diff-card.diff-flash{animation:diffFlash .75s ease}

/* ── session progress bar ─────────────────────────────────────────────── */
#progress-bar{height:2px;background:transparent;flex-shrink:0;overflow:hidden;
              position:relative}
#progress-fill{height:100%;background:var(--acc);width:0;
               transition:width .55s cubic-bezier(.4,0,.2,1),background .35s;
               box-shadow:0 0 6px var(--acc)}

/* ── chat main area ───────────────────────────────────────────────────── */
#chat-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;position:relative}

/* ── messages ─────────────────────────────────────────────────────────── */
#messages{flex:1;overflow-y:auto;padding:8px 14px 20px;
          display:flex;flex-direction:column;scroll-behavior:smooth}
#messages > *{flex-shrink:0}
#messages::-webkit-scrollbar{width:4px}
#messages::-webkit-scrollbar-track{background:transparent}
#messages::-webkit-scrollbar-thumb{background:var(--bd);border-radius:2px}

/* welcome */
#welcome{flex:1;display:flex;flex-direction:column;justify-content:center;
         padding:32px 4px 20px}
.w-logo{font-size:28px;margin-bottom:16px;opacity:.6;line-height:1;color:var(--acc)}
.w-title{font-size:18px;font-weight:700;margin-bottom:6px;letter-spacing:-.4px}
.w-sub{font-size:12px;color:var(--mu);line-height:1.65;margin-bottom:20px;max-width:300px}
.w-examples{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.w-ex{
  text-align:left;padding:10px 11px;
  background:color-mix(in srgb,var(--fg) 4%,transparent);
  border:1px solid var(--bd);
  color:var(--mu);font:inherit;font-size:11px;cursor:pointer;
  border-radius:7px;
  transition:background .12s,color .12s,border-color .12s;
  display:flex;flex-direction:column;gap:4px;
}
.w-ex-icon{font-size:15px;line-height:1}
.w-ex-txt{font-size:11px;font-weight:500;color:var(--fg);opacity:.8;line-height:1.3}
.w-ex:hover{background:var(--hov);border-color:color-mix(in srgb,var(--acc) 35%,transparent);color:var(--fg)}
.w-ex:hover .w-ex-txt{opacity:1}

/* user message */
.msg-u{margin:18px 0 2px;display:flex;flex-direction:column;align-items:flex-end}
.msg-sender{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
            margin-bottom:5px;color:var(--mu);opacity:.7}
.msg-sender.agent{color:var(--acc);opacity:1}
.msg-body{
  font-size:13px;line-height:1.65;white-space:pre-wrap;word-break:break-word;
  color:var(--fg);padding:9px 13px;
  background:color-mix(in srgb,var(--acc) 11%,transparent);
  border-radius:12px 12px 3px 12px;
  border:1px solid color-mix(in srgb,var(--acc) 18%,transparent);
  max-width:90%;
}

/* agent message */
.msg-a{margin:4px 0 2px}
.mab-md{font-size:13px;line-height:1.7;color:var(--fg)}

/* markdown */
.mab-md .md-p{margin:0 0 4px}
.mab-md .md-br{height:7px}
.mab-md h1{font-size:15px;font-weight:700;margin:14px 0 5px}
.mab-md h2{font-size:14px;font-weight:700;margin:12px 0 4px}
.mab-md h3{font-size:13px;font-weight:700;margin:10px 0 4px}
.mab-md h1.md-h:first-child,.mab-md h2.md-h:first-child,.mab-md h3.md-h:first-child{margin-top:2px}
.mab-md ul,.mab-md ol{padding-left:20px;margin:4px 0 8px}
.mab-md ul{list-style-type:disc}
.mab-md ol{list-style-type:decimal}
.mab-md li{margin:3px 0;line-height:1.6}
.mab-md strong{font-weight:700}
.mab-md em{font-style:italic}
.ic{font-family:var(--mono);font-size:12px;
    background:color-mix(in srgb,var(--fg) 8%,transparent);
    padding:1px 5px;border-radius:3px;word-break:break-all}

/* code blocks */
.cb{border:1px solid var(--bd);border-radius:var(--r);margin:8px 0;overflow:hidden;
    background:var(--vscode-textCodeBlock-background,color-mix(in srgb,var(--fg) 3%,var(--bg)))}
.cb-hdr{display:flex;align-items:center;justify-content:space-between;padding:4px 10px;
        border-bottom:1px solid var(--bd);
        background:color-mix(in srgb,var(--fg) 3%,transparent);min-height:26px}
.cb-lang{font-size:11px;color:var(--mu);font-family:var(--mono)}
.cb-copy{background:transparent;color:var(--mu);border:1px solid var(--bd);
         padding:2px 8px;border-radius:3px;font-size:11px;cursor:pointer}
.cb-copy:hover{background:var(--hov);color:var(--fg)}
.cb-pre{overflow-x:auto;padding:10px 12px;margin:0}
.cb-pre code{font-family:var(--mono);font-size:12px;white-space:pre;color:var(--fg);line-height:1.55}

/* tool cards — activity timeline style */
.tcrd{
  display:flex;align-items:center;gap:7px;
  padding:3px 8px 3px 10px;font-size:11px;font-family:var(--mono);
  color:var(--mu);margin:1px 0;border-radius:4px;
  border-left:2px solid transparent;
  transition:background .1s,border-color .15s;
}
.tcrd:hover{background:var(--hov)}
.tcrd.pending{opacity:.55}
.tcrd.error .tc-file{color:var(--err)}
.tcrd.error .tc-st{color:var(--err)}
/* type-specific left accent */
.tcrd.write{border-left-color:color-mix(in srgb,var(--ok) 45%,transparent)}
.tcrd.write.done{border-left-color:var(--ok)}
.tcrd.run{border-left-color:color-mix(in srgb,var(--cv) 45%,transparent)}
.tcrd.run.done{border-left-color:var(--cv)}
.tcrd.read{border-left-color:transparent}
.tc-pfx{color:var(--mu);opacity:.3;flex-shrink:0;font-size:10px;user-select:none}
.tc-name{
  flex-shrink:0;font-size:10px;font-weight:700;letter-spacing:.03em;
  padding:1px 5px;border-radius:3px;
  background:color-mix(in srgb,var(--mu) 12%,transparent);color:var(--mu);
}
.tcrd.write .tc-name{background:color-mix(in srgb,var(--ok) 14%,transparent);color:color-mix(in srgb,var(--ok) 80%,var(--mu))}
.tcrd.run .tc-name{background:color-mix(in srgb,var(--cv) 14%,transparent);color:color-mix(in srgb,var(--cv) 80%,var(--mu))}
.tcrd.pending .tc-name{opacity:.65}
.tc-file{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
         color:var(--fg);opacity:.75;font-size:11px}
.tc-st{flex-shrink:0;font-size:10px;color:var(--ok)}
.tcrd.pending .tc-st{color:var(--mu);opacity:.3}
.tcrd.run.done .tc-st{color:var(--cv)}

/* read groups */
.rg-card{margin:1px 0;font-family:var(--mono);border-left:2px solid transparent}
.rg-hdr{display:flex;align-items:center;gap:8px;padding:3px 8px 3px 8px;
        font-size:12px;cursor:pointer;user-select:none;color:var(--mu);
        border-radius:3px;transition:background .1s}
.rg-hdr:hover{background:var(--hov)}
.rg-hdr:hover .tc-file{opacity:1}
.rg-caret{font-size:9px;color:var(--mu);opacity:.4;margin-left:auto;
          transition:transform .2s;flex-shrink:0}
.rg-card.open .rg-caret{transform:rotate(180deg)}
.rg-list{display:none;flex-direction:column;padding:2px 0 2px 50px}
.rg-card.open .rg-list{display:flex}
.rg-item{font-size:11px;color:var(--mu);opacity:.55;
         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:2px 0}

/* message entry animation */
.msg-u,.msg-a{animation:msgIn .16s ease}
@keyframes msgIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}

/* copy button on agent messages */
.msg-a{position:relative}
.msg-copy{
  position:absolute;top:22px;right:0;
  background:var(--sidebar);border:1px solid var(--bd);color:var(--mu);
  border-radius:4px;padding:2px 7px;font-size:11px;cursor:pointer;
  opacity:0;transition:opacity .15s,background .1s;line-height:1.4;
  box-shadow:0 1px 4px rgba(0,0,0,.15);
}
.msg-a:hover .msg-copy{opacity:1}
.msg-copy:hover{background:var(--hov);color:var(--fg)}

/* ── collapsible long messages ── */
.msg-a.collapsible .mab-md,.sc-card.collapsible .sc-body{
  max-height:280px;overflow:hidden;
  -webkit-mask-image:linear-gradient(to bottom,black 50%,transparent 100%);
  mask-image:linear-gradient(to bottom,black 50%,transparent 100%);
}
.msg-a.collapsible.expanded .mab-md,.sc-card.collapsible.expanded .sc-body{
  max-height:none;-webkit-mask-image:none;mask-image:none;
}
.msg-expand-btn{
  display:inline-flex;align-items:center;gap:4px;
  background:transparent;border:none;color:var(--acc);
  font:inherit;font-size:11px;font-family:var(--mono);
  cursor:pointer;padding:4px 0 2px;opacity:.7;transition:opacity .1s;
}
.msg-expand-btn:hover{opacity:1}

/* scroll-to-bottom button */
#scroll-btn{
  position:absolute;bottom:78px;right:14px;
  width:30px;height:30px;border-radius:50%;
  background:var(--sidebar);border:1px solid var(--bd);color:var(--mu);
  font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;
  opacity:0;pointer-events:none;transition:opacity .2s,background .1s,transform .2s;
  z-index:20;box-shadow:0 4px 12px rgba(0,0,0,.3);transform:translateY(4px);
}
#scroll-btn.show{opacity:1;pointer-events:auto;transform:translateY(0)}
#scroll-btn:hover{background:var(--hov);color:var(--fg)}

/* phase elapsed timer */
.phase-elapsed{font-size:10px;opacity:.45;margin-left:3px;font-family:var(--mono)}

/* tool-group spacing */
.msg-tools{margin:6px 0 2px}

/* pending tool prefix blinks */
.tcrd.pending .tc-pfx{animation:blink .9s ease-in-out infinite}
@keyframes blink{0%,100%{opacity:.4}50%{opacity:1}}

/* plan / review special cards */
.sc-card{border:1px solid var(--bd);border-radius:8px;overflow:hidden;margin:8px 0}
.sc-card.plan{border-color:color-mix(in srgb,var(--cp) 25%,var(--bd));border-left:2px solid var(--cp)}
.sc-card.review{border-color:color-mix(in srgb,var(--cv) 25%,var(--bd));border-left:2px solid var(--cv)}
.sc-hdr{display:flex;align-items:center;gap:7px;padding:7px 11px;cursor:pointer;
        user-select:none;border-bottom:1px solid transparent;transition:background .1s}
.sc-card.plan  .sc-hdr{background:color-mix(in srgb,var(--cp) 8%,transparent)}
.sc-card.review .sc-hdr{background:color-mix(in srgb,var(--cv) 8%,transparent)}
.sc-card.open .sc-hdr{border-bottom-color:var(--bd)}
.sc-hdr:hover{filter:brightness(1.12)}
.sc-icon{font-size:12px;flex-shrink:0}
.sc-label{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;flex:1}
.sc-card.plan  .sc-label{color:var(--cp)}
.sc-card.review .sc-label{color:var(--cv)}
.sc-caret{font-size:9px;color:var(--mu);opacity:.45;transition:transform .2s;flex-shrink:0}
.sc-card.open .sc-caret{transform:rotate(180deg)}
.sc-body{display:none;padding:11px 13px;font-size:12px;line-height:1.7}
.sc-card.open .sc-body{display:block}
/* expand button inside sc-card sits below the body */
.sc-card .msg-expand-btn{display:none;padding:4px 13px 9px}
.sc-card.open .msg-expand-btn{display:inline-flex}

/* file changes summary card */
.changes-card{
  border:1px solid color-mix(in srgb,var(--ok) 20%,transparent);
  border-left:2px solid var(--ok);border-radius:8px;
  overflow:hidden;margin:6px 0;font-family:var(--mono);font-size:12px;
}
.changes-hdr{display:flex;align-items:center;gap:8px;padding:7px 11px;cursor:pointer;
             user-select:none;background:color-mix(in srgb,var(--ok) 6%,transparent)}
.changes-card.open .changes-hdr{border-bottom:1px solid color-mix(in srgb,var(--ok) 15%,transparent)}
.changes-title{font-size:11px;font-weight:700;color:var(--ok);flex:1;letter-spacing:.02em;text-transform:uppercase}
.changes-count{font-size:10px;color:var(--mu);flex-shrink:0}
.changes-caret{font-size:9px;color:var(--mu);opacity:.45;transition:transform .2s;flex-shrink:0}
.changes-card.open .changes-caret{transform:rotate(180deg)}
.changes-list{display:none;padding:6px 11px 8px;display:flex;flex-direction:column;gap:2px}
.changes-card:not(.open) .changes-list{display:none}
.change-item{display:flex;align-items:baseline;gap:8px;padding:2px 0}
.change-sym{flex-shrink:0;width:12px;text-align:center;font-size:11px}
.change-sym.mod{color:var(--warn)}
.change-sym.new{color:var(--acc)}
.change-sym.run{color:var(--cv)}
.change-path{color:var(--fg);opacity:.8;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
.change-tag{font-size:10px;opacity:.45;flex-shrink:0}

.diff-card{
  border:1px solid var(--bd);border-left:2px solid var(--ok);border-radius:8px;overflow:hidden;
  margin:2px 0 6px;font-family:var(--mono);
  transition:border-color .15s;
  animation:msgIn .14s ease;
}
.diff-card.open{border-color:color-mix(in srgb,var(--ok) 28%,var(--bd));border-left-color:var(--ok)}
.diff-hdr{
  display:flex;align-items:center;gap:7px;padding:6px 10px;
  background:color-mix(in srgb,var(--ok) 5%,transparent);
  cursor:pointer;user-select:none;transition:background .1s;
}
.diff-card.open .diff-hdr{
  background:color-mix(in srgb,var(--ok) 7%,transparent);
  border-bottom:1px solid color-mix(in srgb,var(--ok) 14%,var(--bd));
}
.diff-hdr:hover{background:color-mix(in srgb,var(--ok) 10%,transparent)}
.diff-chevron{font-size:9px;color:var(--mu);flex-shrink:0;transition:transform .15s;line-height:1}
.diff-card.open .diff-chevron{transform:rotate(90deg)}
.diff-lang-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;opacity:.8}
.diff-badge{font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;flex-shrink:0}
.diff-badge.new{color:var(--acc);background:color-mix(in srgb,var(--acc) 14%,transparent)}
.diff-badge.mod{display:none}
.diff-fname{font-size:12px;font-weight:600;color:var(--fg);flex-shrink:0;white-space:nowrap}
.diff-fdir{font-size:11px;color:var(--mu);opacity:.5;flex:1;
           overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.diff-stats{display:flex;gap:4px;flex-shrink:0;align-items:center}
.ds-add{font-size:11px;font-weight:600;color:var(--ok)}
.ds-rem{font-size:11px;font-weight:600;color:var(--err)}
.diff-open{background:transparent;color:var(--mu);border:none;
           padding:2px 4px;border-radius:3px;font-size:13px;cursor:pointer;
           flex-shrink:0;opacity:.55;line-height:1}
.diff-open:hover{opacity:1;background:var(--hov)}
.diff-body{overflow-x:auto;max-height:440px;overflow-y:auto;display:none;
           background:var(--vscode-textCodeBlock-background,color-mix(in srgb,var(--fg) 2%,var(--bg)))}
.diff-body::-webkit-scrollbar{width:4px;height:4px}
.diff-body::-webkit-scrollbar-thumb{background:var(--bd);border-radius:2px}
.diff-card.open .diff-body{display:block}
/* hunk gap separator */
.diff-hunk-sep{
  display:flex;align-items:center;padding:3px 10px;font-size:10px;
  color:var(--mu);opacity:.4;letter-spacing:.12em;
  background:color-mix(in srgb,var(--fg) 3%,transparent);
  border-top:1px solid var(--bd);border-bottom:1px solid var(--bd);
}
/* individual diff lines */
.dl{display:flex;align-items:stretch;font-size:12px;line-height:1.65;min-width:0}
.dl.add{background:color-mix(in srgb,var(--ok) 9%,transparent)}
.dl.add::before{content:'';width:3px;background:var(--ok);flex-shrink:0}
.dl.rem{background:color-mix(in srgb,var(--err) 8%,transparent)}
.dl.rem::before{content:'';width:3px;background:color-mix(in srgb,var(--err) 70%,transparent);flex-shrink:0}
.dl.ctx{opacity:.32}
.dl.ctx::before{content:'';width:3px;flex-shrink:0}
.dl-lo,.dl-ln{
  min-width:32px;padding:0 6px;text-align:right;color:var(--mu);
  user-select:none;flex-shrink:0;font-size:10px;
  display:flex;align-items:center;justify-content:flex-end;
}
.dl-lo{border-right:1px solid color-mix(in srgb,var(--bd) 45%,transparent)}
.dl-ln{border-right:1px solid var(--bd)}
.dl.add .dl-ln{color:color-mix(in srgb,var(--ok) 60%,var(--mu))}
.dl.rem .dl-lo{color:color-mix(in srgb,var(--err) 60%,var(--mu))}
.dl-sym{
  width:16px;text-align:center;flex-shrink:0;color:var(--mu);font-size:12px;
  display:flex;align-items:center;justify-content:center;
}
.dl.add .dl-sym{color:var(--ok);font-weight:700}
.dl.rem .dl-sym{color:var(--err);font-weight:700}
.dl-code{flex:1;padding:0 10px;white-space:pre;color:var(--fg);word-break:normal;min-width:0;overflow:hidden}

/* system / error messages */
.msg-sys{font-size:11px;color:var(--mu);font-style:italic;padding:3px 2px;opacity:.45}
.msg-warn{
  font-size:11px;color:var(--warn);font-style:italic;
  padding:4px 8px;background:color-mix(in srgb,var(--warn) 8%,transparent);
  border-left:2px solid color-mix(in srgb,var(--warn) 50%,transparent);
  border-radius:4px;margin:3px 0;opacity:.85;
}
.msg-err{
  font-size:12px;color:var(--err);display:flex;align-items:center;gap:6px;
  padding:7px 11px;background:color-mix(in srgb,var(--err) 6%,transparent);
  border:1px solid color-mix(in srgb,var(--err) 18%,transparent);
  border-left:2px solid var(--err);
  border-radius:6px;margin:6px 0;font-family:var(--mono);
}

/* phase dividers */
.pdiv{display:flex;align-items:center;gap:8px;margin:12px 0 6px;padding:0}
.pdiv.repeat{opacity:.18;margin:2px 0 2px;padding:0}
.pdiv.repeat .pdlabel{font-size:9px;padding:1px 8px}
.pdline{flex:1;height:1px;background:var(--bd);opacity:.7}
.pdlabel{
  display:flex;align-items:center;gap:5px;font-size:10px;font-weight:700;
  font-family:var(--mono);padding:2px 9px;border-radius:20px;
  border:1px solid transparent;white-space:nowrap;letter-spacing:.06em;
  text-transform:uppercase;
}

/* typing indicator */
#typing{display:none;align-items:center;gap:9px;padding:8px 2px;
        font-size:12px;color:var(--mu)}
.tdots{display:flex;gap:4px;align-items:center}
.tdots span{width:5px;height:5px;border-radius:50%;background:var(--acc);opacity:.4;animation:tb .9s infinite}
.tdots span:nth-child(2){animation-delay:.2s}
.tdots span:nth-child(3){animation-delay:.4s}
@keyframes tb{0%,60%,100%{transform:translateY(0);opacity:.3}30%{transform:translateY(-5px);opacity:1}}

/* done / stopped banners */
.done-banner,.stop-banner{
  display:flex;align-items:center;gap:9px;
  padding:8px 12px;margin:12px 0 4px;
  font-size:11px;font-family:var(--mono);
  border-radius:7px;border:1px solid;
}
.done-banner{
  color:var(--ok);
  background:color-mix(in srgb,var(--ok) 8%,transparent);
  border-color:color-mix(in srgb,var(--ok) 22%,transparent);
}
.stop-banner{
  color:var(--err);
  background:color-mix(in srgb,var(--err) 6%,transparent);
  border-color:color-mix(in srgb,var(--err) 18%,transparent);
}
.done-line{flex:1;height:1px;background:color-mix(in srgb,var(--ok) 20%,transparent)}
.stop-line{flex:1;height:1px;background:color-mix(in srgb,var(--err) 18%,transparent)}
/* stop button disabled during stopping */
.inp-stop:disabled{opacity:.45;cursor:not-allowed}

/* ── banner action row ── */
.banner-acts{display:flex;gap:5px;flex-wrap:wrap;margin:2px 0 8px;padding:0 2px}
.bact{
  background:transparent;border:1px solid var(--bd);color:var(--mu);
  font:inherit;font-size:11px;padding:4px 11px;border-radius:5px;
  cursor:pointer;transition:background .1s,color .1s,border-color .1s;white-space:nowrap;
}
.bact:hover{background:var(--hov);color:var(--fg);border-color:color-mix(in srgb,var(--mu) 60%,transparent)}
.bact.primary{
  background:color-mix(in srgb,var(--acc) 12%,transparent);
  border-color:color-mix(in srgb,var(--acc) 28%,transparent);
  color:var(--acc);font-weight:500;
}
.bact.primary:hover{background:color-mix(in srgb,var(--acc) 20%,transparent)}

/* ── compact mode: hide tool noise ── */
#chat-main.compact .tcrd,
#chat-main.compact .rg-card,
#chat-main.compact .pdiv,
#chat-main.compact .sc-card{display:none!important}
#chat-main.compact #phase-pills,
#chat-main.compact #activity-strip{display:none!important}

/* ── input char count ── */
.inp-char{font-size:10px;color:var(--mu);opacity:.4;font-family:var(--mono);margin-left:auto}

/* ── compact dot toggle (in settings drop) ── */
.drop-item-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.tog-track{
  width:28px;height:15px;border-radius:8px;background:var(--bd);
  position:relative;flex-shrink:0;transition:background .2s;cursor:pointer;
}
.tog-track.on{background:var(--acc)}
.tog-track::after{
  content:'';position:absolute;width:11px;height:11px;border-radius:50%;
  background:#fff;top:2px;left:2px;transition:transform .2s;
}
.tog-track.on::after{transform:translateX(13px)}

/* ── input area ───────────────────────────────────────────────────────── */
.inp-area{padding:8px 12px 10px;border-top:1px solid var(--bd);flex-shrink:0;position:relative}
.inp-wrap{
  position:relative;
  border:1px solid var(--in-bd);border-radius:9px;
  background:var(--in-bg);
  transition:border-color .15s,box-shadow .15s;
}
.inp-wrap:focus-within{
  border-color:var(--foc);
  box-shadow:0 0 0 2px color-mix(in srgb,var(--foc) 15%,transparent);
}
#prompt{
  width:100%;padding:10px 44px 10px 13px;border:none;background:transparent;
  color:var(--in-fg);font:inherit;font-size:13px;resize:none;outline:none;
  line-height:1.55;min-height:42px;max-height:160px;overflow-y:auto;
  display:block;border-radius:9px;
}
#prompt::placeholder{color:var(--mu);opacity:.55}
.inp-send{
  position:absolute;right:7px;bottom:7px;
  width:28px;height:28px;border-radius:6px;
  background:var(--btn);color:var(--btn-fg);border:none;
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:14px;font-weight:700;transition:opacity .12s,background .1s;line-height:1;
}
.inp-send:hover{background:var(--btn-h)}
.inp-send:disabled{opacity:.3;cursor:not-allowed}
.inp-stop{
  position:absolute;right:7px;bottom:7px;
  width:28px;height:28px;border-radius:6px;
  background:color-mix(in srgb,var(--err) 14%,transparent);
  color:var(--err);border:1px solid color-mix(in srgb,var(--err) 28%,transparent);
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:10px;transition:background .12s;
}
.inp-stop:hover{background:color-mix(in srgb,var(--err) 22%,transparent)}
.inp-foot{display:flex;align-items:center;justify-content:space-between;margin-top:6px;gap:6px}
.prov-chip{
  display:flex;align-items:center;gap:5px;
  padding:3px 8px 3px 7px;border-radius:20px;
  border:1px solid var(--bd);background:transparent;color:var(--mu);
  font:inherit;font-size:11px;cursor:pointer;white-space:nowrap;
  transition:border-color .12s,color .12s,background .12s;
}
.prov-chip:hover{border-color:color-mix(in srgb,var(--mu) 60%,transparent);color:var(--fg)}
.prov-chip.connected{
  background:color-mix(in srgb,var(--prov-color,var(--ok)) 10%,transparent);
  border-color:color-mix(in srgb,var(--prov-color,var(--ok)) 30%,transparent);
  color:var(--fg);
}
.prov-chip-dot{width:6px;height:6px;border-radius:50%;background:var(--mu);opacity:.2;flex-shrink:0}
.prov-chip.connected .prov-chip-dot{background:var(--prov-color,var(--ok));opacity:1}
.prov-chip-caret{font-size:9px;opacity:.4;transition:transform .15s;margin-left:1px}
.prov-chip.open .prov-chip-caret{transform:rotate(180deg)}
.inp-hint{font-size:10px;color:var(--mu);opacity:.3;white-space:nowrap}

/* provider dropdown */
#prov-drop{
  position:absolute;bottom:calc(100% + 6px);left:12px;min-width:190px;
  background:var(--sidebar);border:1px solid var(--bd);border-radius:8px;
  box-shadow:0 -6px 22px rgba(0,0,0,.25);z-index:200;padding:4px;
}
.pi-hdr{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
        color:var(--mu);padding:5px 8px 3px}
.pi-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;
         padding:7px 9px;border-radius:3px;font:inherit;font-size:12px;
         background:transparent;border:none;cursor:pointer;color:var(--fg);
         transition:background .1s}
.pi-item:hover{background:var(--hov)}
.pi-item.active{background:color-mix(in srgb,var(--foc) 10%,transparent)}
.pi-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.pi-check{margin-left:auto;font-size:11px;color:var(--acc);opacity:0}
.pi-item.active .pi-check{opacity:1}
</style>
</head>
<body>

<!-- ─── screen 1: connect ─── -->
<div id="scr-connect">
  <div class="cnc-wrap">
    <div class="cnc-mark">◉</div>
    <div class="cnc-title">Dev Agent</div>

    <!-- connecting state -->
    <div id="cnc-connecting">
      <div class="cnc-row">
        <div class="cnc-spinner"></div>
        <span id="cnc-debug">Connecting to bridge…</span>
      </div>
    </div>

    <!-- waiting state (bridge found but still starting) -->
    <div id="cnc-waiting" class="hidden">
      <div class="cnc-row">
        <div class="cnc-spinner"></div>
        <span>Starting browser…</span>
      </div>
    </div>

    <!-- offline state -->
    <div id="cnc-offline" class="hidden">
      <div class="cnc-badge">Not running</div>
      <div class="cnc-label">Start the automation server:</div>
      <div class="cnc-cmd"><span class="cnc-dollar">$</span><code id="cnc-cmd">dev-agent</code></div>
      <div class="cnc-poll">
        <span class="cnc-pulse"></span>
        <span id="cnc-poll-lbl">Checking…</span>
      </div>
    </div>

    <!-- error state -->
    <div id="cnc-error" class="hidden">
      <div class="cnc-badge err">Error</div>
      <div class="cnc-label" id="cnc-err-txt"></div>
      <button class="btn-outline" id="btn-cnc-retry">Try again</button>
    </div>
  </div>
</div>

<!-- ─── screen 2: provider selection ─── -->
<div id="scr-provider" class="hidden">
  <div class="setup-hdr">
    <div class="sh-step"><span class="sh-step-dot"></span>Step 1 of 3</div>
    <div class="sh-title">Choose an AI</div>
    <div class="sh-sub">Select which AI the agent will use to complete your tasks.</div>
  </div>
  <div class="psel-list" id="psel-list"></div>
</div>

<!-- ─── screen 3: browser confirmation ─── -->
<div id="scr-confirm" class="hidden">
  <div class="setup-hdr">
    <div class="sh-step"><span class="sh-step-dot"></span>Step 2 of 3</div>
    <div class="sh-title">Log in</div>
    <div class="sh-sub">The browser panel on the right shows the AI site. Log in if needed, then confirm.</div>
  </div>
  <div id="bridge-launch">
    <div class="bl-spinner"></div>
    <div class="bl-stage" id="bl-stage">Launching browser…</div>
    <div class="bl-detail" id="bl-detail">Opening browser and starting the automation server</div>
    <div class="bl-elapsed" id="bl-elapsed"></div>
    <div class="bl-port" id="bl-port"></div>
  </div>
  <div class="setup-list hidden" id="pcard-list"></div>
</div>

<!-- ─── screen 4: project selection ─── -->
<div id="scr-project" class="hidden">
  <div class="setup-hdr">
    <div class="sh-step"><span class="sh-step-dot"></span>Step 3 of 3</div>
    <div class="sh-title">Select a project</div>
    <div class="sh-sub">Choose a workspace folder to work in.</div>
  </div>
  <div class="proj-list" id="proj-body"></div>
  <div class="proj-acts">
    <button class="btn-act" id="btn-browse">Browse…</button>
    <button class="btn-act" id="btn-new-folder">New folder…</button>
  </div>
</div>

<!-- ─── screen 5: chat ─── -->
<div id="scr-chat" class="hidden">

  <div id="chat-hdr">
    <div class="hdr-brand">
      <span class="hdr-logo">◉</span>
      <span class="hdr-name">Dev Agent</span>
    </div>
    <div class="hdr-left">
      <span class="hdr-divider"></span>
      <button class="hdr-btn" id="btn-sessions">
        <span id="hdr-proj" class="hdr-proj">—</span>
        <span id="session-count" class="hdr-session-badge"></span>
        <span class="hdr-drop-arr">▾</span>
      </button>
    </div>
    <div class="hdr-right">
      <button class="hdr-icon-btn" id="btn-notes" title="Plans &amp; reviews">≡ <span id="notes-badge"></span></button>
      <button class="hdr-new-btn" id="btn-new-chat" title="New session (⌘K)">+ New</button>
      <button class="hdr-icon-btn" id="btn-settings" title="Settings">⋮</button>
    </div>
  </div>

  <div id="sessions-drop" class="hidden">
    <div id="session-list"></div>
  </div>
  <div id="settings-drop" class="hidden">
    <div class="drop-label">Workspace</div>
    <button class="drop-item" id="btn-sb-proj">📁 Change project…</button>
    <div class="drop-sep"></div>
    <div class="drop-label">View</div>
    <div class="drop-item drop-item-row" id="btn-compact" style="cursor:pointer">
      <span>Compact mode</span>
      <div class="tog-track" id="compact-dot"></div>
    </div>
    <button class="drop-item" id="btn-export">📋 Export transcript</button>
    <div class="drop-sep"></div>
    <div class="drop-label">Bridge</div>
    <button class="drop-item" id="btn-sb-prov">↺ Reconnect…</button>
    <button class="drop-item" id="btn-stop-bridge" style="color:var(--err)">⏹ Stop bridge</button>
  </div>

  <div id="chat-main">

    <div id="phase-bar" class="hidden">
      <div id="phase-steps" style="display:none"></div>
      <span class="ph-spinner"></span>
      <span id="phase-lbl">Starting…</span>
      <div class="tool-chip" id="tool-chip"></div>
      <span class="phase-gap"></span>
      <span id="session-delta" class="hidden"></span>
      <div id="ctx-meter">
        <div class="ctx-bar"><div id="ctx-fill" class="ctx-fill" style="width:0%"></div></div>
        <span id="ctx-lbl" class="ctx-lbl"></span>
      </div>
      <div id="phase-stats"></div>
    </div>
    <div id="phase-pills" class="hidden"></div>
    <div id="progress-bar"><div id="progress-fill"></div></div>
    <div id="chat-body">
    <div id="activity-strip" class="hidden">
      <span class="as-label">Changed</span>
      <div id="activity-chips"></div>
      <span id="activity-overflow" class="as-more hidden"></span>
    </div>

    <div id="messages">
      <div id="welcome">
        <div class="w-logo">◉</div>
        <div class="w-title">What can I build for you?</div>
        <div class="w-sub">Plans, codes, and verifies — no API key needed.</div>
        <div class="w-examples">
          <button class="w-ex" data-prompt="Add dark mode support to the app">
            <span class="w-ex-icon">🌙</span>
            <span class="w-ex-txt">Add dark mode</span>
          </button>
          <button class="w-ex" data-prompt="Write unit tests for the main module">
            <span class="w-ex-icon">🧪</span>
            <span class="w-ex-txt">Write tests</span>
          </button>
          <button class="w-ex" data-prompt="Fix all TypeScript errors in the project">
            <span class="w-ex-icon">🔧</span>
            <span class="w-ex-txt">Fix TS errors</span>
          </button>
          <button class="w-ex" data-prompt="Refactor the API layer to use async/await">
            <span class="w-ex-icon">⚡</span>
            <span class="w-ex-txt">Refactor API</span>
          </button>
        </div>
      </div>
      <div id="typing">
        <div class="tdots"><span></span><span></span><span></span></div>
      </div>
    </div>
    </div><!-- #chat-body -->

    <button id="scroll-btn" title="Scroll to bottom">↓</button>

    <div id="notes-drawer">
      <div id="notes-hdr">
        <span id="notes-hdr-lbl">Plans &amp; Reviews</span>
        <button id="notes-close" title="Close">✕</button>
      </div>
      <div id="notes-list">
        <div id="notes-empty">No plans or reviews yet</div>
      </div>
    </div>

    <div class="inp-area">
      <div class="inp-wrap">
        <textarea id="prompt" rows="1" placeholder="Describe what to build…"></textarea>
        <button class="inp-send" id="btn-send" title="Send (Enter)">↑</button>
        <button class="inp-stop hidden" id="btn-stop" title="Stop">■</button>
      </div>
      <div class="inp-foot">
        <button id="btn-prov" class="prov-chip">
          <span class="prov-chip-dot"></span>
          <span id="prov-name">No provider</span>
          <span class="prov-chip-caret">▾</span>
        </button>
        <span class="inp-hint" id="inp-hint">↵ send · ↑ history</span>
        <span class="inp-char" id="inp-char"></span>
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
