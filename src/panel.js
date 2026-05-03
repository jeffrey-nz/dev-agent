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

// Minimal VS Code sidebar view — shows live status and opens the main panel
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
    setTimeout(() => this._onMessage({ type: "open_panel" }), 80);
  }

  postMessage(msg) { this._view?.webview.postMessage(msg); }

  _buildSidebarHtml() {
    return `<!DOCTYPE html><html><head><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:13px;
     color:var(--vscode-editor-foreground);
     background:var(--vscode-sideBar-background,var(--vscode-editor-background));
     height:100vh;display:flex;flex-direction:column;align-items:center;
     padding:24px 14px 16px;gap:12px;text-align:center}
.logo{font-size:32px;line-height:1}
h3{font-size:13px;font-weight:600}
p{font-size:11px;color:var(--vscode-descriptionForeground);line-height:1.5;max-width:150px}
.btn{background:var(--vscode-button-background);color:var(--vscode-button-foreground);
     border:none;border-radius:5px;padding:7px 14px;font:inherit;cursor:pointer;
     font-size:12px;width:100%;max-width:150px}
.btn:hover{background:var(--vscode-button-hoverBackground)}
hr{width:100%;border:none;border-top:1px solid var(--vscode-panel-border,#3e3e42);margin:2px 0}
.lbl{font-size:10px;color:var(--vscode-descriptionForeground);text-transform:uppercase;
     letter-spacing:.08em;margin-bottom:6px;text-align:left;width:100%;max-width:150px}
.pill{display:none;align-items:center;gap:5px;padding:3px 9px;
      border-radius:20px;font-size:11px;font-weight:600;border:1px solid transparent;
      margin-bottom:4px}
.chip{display:none;font-size:10px;color:var(--vscode-descriptionForeground);
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px}
.idle{font-size:11px;color:var(--vscode-descriptionForeground);opacity:.55}
</style></head><body>
<div class="logo">🤖</div>
<h3>Dev Agent</h3>
<p>AI-powered development assistant</p>
<button class="btn" id="o">Open Chat ↗</button>
<hr/>
<div class="lbl">Status</div>
<div class="pill" id="p"></div>
<div class="chip" id="c"></div>
<div class="idle" id="idle">Idle</div>
<script>
const v=acquireVsCodeApi();
document.getElementById('o').onclick=()=>v.postMessage({type:'open_panel'});
const PC={PLANNING:'#7c6af7',ORCHESTRATING:'#7c6af7',RESEARCHING:'#4da6ff',
          SCOPING:'#4da6ff',EXECUTION:'#2ecc8a',WRITING:'#2ecc8a',
          VERIFYING:'#e5a100',REVIEWING:'#e5a100',DEBUGGING:'#e54545'};
window.addEventListener('message',e=>{
  const m=e.data,p=document.getElementById('p'),c=document.getElementById('c'),
        idle=document.getElementById('idle');
  if(m.type==='phase_change'){
    const col=PC[m.phase]||'#888';
    p.style.cssText='display:flex;background:'+col+'1a;color:'+col+';border-color:'+col+'44';
    p.textContent=m.phase||'Working'; idle.style.display='none';
  }
  if(m.type==='tool_call_start'&&m.tool){
    c.style.display='block';
    c.textContent='⚙ '+(m.paramsSummary?m.paramsSummary.slice(0,32):m.tool);
  }
  if(m.type==='tool_call_end') c.style.display='none';
  if(m.type==='session_end'||m.type==='task_complete'){
    p.style.cssText='display:flex;background:#4caf5022;color:#4caf50;border-color:#4caf5044';
    p.textContent='✓ Done'; c.style.display='none'; idle.style.display='none';
  }
});
</script></body></html>`;
  }
}

// Full-featured main editor panel
class DevAgentPanel {
  static currentPanel = null;

  static createOrReveal(context, onMessage) {
    if (DevAgentPanel.currentPanel) {
      DevAgentPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return DevAgentPanel.currentPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      "devAgent.chat", "Dev Agent", vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    DevAgentPanel.currentPanel = new DevAgentPanel(context, panel, onMessage);
    return DevAgentPanel.currentPanel;
  }

  constructor(context, panel, onMessage) {
    this._context = context;
    this._panel = panel;
    panel.webview.options = { enableScripts: true };
    panel.webview.html = this._buildHtml();
    panel.webview.onDidReceiveMessage(onMessage, null, context.subscriptions);
    panel.onDidDispose(() => { DevAgentPanel.currentPanel = null; }, null, context.subscriptions);
  }

  postMessage(msg) { this._panel?.webview.postMessage(msg); }
  reveal() { this._panel?.reveal(vscode.ViewColumn.One); }

  _buildHtml() {
    const providerCards = PROVIDERS.map((p) =>
      `<button class="provider-btn" data-id="${p.id}">${p.label}</button>`,
    ).join("\n      ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Dev Agent</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --r:6px;
  --sb:220px;
  --fg:var(--vscode-editor-foreground);
  --bg:var(--vscode-editor-background);
  --sb-bg:var(--vscode-sideBar-background,color-mix(in srgb,var(--bg) 94%,#000 6%));
  --bd:var(--vscode-panel-border,var(--vscode-widget-border,rgba(128,128,128,.22)));
  --mu:var(--vscode-descriptionForeground);
  --in-bg:var(--vscode-input-background);
  --in-fg:var(--vscode-input-foreground);
  --in-bd:var(--vscode-input-border);
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
button{border:none;border-radius:var(--r);cursor:pointer;font:inherit;
       padding:8px 16px;transition:background .14s,opacity .14s}
.btn-p{background:var(--btn);color:var(--btn-fg)}
.btn-p:hover{background:var(--btn-h)}
.btn-p:disabled{opacity:.45;cursor:not-allowed}
.btn-g{background:transparent;color:var(--mu);border:1px solid var(--bd);
       font-size:12px;padding:5px 10px}
.btn-g:hover{background:var(--hov);color:var(--fg)}
.btn-d{background:transparent;color:var(--err);border:1px solid var(--err);padding:7px 14px}
.btn-d:hover{background:color-mix(in srgb,var(--err) 10%,transparent)}

/* ── setup screen shared ── */
.setup-hdr{padding:20px 32px 16px;border-bottom:1px solid var(--bd);flex-shrink:0}
.setup-hdr strong{display:block;font-size:15px;font-weight:700;margin-bottom:5px}
.setup-hdr p{font-size:13px;color:var(--mu);line-height:1.5}

/* ── screen 1: provider ── */
#scr-select{flex:1;display:flex;flex-direction:column;align-items:center;
            padding:48px 24px 24px;gap:20px;overflow-y:auto}
.sel-inner{width:100%;max-width:520px}
#scr-select h2{font-size:22px;font-weight:700;margin-bottom:8px}
#scr-select .sub{font-size:13px;color:var(--mu);margin-bottom:26px;line-height:1.5}
.provider-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.provider-btn{width:100%;text-align:left;padding:13px 17px;background:transparent;
              border:1px solid var(--bd);border-radius:var(--r);color:var(--fg);
              font-size:13px;font-weight:500;transition:border-color .12s,background .12s}
.provider-btn:hover{background:var(--hov);border-color:var(--foc)}
.provider-btn:disabled{opacity:.45;cursor:not-allowed}
#sel-status{font-size:12px;color:var(--mu);min-height:16px;text-align:center;margin-top:14px}
#sel-status.err{color:var(--err)}

/* ── screen 2: confirm ── */
#scr-confirm{flex:1;display:flex;flex-direction:column;overflow:hidden}
.pcard-wrap{flex:1;overflow-y:auto;padding:20px 32px;
            display:flex;flex-direction:column;gap:10px;max-width:620px;width:100%;margin:0 auto}
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
          font:inherit;cursor:pointer;font-size:12px}
.btn-conf:hover{background:color-mix(in srgb,#4caf50 24%,transparent)}
.btn-skip{background:transparent;color:var(--mu);border:1px solid var(--bd);
          border-radius:var(--r);padding:5px 11px;font:inherit;cursor:pointer;font-size:12px}
.btn-skip:hover{background:var(--hov)}

/* ── screen 3: project ── */
#scr-project{flex:1;display:flex;flex-direction:column;overflow:hidden}
.proj-wrap{flex:1;overflow-y:auto;padding:20px 32px;
           display:flex;flex-direction:column;gap:8px;max-width:620px;width:100%;margin:0 auto}
.proj-lbl{font-size:11px;color:var(--mu);text-transform:uppercase;
          letter-spacing:.07em;padding:4px 0 2px}
.proj-card{display:flex;align-items:center;gap:12px;padding:12px 16px;
           border:1px solid var(--bd);border-radius:var(--r);
           cursor:pointer;transition:border-color .12s,background .12s}
.proj-card:hover{background:var(--hov);border-color:var(--foc)}
.pi{font-size:17px;flex-shrink:0}
.pinfo{flex:1;min-width:0}
.pname{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ppath{font-size:11px;color:var(--mu);white-space:nowrap;overflow:hidden;
       text-overflow:ellipsis;margin-top:2px}
.parr{font-size:14px;color:var(--mu);flex-shrink:0}
.proj-acts{display:flex;gap:10px;padding:12px 32px 16px;border-top:1px solid var(--bd);
           max-width:620px;width:100%;margin:0 auto}
.btn-act{display:flex;align-items:center;gap:8px;padding:10px 16px;background:transparent;
         border:1px solid var(--bd);border-radius:var(--r);color:var(--fg);
         font:inherit;font-size:12px;cursor:pointer;transition:background .12s,border-color .12s;
         flex:1;justify-content:center}
.btn-act:hover{background:var(--hov);border-color:var(--foc)}

/* ══════════════════════════════════════════════
   SCREEN 4 — two-column chat layout
══════════════════════════════════════════════ */
#scr-chat{flex:1;display:flex;flex-direction:row;overflow:hidden}

/* ── left sidebar ── */
#chat-sb{
  width:var(--sb);min-width:var(--sb);
  display:flex;flex-direction:column;
  border-right:1px solid var(--bd);
  background:var(--sb-bg);
  overflow:hidden;
}

/* Sessions section — takes remaining height */
#sb-sessions{
  flex:1;display:flex;flex-direction:column;
  overflow:hidden;border-bottom:1px solid var(--bd);
}
.sb-hdr{
  display:flex;align-items:center;justify-content:space-between;
  padding:9px 12px 7px;flex-shrink:0;
}
.sb-hdr-title{
  font-size:10px;font-weight:700;text-transform:uppercase;
  letter-spacing:.08em;color:var(--mu);
}
.sb-icon-btn{
  display:flex;align-items:center;justify-content:center;
  width:20px;height:20px;border-radius:4px;
  background:transparent;color:var(--mu);
  cursor:pointer;font-size:15px;line-height:1;
  border:none;padding:0;flex-shrink:0;
  transition:background .12s,color .12s;
}
.sb-icon-btn:hover{background:var(--hov);color:var(--fg)}
#session-list{flex:1;overflow-y:auto;padding:3px 5px 5px}
.sb-empty{font-size:11px;color:var(--mu);text-align:center;padding:16px 8px;opacity:.55;font-style:italic}

/* session items */
.sitem{
  display:flex;align-items:flex-start;gap:7px;
  padding:7px 8px;border-radius:5px;cursor:pointer;
  background:transparent;border:1px solid transparent;
  width:100%;text-align:left;transition:background .12s;
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

/* ── project section ── */
#sb-project{flex-shrink:0;border-bottom:1px solid var(--bd)}
.sb-body{padding:4px 12px 10px}
.sb-name-row{display:flex;align-items:center;gap:5px;margin-bottom:2px}
.sb-name-icon{font-size:13px;flex-shrink:0}
.sb-name-text{font-size:12px;font-weight:600;white-space:nowrap;
              overflow:hidden;text-overflow:ellipsis;flex:1}
.sb-subtext{font-size:10px;color:var(--mu);white-space:nowrap;overflow:hidden;
            text-overflow:ellipsis;margin-bottom:7px;padding-left:18px}
.sb-btn{width:100%;text-align:center;font-size:11px;color:var(--mu);
        background:transparent;border:1px solid var(--bd);border-radius:4px;
        padding:4px 8px;cursor:pointer;transition:background .12s,color .12s;
        display:flex;align-items:center;gap:5px;justify-content:center}
.sb-btn:hover{background:var(--hov);color:var(--fg)}

/* ── provider section ── */
#sb-provider{flex-shrink:0}
.sb-prov-row{display:flex;align-items:center;gap:7px;margin-bottom:7px}
.conn-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;background:var(--ck)}
.conn-dot.off{background:var(--mu);opacity:.4}
.prov-name-text{font-size:12px;font-weight:500;
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}

/* ── main area ── */
#chat-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}

/* ── phase bar ── */
#phase-bar{
  flex-shrink:0;padding:12px 20px 10px;border-bottom:1px solid var(--bd);
  background:color-mix(in srgb,var(--bg) 93%,var(--foc) 7%);
}
.phase-steps{display:flex;align-items:flex-start;margin-bottom:10px;max-width:480px}
.phase-step{display:flex;flex-direction:column;align-items:center;gap:4px;
            flex:1;position:relative}
.sdot{width:22px;height:22px;border-radius:50%;border:2px solid var(--bd);
      background:var(--bg);display:flex;align-items:center;justify-content:center;
      font-size:10px;font-weight:700;transition:all .3s;z-index:1;flex-shrink:0}
.phase-step.done .sdot{background:var(--ck);border-color:var(--ck);color:#fff}
.phase-step.active .sdot{
  border-color:var(--sc);
  background:color-mix(in srgb,var(--sc) 15%,transparent);
  color:var(--sc);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--sc) 15%,transparent);
}
.slabel{font-size:9px;font-weight:500;color:var(--mu);text-align:center;white-space:nowrap}
.phase-step.active .slabel{color:var(--sc);font-weight:700}
.phase-step.done .slabel{color:var(--ck)}
.sline{flex:1;height:2px;background:var(--bd);margin-top:10px;transition:background .4s}
.sline.done{background:var(--ck)}
.phase-status{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--mu)}
.spinner{display:inline-block;width:12px;height:12px;border:2px solid var(--bd);
         border-top-color:var(--foc);border-radius:50%;animation:spin .65s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}
#phase-lbl{flex:1}
.tool-chip{display:none;align-items:center;gap:4px;padding:2px 8px;
           background:var(--hov);border-radius:20px;font-size:11px;color:var(--mu);
           max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}

/* ── messages ── */
#messages{flex:1;overflow-y:auto;padding:18px 22px;
          display:flex;flex-direction:column;gap:3px;scroll-behavior:smooth}

/* welcome empty state */
#welcome{
  flex:1;display:flex;flex-direction:column;
  align-items:center;justify-content:center;
  text-align:center;padding:40px 28px;color:var(--mu);
}
.w-logo{font-size:40px;margin-bottom:16px}
.w-title{font-size:19px;font-weight:600;color:var(--fg);margin-bottom:8px;letter-spacing:-.3px}
.w-sub{font-size:12px;line-height:1.6;margin-bottom:28px;max-width:320px}
.w-examples{display:grid;grid-template-columns:1fr 1fr;gap:9px;max-width:520px;width:100%}
.w-ex{text-align:left;padding:11px 14px;background:transparent;
      border:1px solid var(--bd);border-radius:var(--r);color:var(--mu);
      font:inherit;font-size:12px;cursor:pointer;line-height:1.4;
      transition:border-color .12s,background .12s,color .12s}
.w-ex:hover{background:var(--hov);border-color:var(--foc);color:var(--fg)}

/* timestamps + senders */
.mtime{font-size:10px;color:var(--mu);opacity:.5;flex-shrink:0}
.msend{font-size:11px;font-weight:600;color:var(--mu)}

/* user bubble */
.msg-u{display:flex;flex-direction:column;align-items:flex-end;gap:4px;margin:14px 0 4px}
.muh{display:flex;align-items:center;gap:8px}
.mub{background:var(--btn);color:var(--btn-fg);padding:9px 14px;
     border-radius:14px 14px 3px 14px;font-size:13px;line-height:1.6;
     white-space:pre-wrap;word-break:break-word;max-width:78%}

/* Claude-style agent message — no bubble, avatar + flowing text */
.msg-a{display:flex;align-items:flex-start;gap:11px;margin:16px 0 6px}
.av-a{width:26px;height:26px;border-radius:50%;
      background:color-mix(in srgb,var(--cp) 85%,#000 15%);
      color:#fff;display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;flex-shrink:0;margin-top:1px;letter-spacing:-.3px}
.mab-md{flex:1;font-size:13px;line-height:1.65;min-width:0;color:var(--fg)}

/* Markdown body styles */
.mab-md .md-p{margin:0 0 4px}
.mab-md .md-br{height:6px}
.mab-md h1{font-size:16px;font-weight:700;margin:14px 0 5px;color:var(--fg)}
.mab-md h2{font-size:15px;font-weight:700;margin:12px 0 4px;color:var(--fg)}
.mab-md h3{font-size:14px;font-weight:700;margin:10px 0 4px;color:var(--fg)}
.mab-md h1.md-h:first-child,.mab-md h2.md-h:first-child,.mab-md h3.md-h:first-child{margin-top:0}
.mab-md ul,.mab-md ol{padding-left:22px;margin:4px 0 8px}
.mab-md li{margin:3px 0;line-height:1.6}
.mab-md strong{font-weight:700}
.mab-md em{font-style:italic}
.ic{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;
    background:color-mix(in srgb,var(--fg) 10%,transparent);
    padding:1px 5px;border-radius:3px;word-break:break-all}

/* Code blocks */
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

/* File preview card */
.fp-card{border:1px solid var(--bd);border-left:3px solid var(--ce);border-radius:6px;
         overflow:hidden;margin:10px 0;animation:tIn .16s ease}
.fp-hdr{display:flex;align-items:center;gap:8px;padding:8px 12px;
        background:color-mix(in srgb,var(--ce) 6%,transparent);
        border-bottom:1px solid var(--bd)}
.fp-icon{font-size:14px;flex-shrink:0}
.fp-path{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;
         font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fp-meta{font-size:10px;color:var(--mu);flex-shrink:0;white-space:nowrap}
.fp-actions{display:flex;gap:5px;align-items:center;flex-shrink:0}
.fp-btn{background:transparent;color:var(--mu);border:1px solid var(--bd);
        padding:2px 8px;border-radius:4px;font-size:11px;cursor:pointer;transition:background .12s,color .12s}
.fp-btn:hover{background:var(--hov);color:var(--fg)}
.fp-body{overflow-x:auto;max-height:260px;overflow-y:auto}
.fp-pre{padding:10px 14px;margin:0}
.fp-pre code{font-family:var(--vscode-editor-font-family,monospace);font-size:11px;
             white-space:pre;color:var(--fg);line-height:1.5}
.fp-trunc{font-size:10px;color:var(--mu);padding:4px 14px 7px;
          font-style:italic;border-top:1px solid var(--bd)}

/* system / error */
.msg-sys{font-size:11px;color:var(--mu);font-style:italic;
         text-align:center;padding:2px 0;opacity:.65}
.msg-err{font-size:12px;color:var(--err);display:flex;align-items:center;gap:6px;
         padding:7px 12px;background:color-mix(in srgb,var(--err) 8%,transparent);
         border:1px solid color-mix(in srgb,var(--err) 22%,transparent);
         border-radius:var(--r);margin:3px 0}

/* phase divider */
.pdiv{display:flex;align-items:center;gap:10px;margin:13px 0 5px;opacity:.8}
.pdiv.repeat{opacity:.35;margin:6px 0 3px}
.pdiv.repeat .pdlabel{font-size:9px;padding:1px 8px}
.pdline{flex:1;height:1px;background:var(--bd)}
.pdlabel{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;
         padding:2px 10px;border-radius:20px;border:1px solid transparent;white-space:nowrap}

/* tool cards — individual (writes / runs) */
.tcrd{display:flex;align-items:center;gap:7px;padding:5px 11px;
      border-radius:5px;border:1px solid var(--bd);
      border-left:3px solid var(--tc,var(--bd));
      background:color-mix(in srgb,var(--tc,var(--bd)) 5%,var(--bg));
      font-size:12px;max-width:460px;margin:2px 0;animation:tIn .16s ease}
@keyframes tIn{from{opacity:0;transform:translateX(-4px)}to{opacity:1;transform:none}}
.tcrd.pending{opacity:.6}
.tcrd.error{--tc:var(--err)}
.tc-ico{font-size:12px;flex-shrink:0}
.tc-name{font-size:10px;color:var(--mu);flex-shrink:0;min-width:52px;
         text-transform:uppercase;letter-spacing:.04em}
.tc-file{font-size:12px;font-family:var(--vscode-editor-font-family,monospace);
         flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-st{font-size:11px;flex-shrink:0;color:var(--mu)}

/* read-group card — collapses multiple reads into one row */
.rg-card{border:1px solid var(--bd);border-left:3px solid var(--cr);border-radius:5px;
         background:color-mix(in srgb,var(--cr) 5%,var(--bg));
         font-size:12px;max-width:460px;margin:2px 0;animation:tIn .16s ease}
.rg-hdr{display:flex;align-items:center;gap:7px;padding:5px 11px;
        cursor:pointer;user-select:none;border-radius:5px}
.rg-hdr:hover{background:color-mix(in srgb,var(--cr) 8%,transparent)}
.rg-caret{font-size:10px;color:var(--mu);margin-left:auto;
          transition:transform .2s;flex-shrink:0}
.rg-card.open .rg-caret{transform:rotate(180deg)}
.rg-list{display:none;flex-direction:column;gap:1px;
         padding:2px 11px 8px 38px}
.rg-card.open .rg-list{display:flex}
.rg-item{font-size:11px;font-family:var(--vscode-editor-font-family,monospace);
         color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 0}

/* typing dots */
#typing{display:none;align-items:center;gap:9px;padding:5px 0;font-size:12px;color:var(--mu)}
.tdots{display:flex;gap:4px;align-items:center}
.tdots span{width:6px;height:6px;border-radius:50%;background:var(--mu);animation:tb .9s infinite}
.tdots span:nth-child(2){animation-delay:.18s}
.tdots span:nth-child(3){animation-delay:.36s}
@keyframes tb{0%,60%,100%{transform:translateY(0);opacity:.3}30%{transform:translateY(-5px);opacity:1}}

/* done banner */
.done-banner{display:flex;align-items:center;justify-content:center;gap:8px;
             padding:9px 16px;margin:8px 0;border-radius:var(--r);
             background:color-mix(in srgb,var(--ck) 10%,transparent);
             border:1px solid color-mix(in srgb,var(--ck) 26%,transparent);
             color:var(--ck);font-size:13px;font-weight:600}

/* ── input area ── */
.inp-area{padding:12px 20px 14px;border-top:1px solid var(--bd);flex-shrink:0}
.inp-row{display:flex;gap:9px;align-items:flex-end}
#prompt{flex:1;background:var(--in-bg);color:var(--in-fg);
        border:1px solid var(--in-bd,var(--bd));padding:9px 12px;
        border-radius:var(--r);font:inherit;font-size:13px;resize:none;
        line-height:1.5;min-height:42px;max-height:160px;overflow-y:auto}
#prompt:focus{outline:1px solid var(--foc);outline-offset:-1px}
.inp-hint{font-size:11px;color:var(--mu);margin-top:5px;opacity:.5}
</style>
</head>
<body>

<!-- ─── screen 1: provider selection ─── -->
<div id="scr-select">
  <div class="sel-inner">
    <h2>🤖 Dev Agent</h2>
    <p class="sub">AI-powered development assistant.<br>Choose a provider to get started.</p>
    <div class="provider-grid">
      ${providerCards}
    </div>
    <div id="sel-status"></div>
  </div>
</div>

<!-- ─── screen 2: browser confirmation ─── -->
<div id="scr-confirm" class="hidden">
  <div class="setup-hdr">
    <strong>Browser setup</strong>
    <p>Log into each provider in Chrome, then confirm below.</p>
  </div>
  <div class="pcard-wrap" id="pcard-list"></div>
</div>

<!-- ─── screen 3: project selection ─── -->
<div id="scr-project" class="hidden">
  <div class="setup-hdr">
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

<!-- ─── screen 4: chat — two-column layout ─── -->
<div id="scr-chat" class="hidden">

  <!-- LEFT SIDEBAR -->
  <nav id="chat-sb">

    <!-- Sessions -->
    <div id="sb-sessions">
      <div class="sb-hdr">
        <span class="sb-hdr-title">Sessions</span>
        <button class="sb-icon-btn" id="btn-new-chat" title="New chat">＋</button>
      </div>
      <div id="session-list"></div>
    </div>

    <!-- Project -->
    <div id="sb-project">
      <div class="sb-hdr">
        <span class="sb-hdr-title">Project</span>
      </div>
      <div class="sb-body">
        <div class="sb-name-row">
          <span class="sb-name-icon">🗂</span>
          <span class="sb-name-text" id="sb-proj-name">—</span>
        </div>
        <div class="sb-subtext" id="sb-proj-path">Not selected</div>
        <button class="sb-btn" id="btn-sb-proj">📂 Change folder</button>
      </div>
    </div>

    <!-- Provider -->
    <div id="sb-provider">
      <div class="sb-hdr">
        <span class="sb-hdr-title">Provider</span>
      </div>
      <div class="sb-body">
        <div class="sb-prov-row">
          <div class="conn-dot" id="sb-conn-dot"></div>
          <span class="prov-name-text" id="sb-prov-name">—</span>
        </div>
        <button class="sb-btn" id="btn-sb-prov">↩ Change provider</button>
      </div>
    </div>

  </nav><!-- #chat-sb -->

  <!-- MAIN AREA -->
  <div id="chat-main">

    <!-- Phase progress bar (hidden when idle) -->
    <div id="phase-bar" class="hidden">
      <div class="phase-steps" id="phase-steps"></div>
      <div class="phase-status">
        <span class="spinner"></span>
        <span id="phase-lbl">Starting…</span>
        <div class="tool-chip" id="tool-chip"></div>
      </div>
    </div>

    <!-- Messages + welcome state -->
    <div id="messages">
      <div id="welcome">
        <div class="w-logo">🤖</div>
        <div class="w-title">What can I help you build?</div>
        <div class="w-sub">Describe a task and the agent will plan, code, and verify it.</div>
        <div class="w-examples">
          <button class="w-ex" data-prompt="Add dark mode support to the app">Add dark mode support to the app</button>
          <button class="w-ex" data-prompt="Write unit tests for the main module">Write unit tests for the main module</button>
          <button class="w-ex" data-prompt="Fix all TypeScript errors in the project">Fix all TypeScript errors in the project</button>
          <button class="w-ex" data-prompt="Refactor the API layer to use async/await">Refactor the API layer to use async/await</button>
        </div>
      </div>
      <div id="typing">
        <div class="tdots"><span></span><span></span><span></span></div>
        <span>Agent is thinking…</span>
      </div>
    </div>

    <!-- Input -->
    <div class="inp-area">
      <div class="inp-row">
        <textarea id="prompt" rows="2" placeholder="Ask Dev Agent to do something…"></textarea>
        <button class="btn-p" id="btn-send">Send ▶</button>
        <button class="btn-d hidden" id="btn-stop">■ Stop</button>
      </div>
      <div class="inp-hint">Enter to send · Shift+Enter for new line</div>
    </div>

  </div><!-- #chat-main -->

</div><!-- #scr-chat -->

<script>
const vscode = acquireVsCodeApi();

/* ── element refs ── */
const scrSelect  = document.getElementById('scr-select');
const scrConfirm = document.getElementById('scr-confirm');
const scrProject = document.getElementById('scr-project');
const scrChat    = document.getElementById('scr-chat');
const selStatus  = document.getElementById('sel-status');
const pcardList  = document.getElementById('pcard-list');
const projBody   = document.getElementById('proj-body');
const messages   = document.getElementById('messages');
const typingEl   = document.getElementById('typing');
const welcomeEl  = document.getElementById('welcome');
const phaseBar   = document.getElementById('phase-bar');
const phaseLbl   = document.getElementById('phase-lbl');
const toolChip   = document.getElementById('tool-chip');
const prompt     = document.getElementById('prompt');
const btnSend    = document.getElementById('btn-send');
const btnStop    = document.getElementById('btn-stop');
const sessionList= document.getElementById('session-list');
const sbProjName = document.getElementById('sb-proj-name');
const sbProjPath = document.getElementById('sb-proj-path');
const sbProvName = document.getElementById('sb-prov-name');
const ALL_SCRS   = [scrSelect, scrConfirm, scrProject, scrChat];

/* ── screen helpers ── */
function show(s){ ALL_SCRS.forEach(x=>x.classList.add('hidden')); s.classList.remove('hidden'); }
function setSelStatus(t,e){ selStatus.textContent=t; selStatus.className=e?'err':''; }
function ts(){ return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function relTime(d){
  const s=Math.floor((Date.now()-d)/1000);
  if(s<5)  return 'just now';
  if(s<60) return s+'s ago';
  if(s<3600) return Math.floor(s/60)+'m ago';
  if(s<86400) return Math.floor(s/3600)+'h ago';
  return Math.floor(s/86400)+'d ago';
}

/* ══════════════════════════════════════
   MARKDOWN RENDERER
══════════════════════════════════════ */
let _cbSeq = 0;

function renderCodeBlock(code, lang) {
  const escaped = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return '<div class="cb"><div class="cb-hdr">'
    + (lang ? '<span class="cb-lang">'+esc(lang)+'</span>' : '<span></span>')
    + '<button class="cb-copy" onclick="copyCode(this)">Copy</button>'
    + '</div><pre class="cb-pre"><code>'+escaped+'</code></pre></div>';
}

function renderMarkdown(md) {
  if (!md) return '';
  // 1. Extract code fences, replace with non-HTML placeholder
  const blocks = [];
  let text = md.replace(/\`\`\`([\w]*)\n?([\s\S]*?)\`\`\`/g, (_, lang, code) => {
    const key = ' '+(blocks.length)+' ';
    blocks.push({lang: lang.trim(), code: code.replace(/\n$/, '')});
    return key;
  });
  // 2. HTML-escape non-code text
  text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // 3. Inline formatting (bold before italic to avoid partial matches)
  text = text
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\`([^\`]+)\`/g, '<code class="ic">$1</code>');
  // 4. Process lines: headers, lists, paragraphs
  const lines = text.split('\n');
  const out = [];
  let inList = null;
  const closeList = () => { if (inList) { out.push('</'+inList+'>'); inList = null; } };
  for (const line of lines) {
    const hm = line.match(/^(#{1,3}) (.+)/);
    const ulm = line.match(/^[-*] (.+)/);
    const olm = line.match(/^\d+\. (.+)/);
    if (hm) {
      closeList();
      const lv = hm[1].length;
      out.push('<h'+lv+' class="md-h">'+hm[2]+'</h'+lv+'>');
    } else if (ulm) {
      if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
      out.push('<li>'+ulm[1]+'</li>');
    } else if (olm) {
      if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; }
      out.push('<li>'+olm[1]+'</li>');
    } else if (!line.trim()) {
      closeList(); out.push('<div class="md-br"></div>');
    } else {
      closeList(); out.push('<div class="md-p">'+line+'</div>');
    }
  }
  closeList();
  text = out.join('');
  // 5. Restore code blocks
  blocks.forEach((b, i) => {
    text = text.replace(' '+i+' ', renderCodeBlock(b.code, b.lang));
  });
  return text;
}

function copyCode(btn) {
  const code = btn.closest('.cb').querySelector('pre code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

/* ══════════════════════════════════════
   FILE PREVIEW
══════════════════════════════════════ */
const EXT_ICON = {
  js:'🟨',ts:'🔷',jsx:'🟨',tsx:'🔷',py:'🐍',json:'📋',html:'🌐',
  css:'🎨',md:'📝',sh:'⚡',yml:'⚙',yaml:'⚙',rs:'🦀',go:'🐹',
  java:'☕',rb:'💎',c:'⚙',cpp:'⚙',cs:'💜',php:'🐘',swift:'🍎',
};

function addFilePreview(data) {
  const icon = EXT_ICON[(data.ext||'').toLowerCase()] || '📄';
  const escaped = (data.content||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const d = document.createElement('div');
  d.className = 'fp-card';
  d.innerHTML = '<div class="fp-hdr">'
    + '<span class="fp-icon">'+icon+'</span>'
    + '<span class="fp-path">'+esc(data.relPath||data.filePath)+'</span>'
    + (data.lines ? '<span class="fp-meta">'+data.lines+' lines</span>' : '')
    + '<div class="fp-actions">'
    + '<button class="fp-btn" onclick="copyFpCode(this)">Copy</button>'
    + '<button class="fp-btn" data-fp="'+esc(data.filePath)+'" onclick="openFile(this.dataset.fp)">Open ↗</button>'
    + '</div></div>'
    + '<div class="fp-body"><pre class="fp-pre"><code>'+escaped+'</code></pre></div>'
    + (data.truncated ? '<div class="fp-trunc">Showing first 8 000 chars…</div>' : '');
  ibt(d);
}

function copyFpCode(btn) {
  const code = btn.closest('.fp-card').querySelector('pre code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

function openFile(p) {
  vscode.postMessage({type:'open_file', path:p});
}

/* ══════════════════════════════════════
   SESSION MANAGEMENT
══════════════════════════════════════ */
const sessions     = []; // {id, prompt, ts, status:'running'|'done'|'error'|'stopped', html:''}
let activeSid      = null;
let runningSid     = null;
let sessionLocked  = false;
let sidSeq         = 0;

function createSession(promptText){
  if(activeSid !== null) saveSession(activeSid);
  const id = ++sidSeq;
  sessions.unshift({id, prompt:promptText.slice(0,80), ts:new Date(), status:'running', html:''});
  activeSid = id; runningSid = id; sessionLocked = true;
  clearMsgs(); hideWelcome();
  renderSessions();
  return id;
}

function finishSession(status){
  const s=sessions.find(x=>x.id===runningSid);
  if(s) s.status=status;
  saveSession(activeSid);
  runningSid=null; sessionLocked=false;
  renderSessions();
}

function switchSession(id){
  if(sessionLocked||id===activeSid) return;
  saveSession(activeSid);
  activeSid=id;
  clearMsgs();
  const s=sessions.find(x=>x.id===id);
  if(s?.html){
    const tmp=document.createElement('div');
    tmp.innerHTML=s.html;
    while(tmp.firstChild) messages.insertBefore(tmp.firstChild, typingEl);
    hideWelcome();
  } else {
    showWelcome();
  }
  scrollMsgs();
  renderSessions();
}

function newChat(){
  if(sessionLocked) return;
  if(activeSid!==null) saveSession(activeSid);
  activeSid=null;
  clearMsgs(); showWelcome(); hideTyping();
  phaseBar.classList.add('hidden');
  currentStepIdx=-1; lastPhase=''; readBuf=[];
  resetDividers();
  btnSend.classList.remove('hidden'); btnStop.classList.add('hidden');
  renderSessions();
  prompt.focus();
}

function saveSession(id){
  const s=sessions.find(x=>x.id===id); if(!s) return;
  const parts=[];
  for(const n of messages.children){
    if(n===typingEl||n===welcomeEl) continue;
    parts.push(n.outerHTML);
  }
  s.html=parts.join('');
}

function clearMsgs(){
  Array.from(messages.children).forEach(n=>{
    if(n!==typingEl&&n!==welcomeEl) n.remove();
  });
}

function showWelcome(){ welcomeEl.style.display=''; }
function hideWelcome(){ welcomeEl.style.display='none'; }

function renderSessions(){
  if(!sessions.length){
    sessionList.innerHTML='<div class="sb-empty">No sessions yet</div>';
    return;
  }
  sessionList.innerHTML='';
  sessions.forEach(s=>{
    const btn=document.createElement('button');
    btn.className='sitem'+(s.id===activeSid?' active':'');
    if(sessionLocked&&s.id!==activeSid) btn.disabled=true;
    btn.innerHTML='<div class="s-dot '+s.status+'"></div>'
      +'<div class="s-body">'
      +'<div class="s-prompt">'+esc(s.prompt)+'</div>'
      +'<div class="s-meta">'+relTime(s.ts)+'</div>'
      +'</div>';
    btn.addEventListener('click',()=>switchSession(s.id));
    sessionList.appendChild(btn);
  });
}

// Refresh relative timestamps every 30s
setInterval(renderSessions, 30000);

/* ── scroll / typing ── */
function scrollMsgs(){ messages.scrollTop=messages.scrollHeight; }
function ibt(el){ if(el) messages.insertBefore(el,typingEl); scrollMsgs(); }
function showTyping(){ ibt(null); typingEl.style.display='flex'; scrollMsgs(); }
function hideTyping(){ typingEl.style.display='none'; }

/* ── phase stepper ── */
const STEPS=[
  {label:'Planning',   phases:['PLANNING','ORCHESTRATING'],         color:'var(--cp)'},
  {label:'Researching',phases:['RESEARCHING','SCOPING'],             color:'var(--cr)'},
  {label:'Executing',  phases:['EXECUTION','WRITING'],               color:'var(--ce)'},
  {label:'Verifying',  phases:['VERIFYING','REVIEWING','DEBUGGING'], color:'var(--cv)'},
  {label:'Done',       phases:[],                                    color:'var(--ck)'},
];
let currentStepIdx=-1, lastPhase='';

(function(){
  const c=document.getElementById('phase-steps');
  STEPS.forEach((s,i)=>{
    const d=document.createElement('div');
    d.className='phase-step'; d.id='st'+i;
    d.innerHTML='<div class="sdot" id="sd'+i+'">'+(i+1)+'</div>'
      +'<div class="slabel">'+s.label+'</div>';
    c.appendChild(d);
    if(i<STEPS.length-1){
      const l=document.createElement('div');
      l.className='sline'; l.id='sl'+i;
      c.appendChild(l);
    }
  });
})();

function setStep(idx,isDbg){
  if(idx===currentStepIdx&&!isDbg) return;
  currentStepIdx=idx;
  STEPS.forEach((_,i)=>{
    const se=document.getElementById('st'+i);
    const de=document.getElementById('sd'+i);
    const le=document.getElementById('sl'+i);
    if(i<idx){
      se.className='phase-step done'; de.textContent='✓';
      if(le) le.className='sline done';
    } else if(i===idx){
      const c=isDbg?'var(--cd)':STEPS[i].color;
      se.className='phase-step active'; se.style.setProperty('--sc',c);
      de.textContent=i+1;
      if(le) le.className='sline';
    } else {
      se.className='phase-step'; se.style.removeProperty('--sc');
      de.textContent=i+1;
      if(le) le.className='sline';
    }
  });
}
function phaseToStep(p){
  for(let i=0;i<STEPS.length;i++) if(STEPS[i].phases.includes(p)) return i;
  return -1;
}

/* ── phase dividers ── */
const PM={
  PLANNING:     {icon:'📋',label:'PLANNING',     color:'var(--cp)'},
  ORCHESTRATING:{icon:'🎯',label:'ORCHESTRATING',color:'var(--cp)'},
  RESEARCHING:  {icon:'🔬',label:'RESEARCHING',  color:'var(--cr)'},
  SCOPING:      {icon:'🗺', label:'SCOPING',      color:'var(--cr)'},
  EXECUTION:    {icon:'⚡',label:'EXECUTING',    color:'var(--ce)'},
  WRITING:      {icon:'✏️',label:'WRITING',      color:'var(--ce)'},
  VERIFYING:    {icon:'🧪',label:'VERIFYING',    color:'var(--cv)'},
  REVIEWING:    {icon:'👀',label:'REVIEWING',    color:'var(--cv)'},
  DEBUGGING:    {icon:'🐛',label:'DEBUGGING',    color:'var(--cd)'},
};
let lastDividerPhase='';
const seenPhases=new Map(); // phase → count shown
function addPhaseDivider(phase){
  if(phase===lastDividerPhase) return;
  lastDividerPhase=phase;
  const m=PM[phase]; if(!m) return;
  const n=(seenPhases.get(phase)||0)+1;
  seenPhases.set(phase,n);
  if(n>3) return; // suppress after 3rd occurrence — pipeline is looping
  const isRepeat=n>1;
  const d=document.createElement('div');
  d.className='pdiv'+(isRepeat?' repeat':'');
  const labelTxt=isRepeat?m.icon+' '+m.label+' ×'+n:m.icon+' '+m.label;
  d.innerHTML='<div class="pdline"></div>'
    +'<div class="pdlabel" style="color:'+m.color+';border-color:'+m.color+'33;'
    +'background:color-mix(in srgb,'+m.color+' 8%,transparent)">'+labelTxt+'</div>'
    +'<div class="pdline"></div>';
  ibt(d);
}
function resetDividers(){
  lastDividerPhase=''; seenPhases.clear();
}

/* ── tool cards ── */
let pendingCard=null;
// Pending read accumulator — flushed when a non-read tool arrives or phase changes
let readBuf=[];

function toolStyle(n){
  const t=(n||'').toLowerCase();
  if(/read|list|search|glob|get|find|cat|view|ls/.test(t))
    return{icon:'📖',color:'var(--cr)',label:'read'};
  if(/write|creat|patch|edit|updat|delet|remov|modif|apply|put/.test(t))
    return{icon:'✏️',color:'var(--ce)',label:'write'};
  if(/run|exec|bash|shell|command|cmd|spawn|npm|test/.test(t))
    return{icon:'⚡',color:'var(--cv)',label:'run'};
  return{icon:'🔧',color:'#888',label:'tool'};
}

function flushReads(){
  if(!readBuf.length) return;
  if(readBuf.length===1){
    // Single read — compact resolved card (no pending state needed)
    const c=document.createElement('div'); c.className='tcrd';
    c.style.setProperty('--tc','var(--cr)');
    c.innerHTML='<span class="tc-ico">📖</span>'
      +'<span class="tc-name">read</span>'
      +'<span class="tc-file">'+esc((readBuf[0].s||readBuf[0].n).slice(0,80))+'</span>'
      +'<span class="tc-st">✓</span>';
    ibt(c);
  } else {
    // Multiple reads — collapsible group
    const g=document.createElement('div'); g.className='rg-card';
    const items=readBuf.map(r=>'<div class="rg-item">'+esc((r.s||r.n).slice(0,70))+'</div>').join('');
    g.innerHTML='<div class="rg-hdr" onclick="this.parentElement.classList.toggle(\'open\')">'
      +'<span class="tc-ico">📖</span>'
      +'<span class="tc-name">read</span>'
      +'<span class="tc-file">'+readBuf.length+' files</span>'
      +'<span class="rg-caret">▾</span>'
      +'</div>'
      +'<div class="rg-list">'+items+'</div>';
    ibt(g);
  }
  readBuf=[];
}

function addToolCard(name,summary){
  flushReads(); // flush any buffered reads before showing a write/run
  const s=toolStyle(name);
  const c=document.createElement('div'); c.className='tcrd pending';
  c.style.setProperty('--tc',s.color);
  c.innerHTML='<span class="tc-ico">'+s.icon+'</span>'
    +'<span class="tc-name">'+s.label+'</span>'
    +'<span class="tc-file">'+esc(summary?summary.slice(0,80):name)+'</span>'
    +'<span class="tc-st">…</span>';
  ibt(c); pendingCard=c;
}
function resolveCard(isErr){
  if(!pendingCard) return;
  pendingCard.classList.remove('pending');
  if(isErr) pendingCard.classList.add('error');
  pendingCard.querySelector('.tc-st').textContent=isErr?'✗':'✓';
  pendingCard=null;
}

/* ── message helpers ── */
function addUserMsg(text){
  const d=document.createElement('div'); d.className='msg-u';
  d.innerHTML='<div class="muh"><span class="mtime">'+ts()+'</span>'
    +'<span class="msend">You</span></div>'
    +'<div class="mub">'+esc(text)+'</div>';
  ibt(d);
}
function addAgentMsg(text){
  if(!text?.trim()) return;
  const d=document.createElement('div'); d.className='msg-a';
  d.innerHTML='<div class="av-a">A</div>'
    +'<div class="mab-md">'+renderMarkdown(text)+'</div>';
  ibt(d);
}
function addSysMsg(text,isErr){
  if(!text) return;
  const d=document.createElement('div');
  d.className=isErr?'msg-err':'msg-sys';
  d.textContent=isErr?'⚠ '+text:text;
  ibt(d);
}
function addDoneBanner(){
  const d=document.createElement('div'); d.className='done-banner';
  d.innerHTML='<span>✅</span><span>Task complete</span>';
  ibt(d);
}

/* ── provider selection (screen 1) ── */
document.querySelectorAll('.provider-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.provider-btn').forEach(b=>b.disabled=true);
    setSelStatus('Launching browser automation…');
    vscode.postMessage({type:'launch_bridge',providers:[btn.dataset.id]});
  });
});

/* ── provider cards (screen 2) ── */
let pcards={};
function buildCards(providers){
  pcardList.innerHTML=''; pcards={};
  providers.forEach(({id,label})=>{
    const el=document.createElement('div'); el.className='pcard'; el.dataset.id=id;
    el.innerHTML=\`<div class="pcard-head">
      <div class="dot waiting" data-dot></div>
      <span class="pcard-name">\${label}</span>
      <span class="pcard-tag" data-tag>Waiting…</span>
    </div>
    <div class="pcard-body hidden" data-body></div>\`;
    pcardList.appendChild(el); pcards[id]={el,phase:'waiting'};
  });
}
function setCardPending(id,det){
  const c=pcards[id]; if(!c) return;
  c.phase='pending';
  c.el.querySelector('[data-dot]').className='dot pending';
  c.el.querySelector('[data-tag]').textContent='Needs confirmation';
  const b=c.el.querySelector('[data-body]'); b.classList.remove('hidden');
  b.innerHTML=\`<div class="\${det?'det-y':'det-n'}">\${det?'✓ Interface detected in Chrome':'⚠ Not detected — log in if needed'}</div>
    <div class="conf-hint">Confirm once the chat interface is visible in Chrome.</div>
    <div class="conf-btns">
      <button class="btn-conf" onclick="confirmCard()">✓ Confirm Ready</button>
      <button class="btn-skip" onclick="skipCard()">Skip</button>
    </div>\`;
}
function setCardDone(id,action){
  const c=pcards[id]; if(!c) return;
  const ok=action==='confirm'; c.phase=ok?'confirmed':'skipped';
  c.el.querySelector('[data-dot]').className='dot '+(ok?'confirmed':'skipped');
  c.el.querySelector('[data-tag]').textContent=ok?'✓ Ready':'Skipped';
  c.el.querySelector('[data-body]').classList.add('hidden');
}
function confirmCard(){
  Object.entries(pcards).forEach(([id,c])=>{ if(c.phase==='pending') setCardDone(id,'confirm'); });
  vscode.postMessage({type:'confirm_provider'});
}
function skipCard(){
  Object.entries(pcards).forEach(([id,c])=>{ if(c.phase==='pending') setCardDone(id,'skip'); });
  vscode.postMessage({type:'skip_provider'});
}

/* ── project list (screen 3) ── */
function renderWorkspaces(folders){
  projBody.innerHTML='';
  if(folders.length){
    const l=document.createElement('div');
    l.className='proj-lbl'; l.textContent='Open workspaces'; projBody.appendChild(l);
    folders.forEach(f=>{
      const c=document.createElement('div'); c.className='proj-card';
      c.innerHTML=\`<span class="pi">🗂</span>
        <div class="pinfo">
          <div class="pname">\${esc(f.name)}</div>
          <div class="ppath">\${esc(f.path)}</div>
        </div>
        <span class="parr">›</span>\`;
      c.addEventListener('click',()=>chooseFolder(f));
      projBody.appendChild(c);
    });
  } else {
    const e=document.createElement('div');
    e.className='proj-lbl'; e.textContent='No workspace folders open';
    projBody.appendChild(e);
  }
}
function chooseFolder(f){ vscode.postMessage({type:'confirm_workspace',name:f.name,path:f.path}); }
document.getElementById('btn-browse').addEventListener('click',()=>vscode.postMessage({type:'browse_folder'}));
document.getElementById('btn-new-folder').addEventListener('click',()=>vscode.postMessage({type:'create_folder'}));

/* ── sidebar buttons ── */
document.getElementById('btn-new-chat').addEventListener('click', newChat);
document.getElementById('btn-sb-proj').addEventListener('click',()=>vscode.postMessage({type:'change_project'}));
document.getElementById('btn-sb-prov').addEventListener('click',()=>{
  show(scrSelect); setSelStatus('');
  document.querySelectorAll('.provider-btn').forEach(b=>b.disabled=false);
  vscode.postMessage({type:'reset'});
});

/* ── welcome example prompts ── */
document.querySelectorAll('.w-ex').forEach(btn=>{
  btn.addEventListener('click',()=>{
    prompt.value=btn.dataset.prompt;
    prompt.dispatchEvent(new Event('input'));
    prompt.focus();
  });
});

/* ── send / stop ── */
let currentPhase='';
const SILENT=new Set(['PLANNING','ORCHESTRATING','RESEARCHING','SCOPING','REVIEWING']);

btnSend.addEventListener('click',()=>{
  const text=prompt.value.trim(); if(!text) return;
  createSession(text);
  addUserMsg(text);
  showTyping();
  phaseBar.classList.remove('hidden');
  phaseLbl.textContent='Starting…';
  currentStepIdx=-1; lastPhase=''; readBuf=[];
  resetDividers();
  vscode.postMessage({type:'start_task',prompt:text});
  prompt.value=''; prompt.style.height='';
  btnSend.classList.add('hidden'); btnStop.classList.remove('hidden');
});
btnStop.addEventListener('click',()=>{
  hideTyping(); phaseBar.classList.add('hidden');
  btnStop.classList.add('hidden'); btnSend.classList.remove('hidden');
  finishSession('stopped');
  vscode.postMessage({type:'stop'});
});
prompt.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();btnSend.click();} });
prompt.addEventListener('input',()=>{
  prompt.style.height='';
  prompt.style.height=Math.min(prompt.scrollHeight,160)+'px';
});

/* ── incoming messages ── */
window.addEventListener('message',e=>{
  const msg=e.data; if(!msg?.type) return;
  switch(msg.type){

    case 'bridge_starting':
      buildCards(msg.providers||[]); show(scrConfirm); break;

    case 'setup_state':
      if(msg.state?.phase==='waiting_confirm'&&msg.state.provider)
        setCardPending(msg.state.provider.id,msg.state.provider.detected);
      break;

    case 'bridge_ready':
      Object.keys(pcards).forEach(id=>{ if(pcards[id].phase==='waiting') setCardDone(id,'confirm'); });
      sbProvName.textContent=msg.providerLabel||'bridge';
      if(msg.alreadyRunning){
        show(scrProject); vscode.postMessage({type:'get_workspaces'});
      } else {
        setTimeout(()=>{ show(scrProject); vscode.postMessage({type:'get_workspaces'}); },500);
      }
      break;

    case 'bridge_failed':
      show(scrSelect); setSelStatus(msg.text||'Bridge failed to start.',true);
      document.querySelectorAll('.provider-btn').forEach(b=>b.disabled=false);
      break;

    case 'workspaces':
      renderWorkspaces(msg.folders||[]); break;

    case 'folder_chosen':
      chooseFolder(msg.folder); break;

    case 'workspace_confirmed':
      sbProjName.textContent=msg.name;
      sbProjPath.textContent=msg.path||'';
      show(scrChat);
      break;

    case 'show_project_screen':
      show(scrProject); vscode.postMessage({type:'get_workspaces'}); break;

    case 'phase_change': {
      const ph=msg.phase||'';
      if(ph===lastPhase) break;
      flushReads(); // flush any buffered reads before new phase divider
      lastPhase=ph; currentPhase=ph;
      const L={
        EXECUTION:'Executing changes…',PLANNING:'Planning approach…',
        ORCHESTRATING:'Selecting pipeline…',RESEARCHING:'Researching codebase…',
        SCOPING:'Scoping task…',VERIFYING:'Verifying changes…',
        REVIEWING:'Reviewing output…',DEBUGGING:'Debugging issues…',WRITING:'Writing code…',
      };
      phaseLbl.textContent=L[ph]||msg.label||ph;
      const si=phaseToStep(ph);
      if(si>=0) setStep(si,ph==='DEBUGGING');
      addPhaseDivider(ph);
      break;
    }

    case 'tool_call_start':
      if(msg.tool){
        const ts_=toolStyle(msg.tool);
        if(ts_.label==='read'){
          // Buffer reads; don't show individual cards yet
          readBuf.push({n:msg.tool,s:msg.paramsSummary||''});
          toolChip.style.display='flex';
          toolChip.textContent=(msg.paramsSummary||msg.tool).slice(0,38);
        } else {
          // Write / run — flush any buffered reads first, then show card
          hideTyping();
          addToolCard(msg.tool,msg.paramsSummary);
          toolChip.style.display='flex';
          toolChip.textContent=(msg.paramsSummary||msg.tool).slice(0,38);
        }
      }
      break;

    case 'tool_call_end':
      if(toolStyle(msg.tool||'').label==='read'){
        // Read finished — chip clears; keep buffering (flush happens on non-read or phase change)
        toolChip.style.display='none';
      } else {
        // Write/run finished
        flushReads();
        resolveCard(!!msg.isError);
        toolChip.style.display='none';
        showTyping();
        if(msg.isError) addSysMsg('Tool error: '+msg.tool,true);
      }
      break;

    case 'file_preview':
      addFilePreview(msg);
      break;

    case 'message_complete': {
      hideTyping();
      if(SILENT.has(currentPhase)) break;
      const raw=msg.text||msg.content||'';
      const preview=raw.length>2400?raw.slice(0,2400)+'…':raw;
      if(preview.trim()) addAgentMsg(preview);
      break;
    }

    case 'system_message':
      hideTyping();
      addSysMsg(msg.text,msg.level==='error');
      if(msg.level!=='error'){
        btnSend.classList.remove('hidden'); btnStop.classList.add('hidden');
      }
      break;

    case 'session_end':
    case 'task_complete':
      flushReads();
      hideTyping();
      toolChip.style.display='none';
      setStep(4);
      addDoneBanner();
      finishSession('done');
      btnSend.classList.remove('hidden'); btnStop.classList.add('hidden');
      setTimeout(()=>{ phaseBar.classList.add('hidden'); currentStepIdx=-1; },1400);
      break;
  }
});

vscode.postMessage({type:'check_bridge'});
</script>
</body>
</html>`;
  }
}

module.exports = { DevAgentViewProvider, DevAgentPanel };
