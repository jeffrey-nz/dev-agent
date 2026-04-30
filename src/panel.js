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
      localResourceRoots: [vscode.Uri.file(path.join(this._context.extensionPath, "webview"))],
    };
    webviewView.webview.html = this._getHtml();
    webviewView.webview.onDidReceiveMessage((msg) => this._onMessage(msg), null, this._context.subscriptions);
    webviewView.onDidDispose(() => { this._view = null; });
  }

  postMessage(msg) { this._view?.webview.postMessage(msg); }
  reveal() { this._view?.show(true); }

  _getHtml() {
    const htmlPath = path.join(this._context.extensionPath, "webview", "index.html");
    if (fs.existsSync(htmlPath)) return fs.readFileSync(htmlPath, "utf8");
    return this._buildHtml();
  }

  _buildHtml() {
    const providerCards = PROVIDERS.map((p) => `
      <button class="provider-btn" data-id="${p.id}">${p.label}</button>`).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Dev Agent</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --gap:10px;
    --radius:5px;
    --fg:var(--vscode-editor-foreground);
    --bg:var(--vscode-sideBar-background,var(--vscode-editor-background));
    --border:var(--vscode-panel-border);
    --muted:var(--vscode-descriptionForeground);
    --input-bg:var(--vscode-input-background);
    --input-fg:var(--vscode-input-foreground);
    --input-border:var(--vscode-input-border);
    --btn-bg:var(--vscode-button-background);
    --btn-fg:var(--vscode-button-foreground);
    --btn-hover:var(--vscode-button-hoverBackground);
    --focus:var(--vscode-focusBorder);
    --hover-bg:var(--vscode-list-hoverBackground);
    --sel-bg:var(--vscode-editor-selectionBackground);
    --err:var(--vscode-errorForeground);
    --agent-bubble:var(--vscode-editor-inactiveSelectionBackground);
    --badge-bg:var(--vscode-badge-background,#444);
    --badge-fg:var(--vscode-badge-foreground,#fff);
  }
  body{font-family:var(--vscode-font-family);font-size:13px;color:var(--fg);
       background:var(--bg);height:100vh;display:flex;flex-direction:column;overflow:hidden}

  /* ── shared ── */
  .hidden{display:none!important}
  button{border:none;border-radius:var(--radius);cursor:pointer;font:inherit;padding:7px 14px;
         transition:background .12s,opacity .12s}
  .btn-primary{background:var(--btn-bg);color:var(--btn-fg)}
  .btn-primary:hover{background:var(--btn-hover)}
  .btn-primary:disabled{opacity:.45;cursor:not-allowed}
  .btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border);
             font-size:11px;padding:3px 8px}
  .btn-ghost:hover{background:var(--hover-bg)}
  .btn-ghost.active{color:var(--fg);border-color:var(--focus)}
  .btn-danger{background:transparent;color:var(--err);border:1px solid var(--err);padding:6px 11px}
  .btn-danger:hover{background:color-mix(in srgb,var(--err) 15%,transparent)}

  /* ── screen chrome ── */
  .scr-header{padding:10px 14px;border-bottom:1px solid var(--border)}
  .scr-header strong{display:block;font-size:13px;font-weight:600;margin-bottom:2px}
  .scr-header p{font-size:12px;color:var(--muted);line-height:1.45}

  /* ── screen 1: provider select ── */
  #scr-select{flex:1;display:flex;flex-direction:column;padding:14px;gap:12px;overflow-y:auto}
  #scr-select h2{font-size:13px;font-weight:600}
  .provider-list{display:flex;flex-direction:column;gap:6px}
  .provider-btn{width:100%;text-align:left;padding:9px 13px;background:transparent;
                border:1px solid var(--border);border-radius:var(--radius);
                color:var(--fg);font-size:12px;font-weight:500;
                transition:border-color .1s,background .1s}
  .provider-btn:hover{background:var(--hover-bg);border-color:var(--focus)}
  #sel-status{font-size:12px;color:var(--muted);min-height:16px;text-align:center}
  #sel-status.err{color:var(--err)}

  /* ── screen 2: confirming ── */
  #scr-confirm{flex:1;display:flex;flex-direction:column;overflow:hidden}
  .pcard-list{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:7px}
  .pcard{border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
  .pcard-head{display:flex;align-items:center;gap:8px;padding:8px 12px}
  .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;transition:background .2s}
  .dot.waiting{background:var(--muted);opacity:.35}
  .dot.pending{background:#e5a100}
  .dot.confirmed{background:#4caf50}
  .dot.skipped{background:var(--err);opacity:.7}
  .pcard-name{font-size:12px;font-weight:500;flex:1}
  .pcard-tag{font-size:11px;color:var(--muted)}
  .pcard-body{padding:0 12px 10px;display:flex;flex-direction:column;gap:8px}
  .detected-yes{font-size:11px;color:#4caf50}
  .detected-no{font-size:11px;color:#e5a100}
  .confirm-hint{font-size:11px;color:var(--muted);line-height:1.45}
  .confirm-btns{display:flex;gap:6px}
  .btn-confirm{background:color-mix(in srgb,#4caf50 18%,transparent);color:#4caf50;
               border:1px solid #4caf50;border-radius:var(--radius);
               padding:5px 12px;font:inherit;cursor:pointer;font-size:12px}
  .btn-confirm:hover{background:color-mix(in srgb,#4caf50 28%,transparent)}
  .btn-skip-sm{background:transparent;color:var(--muted);border:1px solid var(--border);
               border-radius:var(--radius);padding:5px 10px;font:inherit;cursor:pointer;font-size:12px}
  .btn-skip-sm:hover{background:var(--hover-bg)}

  /* ── screen 3: project select ── */
  #scr-project{flex:1;display:flex;flex-direction:column;overflow:hidden}
  .proj-body{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
  .proj-section-label{font-size:11px;color:var(--muted);text-transform:uppercase;
                      letter-spacing:.06em;padding:4px 0 2px}
  .proj-card{display:flex;align-items:center;gap:10px;padding:8px 12px;
             border:1px solid var(--border);border-radius:var(--radius);
             cursor:pointer;transition:border-color .1s,background .1s}
  .proj-card:hover{background:var(--hover-bg);border-color:var(--focus)}
  .proj-card .proj-icon{font-size:15px;flex-shrink:0}
  .proj-card .proj-info{flex:1;min-width:0}
  .proj-card .proj-name{font-size:12px;font-weight:600;white-space:nowrap;
                        overflow:hidden;text-overflow:ellipsis}
  .proj-card .proj-path{font-size:11px;color:var(--muted);white-space:nowrap;
                        overflow:hidden;text-overflow:ellipsis}
  .proj-card .proj-arrow{font-size:12px;color:var(--muted);flex-shrink:0}
  .proj-actions{display:flex;flex-direction:column;gap:6px;padding:10px 12px;
                border-top:1px solid var(--border)}
  .btn-action{display:flex;align-items:center;gap:8px;padding:8px 12px;
              background:transparent;border:1px solid var(--border);border-radius:var(--radius);
              color:var(--fg);font:inherit;font-size:12px;cursor:pointer;
              text-align:left;transition:background .1s,border-color .1s;width:100%}
  .btn-action:hover{background:var(--hover-bg);border-color:var(--focus)}
  .btn-action .action-icon{font-size:14px}

  /* ── screen 4: chat ── */
  #scr-chat{flex:1;display:flex;flex-direction:column;overflow:hidden}
  #activity-bar{font-size:11px;color:var(--muted);padding:3px 12px;border-bottom:1px solid var(--border);
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:22px;
                display:flex;align-items:center;gap:5px}
  #activity-bar:empty{display:none}
  .spinner{display:inline-block;width:8px;height:8px;border:1.5px solid var(--muted);
           border-top-color:var(--focus);border-radius:50%;animation:spin .6s linear infinite;flex-shrink:0}
  @keyframes spin{to{transform:rotate(360deg)}}
  .chat-header{display:flex;align-items:center;gap:6px;padding:7px 10px;
               border-bottom:1px solid var(--border);flex-wrap:wrap}
  .chat-badge{display:flex;align-items:center;gap:5px;padding:2px 7px;
              background:var(--badge-bg);color:var(--badge-fg);
              border-radius:3px;font-size:11px;max-width:100%;overflow:hidden}
  .chat-badge-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.75}
  .chat-badge-value{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .chat-header-actions{display:flex;gap:4px;margin-left:auto;flex-shrink:0}
  #messages{flex:1;overflow-y:auto;padding:10px 12px;
            display:flex;flex-direction:column;gap:7px}
  .msg{padding:7px 11px;border-radius:var(--radius);font-size:12px;
       line-height:1.55;white-space:pre-wrap;word-break:break-word}
  .msg.agent{background:var(--agent-bubble)}
  .msg.user{background:var(--btn-bg);color:var(--btn-fg);align-self:flex-end;max-width:85%}
  .msg.system{color:var(--muted);font-size:11px;font-style:italic}
  .msg.error{color:var(--err);font-size:11px}
  .msg.thinking{color:var(--muted);font-size:11px;font-style:italic;opacity:.75}
  #input-row{display:flex;gap:6px;padding:9px 12px;border-top:1px solid var(--border)}
  #prompt{flex:1;background:var(--input-bg);color:var(--input-fg);
          border:1px solid var(--input-border);padding:7px 9px;
          border-radius:var(--radius);font:inherit;font-size:12px;resize:none}
  #prompt:focus{outline:1px solid var(--focus);outline-offset:-1px}
</style>
</head>
<body>

<!-- screen 1: provider selection -->
<div id="scr-select">
  <div>
    <h2>Dev Agent</h2>
    <p style="margin-top:5px">Choose an AI provider to start.</p>
  </div>
  <div class="provider-list">
    ${providerCards}
  </div>
  <div id="sel-status"></div>
</div>

<!-- screen 2: per-provider confirmation -->
<div id="scr-confirm" class="hidden">
  <div class="scr-header">
    <strong>Browser setup</strong>
    <p>Log into each provider in Chrome, then confirm.</p>
  </div>
  <div class="pcard-list" id="pcard-list"></div>
</div>

<!-- screen 3: project selection -->
<div id="scr-project" class="hidden">
  <div class="scr-header">
    <strong>Select a project</strong>
    <p>Choose an existing folder or create a new one.</p>
  </div>
  <div class="proj-body" id="proj-body">
    <div class="proj-section-label">Loading…</div>
  </div>
  <div class="proj-actions">
    <button class="btn-action" id="btn-browse">
      <span class="action-icon">📂</span>
      <span>Browse for folder…</span>
    </button>
    <button class="btn-action" id="btn-new-folder">
      <span class="action-icon">✨</span>
      <span>Create new folder…</span>
    </button>
  </div>
</div>

<!-- screen 4: chat -->
<div id="scr-chat" class="hidden">
  <div id="activity-bar"></div>
  <div class="chat-header">
    <div class="chat-badge" title="AI providers">
      <span class="chat-badge-label">via</span>
      <span class="chat-badge-value" id="chat-provider">—</span>
    </div>
    <div class="chat-badge" id="proj-badge" title="Working directory">
      <span class="chat-badge-label">in</span>
      <span class="chat-badge-value" id="chat-project">—</span>
    </div>
    <div class="chat-header-actions">
      <button class="btn-ghost" id="btn-change-proj" title="Change project">📁</button>
      <button class="btn-ghost" id="btn-reset" title="Change providers">↩</button>
    </div>
  </div>
  <div id="messages"></div>
  <div id="input-row">
    <textarea id="prompt" rows="2" placeholder="Ask Dev Agent to do something…"></textarea>
    <button class="btn-primary" id="btn-send">Send</button>
    <button class="btn-danger hidden" id="btn-stop">Stop</button>
  </div>
</div>

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
const prompt     = document.getElementById('prompt');
const btnSend    = document.getElementById('btn-send');
const btnStop    = document.getElementById('btn-stop');
const btnReset   = document.getElementById('btn-reset');
const btnChangePr= document.getElementById('btn-change-proj');
const chatProv   = document.getElementById('chat-provider');
const chatProj   = document.getElementById('chat-project');

const ALL_SCRS = [scrSelect, scrConfirm, scrProject, scrChat];

/* ── helpers ── */
function show(scr){ ALL_SCRS.forEach(s=>s.classList.add('hidden')); scr.classList.remove('hidden'); }
function setStatus(t,isErr=false){ selStatus.textContent=t; selStatus.className=isErr?'err':''; }

/* ── provider selection ── */
document.querySelectorAll('.provider-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const id=btn.dataset.id;
    document.querySelectorAll('.provider-btn').forEach(b=>b.disabled=true);
    setStatus('Launching browser automation…');
    vscode.postMessage({type:'launch_bridge', providers:[id]});
  });
});

/* ── provider cards (screen 2) ── */
let pcards = {};
function buildCards(providers){
  pcardList.innerHTML=''; pcards={};
  providers.forEach(({id,label})=>{
    const el=document.createElement('div');
    el.className='pcard'; el.dataset.id=id;
    el.innerHTML=\`
      <div class="pcard-head">
        <div class="dot waiting" data-dot></div>
        <span class="pcard-name">\${label}</span>
        <span class="pcard-tag" data-tag>Waiting…</span>
      </div>
      <div class="pcard-body hidden" data-body></div>\`;
    pcardList.appendChild(el);
    pcards[id]={el, phase:'waiting'};
  });
}
function setCardPending(id, detected){
  const c=pcards[id]; if(!c) return;
  c.phase='pending';
  c.el.querySelector('[data-dot]').className='dot pending';
  c.el.querySelector('[data-tag]').textContent='Needs confirmation';
  const body=c.el.querySelector('[data-body]');
  body.classList.remove('hidden');
  body.innerHTML=\`
    <div class="\${detected?'detected-yes':'detected-no'}">\${detected?'✓ Interface detected in Chrome':'⚠ Interface not detected — log in if needed'}</div>
    <div class="confirm-hint">Confirm once you can see the chat interface in Chrome.</div>
    <div class="confirm-btns">
      <button class="btn-confirm" onclick="confirmCurrent()">✓ Confirm Ready</button>
      <button class="btn-skip-sm" onclick="skipCurrent()">Skip</button>
    </div>\`;
}
function setCardDone(id, action){
  const c=pcards[id]; if(!c) return;
  const ok=action==='confirm';
  c.phase=ok?'confirmed':'skipped';
  c.el.querySelector('[data-dot]').className='dot '+(ok?'confirmed':'skipped');
  c.el.querySelector('[data-tag]').textContent=ok?'✓ Ready':'Skipped';
  c.el.querySelector('[data-body]').classList.add('hidden');
}
function confirmCurrent(){
  Object.entries(pcards).forEach(([id,c])=>{ if(c.phase==='pending') setCardDone(id,'confirm'); });
  vscode.postMessage({type:'confirm_provider'});
}
function skipCurrent(){
  Object.entries(pcards).forEach(([id,c])=>{ if(c.phase==='pending') setCardDone(id,'skip'); });
  vscode.postMessage({type:'skip_provider'});
}

/* ── project selection (screen 3) ── */
let pendingFolder = null;  // folder chosen but not yet confirmed

function renderWorkspaces(folders){
  projBody.innerHTML='';
  if(folders.length){
    const lbl=document.createElement('div');
    lbl.className='proj-section-label';
    lbl.textContent='Open workspaces';
    projBody.appendChild(lbl);
    folders.forEach(f=>{
      const card=document.createElement('div');
      card.className='proj-card';
      card.innerHTML=\`
        <span class="proj-icon">🗂</span>
        <div class="proj-info">
          <div class="proj-name">\${f.name}</div>
          <div class="proj-path">\${f.path}</div>
        </div>
        <span class="proj-arrow">›</span>\`;
      card.addEventListener('click',()=>chooseFolder(f));
      projBody.appendChild(card);
    });
  } else {
    const empty=document.createElement('div');
    empty.className='proj-section-label';
    empty.textContent='No workspace folders open';
    projBody.appendChild(empty);
  }
}

function chooseFolder(f){
  pendingFolder=f;
  vscode.postMessage({type:'confirm_workspace', name:f.name, path:f.path});
}

document.getElementById('btn-browse').addEventListener('click',()=>{ vscode.postMessage({type:'browse_folder'}); });
document.getElementById('btn-new-folder').addEventListener('click',()=>{ vscode.postMessage({type:'create_folder'}); });

/* ── activity status bar ── */
const activityBar = document.getElementById('activity-bar');
function setActivityStatus(text){
  if(!text){ activityBar.innerHTML=''; return; }
  activityBar.innerHTML=\`<span class="spinner"></span><span>\${text}</span>\`;
}

/* ── chat ── */
function addMsg(text,cls){
  if(!text) return;
  const d=document.createElement('div'); d.className='msg '+cls; d.textContent=text;
  messages.appendChild(d); messages.scrollTop=messages.scrollHeight;
}
btnSend.addEventListener('click',()=>{
  const text=prompt.value.trim(); if(!text) return;
  addMsg(text,'user');
  setActivityStatus('Starting…');
  vscode.postMessage({type:'start_task', prompt:text});
  prompt.value=''; btnSend.classList.add('hidden'); btnStop.classList.remove('hidden');
});
btnStop.addEventListener('click',()=>{ setActivityStatus(''); vscode.postMessage({type:'stop'}); });
prompt.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();btnSend.click();} });

btnReset.addEventListener('click',()=>{
  show(scrSelect); setStatus('');
  document.querySelectorAll('.provider-btn').forEach(b=>b.disabled=false);
  vscode.postMessage({type:'reset'});
});
btnChangePr.addEventListener('click',()=>{
  vscode.postMessage({type:'change_project'});
});

/* ── incoming messages ── */
window.addEventListener('message',e=>{
  const msg=e.data; if(!msg?.type) return;
  switch(msg.type){

    case 'bridge_starting':
      buildCards(msg.providers||[]);
      show(scrConfirm);
      break;

    case 'setup_state':
      if(msg.state?.phase==='waiting_confirm'&&msg.state.provider){
        setCardPending(msg.state.provider.id, msg.state.provider.detected);
      }
      break;

    case 'bridge_ready':
      // bridge done — go to project selection
      Object.keys(pcards).forEach(id=>{ if(pcards[id].phase==='waiting') setCardDone(id,'confirm'); });
      chatProv.textContent=msg.providerLabel||'bridge';
      if(msg.alreadyRunning){
        // bridge was already up — skip confirming screen, go straight to project
        show(scrProject);
        vscode.postMessage({type:'get_workspaces'});
      } else {
        setTimeout(()=>{ show(scrProject); vscode.postMessage({type:'get_workspaces'}); }, 500);
      }
      break;

    case 'bridge_failed':
      show(scrSelect); setStatus(msg.text||'Bridge failed to start.',true);
      document.querySelectorAll('.provider-btn').forEach(b=>b.disabled=false);
      break;

    case 'workspaces':
      renderWorkspaces(msg.folders||[]);
      break;

    case 'folder_chosen':
      // Extension resolved a browse/create dialog — auto-confirm it
      chooseFolder(msg.folder);
      break;

    case 'workspace_confirmed':
      // Extension acknowledged the workspace — go to chat
      chatProj.textContent=msg.name;
      show(scrChat);
      addMsg(\`Working in \${msg.name}\`, 'system');
      break;

    case 'show_project_screen':
      show(scrProject);
      vscode.postMessage({type:'get_workspaces'});
      break;

    case 'message_complete':
      addMsg(msg.text||msg.content||'','agent'); break;
    case 'thinking':
      addMsg(msg.text||'Thinking…','thinking'); break;
    case 'system_message':
      addMsg(msg.text, msg.level==='error'?'error':'system');
      if(msg.level!=='error'){ btnSend.classList.remove('hidden'); btnStop.classList.add('hidden'); }
      break;
    case 'phase_change': {
      const PHASE_LABELS = {
        EXECUTION:'Working…', PLANNING:'Planning…', ORCHESTRATING:'Selecting pipeline…',
        RESEARCHING:'Researching…', SCOPING:'Scoping…', CODING:'Writing code…',
        VERIFYING:'Verifying…', REVIEWING:'Reviewing…',
      };
      const label = PHASE_LABELS[msg.phase] || msg.label || msg.phase;
      setActivityStatus(label);
      break;
    }
    case 'tool_call_start':
      if(msg.tool && msg.paramsSummary){ setActivityStatus(msg.tool+': '+msg.paramsSummary.slice(0,50)); }
      break;
    case 'session_end':
    case 'task_complete':
      setActivityStatus('');
      addMsg('Done.','system');
      btnSend.classList.remove('hidden'); btnStop.classList.add('hidden');
      break;
  }
});

vscode.postMessage({type:'check_bridge'});
</script>
</body>
</html>`;
  }
}

module.exports = { DevAgentViewProvider };
