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
.sb-top{padding:14px 14px 12px;border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.15))}
.sb-brand{display:flex;align-items:center;gap:7px;margin-bottom:10px}
.sb-mark{font-size:13px;line-height:1;opacity:.7}
.sb-name{font-size:13px;font-weight:700;letter-spacing:-.2px}
.btn{background:var(--vscode-button-background);color:var(--vscode-button-foreground);
     border:none;border-radius:4px;padding:6px 12px;font:inherit;cursor:pointer;
     font-size:12px;width:100%;text-align:center;transition:opacity .12s}
.btn:hover{opacity:.88}
.row{display:flex;align-items:center;gap:7px;padding:10px 14px 0}
.dot{width:6px;height:6px;border-radius:50%;background:var(--vscode-descriptionForeground);opacity:.25;flex-shrink:0;transition:all .3s}
.dot.on{background:#3fb950;opacity:1}
.dot.wait{background:#d29922;opacity:1;animation:p .9s infinite}
.dot.run{background:#58a6ff;opacity:1;animation:p .9s infinite}
.dot.done{background:#3fb950;opacity:1}
@keyframes p{0%,100%{opacity:1}50%{opacity:.2}}
.lbl{font-size:11px;color:var(--vscode-descriptionForeground);flex:1;
     white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tool-lbl{font-size:10px;color:var(--vscode-descriptionForeground);opacity:.6;
           padding:2px 14px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
           font-family:var(--vscode-editor-font-family,monospace);display:none}
hr{border:none;border-top:1px solid var(--vscode-panel-border,rgba(128,128,128,.15));margin:8px 0}
.kv{padding:5px 14px}
.k{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
   color:var(--vscode-descriptionForeground);margin-bottom:2px}
.v{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body>
<div class="sb-top">
  <div class="sb-brand"><span class="sb-mark">◉</span><span class="sb-name">Dev Agent</span></div>
  <button class="btn" id="o">Open →</button>
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
  --r:5px;
  /* Phase colors kept for inline use in JS-generated phase dividers */
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
.setup-hdr{padding:28px 28px 20px;flex-shrink:0;border-bottom:1px solid var(--bd)}
.sh-step{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;
         color:var(--mu);margin-bottom:6px}
.sh-title{font-size:16px;font-weight:700;margin-bottom:5px;letter-spacing:-.3px}
.sh-sub{font-size:12px;color:var(--mu);line-height:1.55}

/* ── connect screen ───────────────────────────────────────────────────── */
#scr-connect{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 24px}
.cnc-wrap{width:100%;max-width:340px;display:flex;flex-direction:column;gap:10px}
.cnc-mark{font-size:22px;margin-bottom:2px;opacity:.55}
.cnc-title{font-size:20px;font-weight:700;letter-spacing:-.4px;margin-bottom:14px}
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
.psel-list{flex:1;overflow-y:auto;padding:8px 0}
.psel-card{
  display:flex;align-items:center;gap:12px;
  padding:11px 28px;width:100%;text-align:left;
  background:transparent;color:var(--fg);font:inherit;
  border:none;border-bottom:1px solid var(--bd);cursor:pointer;
  transition:background .1s;
}
.psel-card:hover{background:var(--hov)}
.psel-card-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.psel-card-name{font-size:13px;font-weight:500;flex:1}
.psel-card-arr{font-size:13px;color:var(--mu);opacity:.4}

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
.proj-list{flex:1;overflow-y:auto;padding:8px 0}
.proj-lbl{font-size:10px;color:var(--mu);text-transform:uppercase;
          letter-spacing:.07em;padding:6px 28px 4px;font-weight:700}
.proj-card{display:flex;align-items:center;gap:12px;padding:10px 28px;
           cursor:pointer;transition:background .1s;border-bottom:1px solid var(--bd)}
.proj-card:hover{background:var(--hov)}
.pinfo{flex:1;min-width:0}
.pname{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ppath{font-size:11px;color:var(--mu);white-space:nowrap;overflow:hidden;
       text-overflow:ellipsis;margin-top:2px;font-family:var(--mono)}
.parr{font-size:13px;color:var(--mu);opacity:.4}
.pi{font-size:15px;flex-shrink:0}
.proj-acts{display:flex;gap:8px;padding:12px 28px;border-top:1px solid var(--bd);flex-shrink:0}
.btn-act{background:transparent;border:1px solid var(--bd);color:var(--mu);
         font:inherit;font-size:12px;cursor:pointer;padding:7px 14px;border-radius:var(--r);
         flex:1;transition:background .1s,color .1s,border-color .1s}
.btn-act:hover{background:var(--hov);color:var(--fg);border-color:var(--mu)}

/* ══════════════════════════════════════════════════════════════════════
   CHAT SCREEN
══════════════════════════════════════════════════════════════════════ */
#scr-chat{flex:1;display:flex;flex-direction:column;overflow:hidden}

/* ── header ─────────────────────────────────────────────────────────── */
#chat-hdr{
  display:flex;align-items:center;justify-content:space-between;
  padding:0 10px;height:35px;flex-shrink:0;
  border-bottom:1px solid var(--bd);
  background:var(--sidebar);
  position:relative;
}
.hdr-left{display:flex;align-items:center;gap:0;flex:1;min-width:0;overflow:hidden}
.hdr-right{display:flex;align-items:center;gap:1px;flex-shrink:0}
.hdr-btn{background:transparent;color:var(--mu);padding:4px 8px;border-radius:var(--r);
         font-size:11px;font-weight:500;border:none;cursor:pointer;white-space:nowrap;
         flex-shrink:0;transition:background .1s,color .1s}
.hdr-btn:hover,.hdr-btn.active{background:var(--hov);color:var(--fg)}
.hdr-sep{font-size:11px;color:var(--mu);opacity:.3;padding:0 4px;flex-shrink:0}
.hdr-proj{font-size:11px;color:var(--mu);white-space:nowrap;overflow:hidden;
          text-overflow:ellipsis;flex:1;min-width:0}
.hdr-icon-btn{background:transparent;border:none;color:var(--mu);
              width:28px;height:28px;border-radius:var(--r);cursor:pointer;
              font-size:14px;display:flex;align-items:center;justify-content:center;
              font-weight:500;transition:background .1s,color .1s}
.hdr-icon-btn:hover{background:var(--hov);color:var(--fg)}

/* ── dropdowns ───────────────────────────────────────────────────────── */
#sessions-drop{
  position:absolute;top:35px;left:0;width:260px;z-index:200;
  background:var(--sidebar);border:1px solid var(--bd);border-top:none;
  border-radius:0 0 var(--r) var(--r);box-shadow:0 8px 24px rgba(0,0,0,.25);
  max-height:300px;overflow-y:auto;
}
#session-list{padding:4px}
.sb-empty{font-size:11px;color:var(--mu);text-align:center;padding:16px 8px;font-style:italic}
.sitem{
  display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:3px;
  cursor:pointer;background:transparent;border:1px solid transparent;
  width:100%;text-align:left;font:inherit;transition:background .1s;
}
.sitem:hover:not(.active):not(:disabled){background:var(--hov)}
.sitem.active{background:var(--sel);border-color:var(--bd)}
.sitem:disabled{opacity:.4;cursor:not-allowed}
.s-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:4px}
.s-dot.running{background:var(--acc);animation:pulse .9s infinite}
.s-dot.done{background:var(--ok)}
.s-dot.error{background:var(--err)}
.s-dot.stopped{background:var(--mu);opacity:.4}
.s-body{flex:1;min-width:0}
.s-prompt{font-size:12px;color:var(--fg);
          display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
          overflow:hidden;line-height:1.4;margin-bottom:2px}
.s-meta{font-size:10px;color:var(--mu)}
#settings-drop{
  position:absolute;top:35px;right:0;width:190px;z-index:200;
  background:var(--sidebar);border:1px solid var(--bd);border-top:none;
  border-radius:0 0 var(--r) var(--r);box-shadow:0 8px 24px rgba(0,0,0,.25);
  padding:4px;
}
.drop-item{display:flex;align-items:center;width:100%;text-align:left;
           padding:7px 10px;border-radius:3px;font:inherit;font-size:12px;
           background:transparent;color:var(--fg);border:none;cursor:pointer;
           transition:background .1s}
.drop-item:hover{background:var(--hov)}
.drop-sep{height:1px;background:var(--bd);margin:3px 0}

/* ── phase bar ────────────────────────────────────────────────────────── */
#phase-bar{
  flex-shrink:0;padding:5px 14px;border-bottom:1px solid var(--bd);
  display:flex;align-items:center;gap:8px;font-size:11px;color:var(--mu);
  background:color-mix(in srgb,var(--bg) 96%,var(--acc) 4%);
}
.ph-spinner{width:10px;height:10px;border:1.5px solid var(--bd);border-top-color:var(--mu);
            border-radius:50%;animation:spin .65s linear infinite;flex-shrink:0}
#phase-lbl{font-family:var(--mono);font-size:11px}
.phase-elapsed{font-family:var(--mono);font-size:10px;opacity:.4}
.tool-chip{display:none;align-items:center;font-family:var(--mono);font-size:11px;
           color:var(--mu);max-width:180px;overflow:hidden;text-overflow:ellipsis;
           white-space:nowrap;flex-shrink:0}
.phase-gap{flex:1}
#phase-stats{
  display:flex;align-items:center;gap:9px;flex-shrink:0;
  font-family:var(--mono);font-size:10px;color:var(--mu);opacity:.55;
}
.pstat{display:flex;align-items:center;gap:3px}
.pstat-val{font-weight:700}

/* ── session progress bar ─────────────────────────────────────────────── */
#progress-bar{height:2px;background:transparent;flex-shrink:0;overflow:hidden}
#progress-fill{height:100%;background:var(--acc);width:0;
               transition:width .55s cubic-bezier(.4,0,.2,1),background .35s}

/* ── chat main area ───────────────────────────────────────────────────── */
#chat-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;position:relative}

/* ── messages ─────────────────────────────────────────────────────────── */
#messages{flex:1;overflow-y:auto;padding:0 20px 8px;
          display:flex;flex-direction:column;scroll-behavior:smooth}

/* welcome */
#welcome{flex:1;display:flex;flex-direction:column;justify-content:center;
         padding:40px 0 20px}
.w-title{font-size:17px;font-weight:700;margin-bottom:8px;letter-spacing:-.3px}
.w-sub{font-size:12px;color:var(--mu);line-height:1.6;margin-bottom:22px;max-width:320px}
.w-examples{display:flex;flex-direction:column;gap:2px}
.w-ex{text-align:left;padding:7px 10px;background:transparent;border:none;
      color:var(--mu);font:inherit;font-size:12px;cursor:pointer;border-radius:var(--r);
      transition:background .1s,color .1s;display:flex;align-items:center;gap:6px}
.w-ex::before{content:'›';color:var(--mu);opacity:.5;flex-shrink:0}
.w-ex:hover{background:var(--hov);color:var(--fg)}
.w-ex:hover::before{opacity:1}

/* user message */
.msg-u{margin:24px 0 2px}
.msg-sender{font-size:11px;font-weight:600;margin-bottom:4px;color:var(--mu)}
.msg-sender.agent{color:var(--acc)}
.msg-body{font-size:13px;line-height:1.65;white-space:pre-wrap;word-break:break-word;
          color:var(--fg)}

/* agent message */
.msg-a{margin:4px 0 2px}
.mab-md{font-size:13px;line-height:1.65;color:var(--fg)}

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

/* tool cards — terminal style */
.tcrd{
  display:flex;align-items:center;gap:7px;
  padding:1px 0;font-size:12px;font-family:var(--mono);
  color:var(--mu);margin:0;
}
.tcrd.pending{opacity:.55}
.tcrd.error .tc-file{color:var(--err)}
.tcrd.error .tc-st{color:var(--err)}
.tc-pfx{color:var(--mu);opacity:.4;flex-shrink:0;font-size:11px;user-select:none}
.tc-name{width:36px;flex-shrink:0;font-size:11px;color:var(--mu);opacity:.7}
.tc-file{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
         color:var(--fg);opacity:.8}
.tc-st{flex-shrink:0;font-size:11px;color:var(--ok)}
.tcrd.pending .tc-st{color:var(--mu);opacity:.4}

/* read groups */
.rg-card{margin:0;font-family:var(--mono)}
.rg-hdr{display:flex;align-items:center;gap:7px;padding:1px 0;
        font-size:12px;cursor:pointer;user-select:none;color:var(--mu)}
.rg-hdr:hover .tc-file{opacity:1}
.rg-caret{font-size:9px;color:var(--mu);opacity:.4;margin-left:auto;
          transition:transform .2s;flex-shrink:0}
.rg-card.open .rg-caret{transform:rotate(180deg)}
.rg-list{display:none;flex-direction:column;padding:2px 0 2px 54px}
.rg-card.open .rg-list{display:flex}
.rg-item{font-size:11px;color:var(--mu);opacity:.65;
         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 0}

/* message entry animation */
.msg-u,.msg-a{animation:msgIn .16s ease}
@keyframes msgIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}

/* copy button on agent messages */
.msg-a{position:relative}
.msg-copy{
  position:absolute;top:0;right:0;
  background:transparent;border:1px solid var(--bd);color:var(--mu);
  border-radius:3px;padding:2px 7px;font-size:11px;cursor:pointer;
  opacity:0;transition:opacity .15s,background .1s;line-height:1.4;
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
  position:absolute;bottom:82px;right:16px;
  width:28px;height:28px;border-radius:50%;
  background:var(--sidebar);border:1px solid var(--bd);color:var(--mu);
  font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;
  opacity:0;pointer-events:none;transition:opacity .2s,background .1s;
  z-index:20;box-shadow:0 2px 8px rgba(0,0,0,.25);
}
#scroll-btn.show{opacity:1;pointer-events:auto}
#scroll-btn:hover{background:var(--hov);color:var(--fg)}

/* phase elapsed timer */
.phase-elapsed{font-size:10px;opacity:.45;margin-left:3px;font-family:var(--mono)}

/* tool-group spacing */
.msg-tools{margin:4px 0 2px;padding-left:2px}

/* pending tool prefix blinks */
.tcrd.pending .tc-pfx{animation:blink .9s ease-in-out infinite}
@keyframes blink{0%,100%{opacity:.4}50%{opacity:1}}

/* plan / review special cards */
.sc-card{border:1px solid var(--bd);border-radius:var(--r);overflow:hidden;margin:10px 0}
.sc-card.plan{border-left:2px solid var(--cp)}
.sc-card.review{border-left:2px solid var(--cv)}
.sc-hdr{display:flex;align-items:center;gap:7px;padding:6px 10px;cursor:pointer;
        user-select:none;border-bottom:1px solid transparent;transition:background .1s}
.sc-card.plan  .sc-hdr{background:color-mix(in srgb,var(--cp) 7%,transparent)}
.sc-card.review .sc-hdr{background:color-mix(in srgb,var(--cv) 7%,transparent)}
.sc-card.open .sc-hdr{border-bottom-color:var(--bd)}
.sc-hdr:hover{filter:brightness(1.1)}
.sc-icon{font-size:12px;flex-shrink:0}
.sc-label{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;flex:1}
.sc-card.plan  .sc-label{color:var(--cp)}
.sc-card.review .sc-label{color:var(--cv)}
.sc-caret{font-size:9px;color:var(--mu);opacity:.5;transition:transform .2s;flex-shrink:0}
.sc-card.open .sc-caret{transform:rotate(180deg)}
.sc-body{display:none;padding:10px 12px;font-size:12px;line-height:1.65}
.sc-card.open .sc-body{display:block}
/* expand button inside sc-card sits below the body */
.sc-card .msg-expand-btn{display:none;padding:4px 12px 8px}
.sc-card.open .msg-expand-btn{display:inline-flex}

/* file changes summary card */
.changes-card{border:1px solid color-mix(in srgb,var(--ok) 30%,transparent);
              border-left:2px solid var(--ok);border-radius:var(--r);
              overflow:hidden;margin:8px 0;font-family:var(--mono);font-size:12px}
.changes-hdr{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;
             user-select:none;background:color-mix(in srgb,var(--ok) 7%,transparent)}
.changes-card.open .changes-hdr{border-bottom:1px solid color-mix(in srgb,var(--ok) 20%,transparent)}
.changes-title{font-size:11px;font-weight:700;color:var(--ok);flex:1}
.changes-count{font-size:10px;color:var(--mu);flex-shrink:0}
.changes-caret{font-size:9px;color:var(--mu);opacity:.5;transition:transform .2s;flex-shrink:0}
.changes-card.open .changes-caret{transform:rotate(180deg)}
.changes-list{display:none;padding:6px 10px 8px;display:flex;flex-direction:column;gap:2px}
.changes-card:not(.open) .changes-list{display:none}
.change-item{display:flex;align-items:baseline;gap:8px;padding:1px 0}
.change-sym{flex-shrink:0;width:12px;text-align:center;font-size:11px}
.change-sym.mod{color:var(--warn)}
.change-sym.new{color:var(--acc)}
.change-sym.run{color:var(--cv)}
.change-path{color:var(--fg);opacity:.85;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.change-tag{font-size:10px;opacity:.5;flex-shrink:0}

/* ── diff card (file changes, Claude Code style) ── */
.diff-card{border:1px solid var(--bd);border-radius:var(--r);overflow:hidden;margin:6px 0;font-family:var(--mono)}
.diff-hdr{
  display:flex;align-items:center;gap:8px;padding:5px 10px;
  background:color-mix(in srgb,var(--fg) 3%,transparent);
  border-bottom:1px solid var(--bd);
}
.diff-badge{font-size:11px;font-weight:700;flex-shrink:0}
.diff-badge.new{color:var(--ok)}
.diff-badge.mod{color:var(--warn)}
.diff-path{font-size:12px;font-weight:500;flex:1;
           overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)}
.diff-stats{display:flex;gap:5px;flex-shrink:0}
.ds-add{font-size:11px;color:var(--ok)}
.ds-rem{font-size:11px;color:var(--err)}
.diff-open{background:transparent;color:var(--mu);border:1px solid var(--bd);
           padding:2px 8px;border-radius:3px;font-size:11px;cursor:pointer;font-family:inherit;flex-shrink:0}
.diff-open:hover{background:var(--hov);color:var(--fg)}
.diff-body{overflow-x:auto;max-height:320px;overflow-y:auto;
           background:var(--vscode-textCodeBlock-background,color-mix(in srgb,var(--fg) 2%,var(--bg)))}
.diff-sep{height:1px;background:var(--bd);border:none;margin:0;opacity:.4}
/* individual diff lines */
.dl{display:flex;align-items:stretch;font-size:12px;line-height:1.6;min-width:0}
.dl.add{background:color-mix(in srgb,var(--ok) 12%,transparent)}
.dl.rem{background:color-mix(in srgb,var(--err) 10%,transparent)}
.dl.ctx{opacity:.45}
.dl-ln{
  min-width:38px;padding:0 6px;text-align:right;color:var(--mu);
  user-select:none;flex-shrink:0;font-size:10px;
  border-right:1px solid var(--bd);display:flex;align-items:center;justify-content:flex-end;
}
.dl.add .dl-ln{color:color-mix(in srgb,var(--ok) 60%,var(--mu))}
.dl.rem .dl-ln{color:color-mix(in srgb,var(--err) 60%,var(--mu))}
.dl-sym{
  width:18px;text-align:center;flex-shrink:0;
  color:var(--mu);font-size:13px;
  display:flex;align-items:center;justify-content:center;
}
.dl.add .dl-sym{color:var(--ok);font-weight:700}
.dl.rem .dl-sym{color:var(--err);font-weight:700}
.dl-code{flex:1;padding:0 10px;white-space:pre;color:var(--fg);word-break:normal;min-width:0;overflow:hidden}

/* system / error messages */
.msg-sys{font-size:11px;color:var(--mu);font-style:italic;padding:4px 0;opacity:.65}
.msg-err{font-size:12px;color:var(--err);display:flex;align-items:center;gap:6px;
         padding:6px 10px;background:color-mix(in srgb,var(--err) 7%,transparent);
         border:1px solid color-mix(in srgb,var(--err) 20%,transparent);
         border-radius:var(--r);margin:4px 0;font-family:var(--mono)}

/* phase dividers */
.pdiv{display:flex;align-items:center;gap:10px;margin:14px 0 8px}
.pdiv.repeat{opacity:.35;margin:6px 0 4px}
.pdiv.repeat .pdlabel{font-size:9px}
.pdline{flex:1;height:1px;background:var(--bd)}
.pdlabel{display:flex;align-items:center;gap:5px;font-size:10px;font-weight:700;
         font-family:var(--mono);padding:2px 8px;border-radius:20px;
         border:1px solid transparent;white-space:nowrap}

/* typing indicator */
#typing{display:none;align-items:center;gap:8px;padding:6px 0;
        font-size:12px;color:var(--mu);font-style:italic}
.tdots{display:flex;gap:3px;align-items:center}
.tdots span{width:4px;height:4px;border-radius:50%;background:var(--mu);animation:tb .9s infinite}
.tdots span:nth-child(2){animation-delay:.18s}
.tdots span:nth-child(3){animation-delay:.36s}
@keyframes tb{0%,60%,100%{transform:translateY(0);opacity:.25}30%{transform:translateY(-4px);opacity:.9}}

/* done / stopped banners */
.done-banner,.stop-banner{display:flex;align-items:center;gap:10px;padding:10px 0;margin:8px 0;
             font-size:11px;font-family:var(--mono)}
.done-banner{color:var(--ok)}
.stop-banner{color:var(--err)}
.done-line{flex:1;height:1px;background:color-mix(in srgb,var(--ok) 25%,transparent)}
.stop-line{flex:1;height:1px;background:color-mix(in srgb,var(--err) 22%,transparent)}
/* stop button disabled during stopping */
.inp-stop:disabled{opacity:.45;cursor:not-allowed}

/* ── input area ───────────────────────────────────────────────────────── */
.inp-area{padding:8px 14px 11px;border-top:1px solid var(--bd);flex-shrink:0;position:relative}
.inp-wrap{
  position:relative;
  border:1px solid var(--in-bd);border-radius:var(--r);
  background:var(--in-bg);
  transition:border-color .15s;
}
.inp-wrap:focus-within{border-color:var(--foc)}
#prompt{
  width:100%;padding:9px 40px 9px 11px;border:none;background:transparent;
  color:var(--in-fg);font:inherit;font-size:13px;resize:none;outline:none;
  line-height:1.5;min-height:40px;max-height:160px;overflow-y:auto;
  display:block;
}
#prompt::placeholder{color:var(--mu);opacity:.6}
.inp-send{
  position:absolute;right:6px;bottom:6px;
  width:26px;height:26px;border-radius:4px;
  background:var(--btn);color:var(--btn-fg);border:none;
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:700;transition:opacity .12s;line-height:1;
}
.inp-send:hover{opacity:.85}
.inp-send:disabled{opacity:.35;cursor:not-allowed}
.inp-stop{
  position:absolute;right:6px;bottom:6px;
  width:26px;height:26px;border-radius:4px;
  background:color-mix(in srgb,var(--err) 15%,transparent);
  color:var(--err);border:1px solid color-mix(in srgb,var(--err) 30%,transparent);
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:10px;transition:background .12s;
}
.inp-stop:hover{background:color-mix(in srgb,var(--err) 22%,transparent)}
.inp-foot{display:flex;align-items:center;justify-content:space-between;margin-top:5px}
.prov-chip{
  display:flex;align-items:center;gap:5px;
  padding:3px 8px 3px 7px;border-radius:20px;
  border:1px solid var(--bd);background:transparent;color:var(--mu);
  font:inherit;font-size:11px;cursor:pointer;white-space:nowrap;
  transition:border-color .12s,color .12s;
}
.prov-chip:hover{border-color:var(--mu);color:var(--fg)}
.prov-chip.connected{
  background:color-mix(in srgb,var(--prov-color,var(--ok)) 10%,transparent);
  border-color:color-mix(in srgb,var(--prov-color,var(--ok)) 35%,transparent);
  color:var(--fg);
}
.prov-chip-dot{width:6px;height:6px;border-radius:50%;background:var(--mu);opacity:.25;flex-shrink:0}
.prov-chip.connected .prov-chip-dot{background:var(--prov-color,var(--ok));opacity:1}
.prov-chip-caret{font-size:9px;opacity:.4;transition:transform .15s;margin-left:1px}
.prov-chip.open .prov-chip-caret{transform:rotate(180deg)}
.inp-hint{font-size:10px;color:var(--mu);opacity:.35;white-space:nowrap}

/* provider dropdown */
#prov-drop{
  position:absolute;bottom:calc(100% + 4px);left:14px;min-width:190px;
  background:var(--sidebar);border:1px solid var(--bd);border-radius:var(--r);
  box-shadow:0 -4px 18px rgba(0,0,0,.22);z-index:200;padding:4px;
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
    <div class="sh-step">Step 1 of 3</div>
    <div class="sh-title">Choose an AI</div>
    <div class="sh-sub">Select which AI the agent will use to complete your tasks.</div>
  </div>
  <div class="psel-list" id="psel-list"></div>
</div>

<!-- ─── screen 3: browser confirmation ─── -->
<div id="scr-confirm" class="hidden">
  <div class="setup-hdr">
    <div class="sh-step">Step 2 of 3</div>
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
    <div class="sh-step">Step 3 of 3</div>
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
    <div class="hdr-left">
      <button class="hdr-btn" id="btn-sessions">Sessions ▾</button>
      <span class="hdr-sep">·</span>
      <span class="hdr-proj" id="hdr-proj">—</span>
    </div>
    <div class="hdr-right">
      <button class="hdr-icon-btn" id="btn-new-chat" title="New session">+</button>
      <button class="hdr-icon-btn" id="btn-settings" title="Settings">⋮</button>
    </div>
  </div>

  <div id="sessions-drop" class="hidden">
    <div id="session-list"></div>
  </div>
  <div id="settings-drop" class="hidden">
    <button class="drop-item" id="btn-sb-proj">Change project…</button>
    <div class="drop-sep"></div>
    <button class="drop-item" id="btn-sb-prov">Reconnect bridge</button>
  </div>

  <div id="chat-main">

    <div id="phase-bar" class="hidden">
      <div id="phase-steps" style="display:none"></div>
      <span class="ph-spinner"></span>
      <span id="phase-lbl">Starting…</span>
      <div class="tool-chip" id="tool-chip"></div>
      <span class="phase-gap"></span>
      <div id="phase-stats"></div>
    </div>
    <div id="progress-bar"><div id="progress-fill"></div></div>

    <div id="messages">
      <div id="welcome">
        <div class="w-title">What can I help you build?</div>
        <div class="w-sub">The agent plans, codes, and verifies using browser automation — no API key needed.</div>
        <div class="w-examples">
          <button class="w-ex" data-prompt="Add dark mode support to the app">Add dark mode support</button>
          <button class="w-ex" data-prompt="Write unit tests for the main module">Write unit tests</button>
          <button class="w-ex" data-prompt="Fix all TypeScript errors in the project">Fix TypeScript errors</button>
          <button class="w-ex" data-prompt="Refactor the API layer to use async/await">Refactor to async/await</button>
        </div>
      </div>
      <div id="typing">
        <div class="tdots"><span></span><span></span><span></span></div>
        <span>Working…</span>
      </div>
    </div>

    <button id="scroll-btn" title="Scroll to bottom">↓</button>

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
