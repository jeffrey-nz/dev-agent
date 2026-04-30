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
    const providerRows = PROVIDERS.map((p) => `
      <label class="prow" data-id="${p.id}">
        <input type="checkbox" name="provider" value="${p.id}" checked />
        <span class="prow-label">${p.label}</span>
      </label>`).join("");

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
    --font:var(--vscode-font-family);
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
  }
  body{font-family:var(--font);font-size:13px;color:var(--fg);background:var(--bg);
       height:100vh;display:flex;flex-direction:column;overflow:hidden}

  /* ─── shared ─── */
  .hidden{display:none!important}
  button{border:none;border-radius:var(--radius);cursor:pointer;font:inherit;
         padding:7px 14px;transition:background .1s}
  .btn-primary{background:var(--btn-bg);color:var(--btn-fg)}
  .btn-primary:hover{background:var(--btn-hover)}
  .btn-primary:disabled{opacity:.45;cursor:not-allowed}
  .btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border);
             font-size:11px;padding:3px 8px}
  .btn-ghost:hover{background:var(--hover-bg)}
  .btn-danger{background:transparent;color:var(--err);border:1px solid var(--err);padding:6px 11px}
  .btn-danger:hover{background:color-mix(in srgb,var(--err) 15%,transparent)}

  /* ─── screen: select ─── */
  #scr-select{flex:1;display:flex;flex-direction:column;padding:14px;gap:12px;overflow-y:auto}
  #scr-select h2{font-size:13px;font-weight:600;letter-spacing:.02em}
  #scr-select p{font-size:12px;color:var(--muted);line-height:1.5}

  .plist{display:flex;flex-direction:column;gap:5px}
  .prow-all{display:flex;align-items:center;gap:8px;padding:4px 0 8px;
            border-bottom:1px solid var(--border);font-size:12px;color:var(--muted);cursor:pointer}
  .prow{display:flex;align-items:center;gap:9px;padding:6px 10px;border:1px solid var(--border);
        border-radius:var(--radius);cursor:pointer;user-select:none;transition:border-color .1s,background .1s}
  .prow:hover{background:var(--hover-bg)}
  .prow.on{border-color:var(--focus);background:var(--sel-bg)}
  .prow input{cursor:pointer;accent-color:var(--btn-bg)}
  .prow-label{font-size:12px;font-weight:500}

  .select-footer{display:flex;flex-direction:column;gap:6px}
  #sel-status{font-size:12px;color:var(--muted);min-height:16px;text-align:center}
  #sel-status.err{color:var(--err)}

  /* ─── screen: confirming ─── */
  #scr-confirm{flex:1;display:flex;flex-direction:column;overflow:hidden}
  .confirm-header{padding:10px 14px;border-bottom:1px solid var(--border);
                  font-size:12px;color:var(--muted)}
  .confirm-header strong{color:var(--fg);display:block;font-size:13px;margin-bottom:2px}
  .pcard-list{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:7px}

  .pcard{border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
  .pcard-head{display:flex;align-items:center;gap:8px;padding:8px 12px}
  .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .dot.waiting{background:var(--muted);opacity:.4}
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
  .btn-confirm{background:color-mix(in srgb,#4caf50 20%,transparent);
               color:#4caf50;border:1px solid #4caf50;
               border-radius:var(--radius);padding:5px 12px;font:inherit;cursor:pointer;font-size:12px}
  .btn-confirm:hover{background:color-mix(in srgb,#4caf50 30%,transparent)}
  .btn-skip-sm{background:transparent;color:var(--muted);border:1px solid var(--border);
               border-radius:var(--radius);padding:5px 10px;font:inherit;cursor:pointer;font-size:12px}
  .btn-skip-sm:hover{background:var(--hover-bg)}

  /* ─── screen: chat ─── */
  #scr-chat{flex:1;display:flex;flex-direction:column;overflow:hidden}
  .chat-header{display:flex;align-items:center;justify-content:space-between;
               padding:7px 12px;border-bottom:1px solid var(--border);gap:8px}
  .chat-title{font-size:11px;color:var(--muted)}
  #chat-provider{font-weight:600;color:var(--fg);font-size:11px}

  #messages{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:7px}
  .msg{padding:7px 11px;border-radius:var(--radius);font-size:12px;line-height:1.55;
       white-space:pre-wrap;word-break:break-word}
  .msg.agent{background:var(--agent-bubble)}
  .msg.user{background:var(--btn-bg);color:var(--btn-fg);align-self:flex-end;max-width:85%}
  .msg.system{color:var(--muted);font-size:11px;font-style:italic}
  .msg.error{color:var(--err);font-size:11px}
  .msg.thinking{color:var(--muted);font-size:11px;font-style:italic;opacity:.75}

  #input-row{display:flex;gap:6px;padding:9px 12px;border-top:1px solid var(--border)}
  #prompt{flex:1;background:var(--input-bg);color:var(--input-fg);border:1px solid var(--input-border);
          padding:7px 9px;border-radius:var(--radius);font:inherit;font-size:12px;resize:none}
  #prompt:focus{outline:1px solid var(--focus);outline-offset:-1px}
</style>
</head>
<body>

<!-- ── Screen 1: provider selection ── -->
<div id="scr-select">
  <div>
    <h2>Dev Agent</h2>
    <p style="margin-top:5px">Choose which AI providers to open in Chrome, then launch the browser automation.</p>
  </div>

  <div class="plist">
    <label class="prow-all">
      <input type="checkbox" id="chk-all" checked/> All providers
    </label>
    ${providerRows}
  </div>

  <div class="select-footer">
    <div id="sel-status"></div>
    <button class="btn-primary" id="btn-launch">Launch bridge</button>
  </div>
</div>

<!-- ── Screen 2: per-provider confirmation ── -->
<div id="scr-confirm" class="hidden">
  <div class="confirm-header">
    <strong>Browser setup</strong>
    Log into each provider in Chrome, then confirm below.
  </div>
  <div class="pcard-list" id="pcard-list"></div>
</div>

<!-- ── Screen 3: chat ── -->
<div id="scr-chat" class="hidden">
  <div class="chat-header">
    <span class="chat-title">Provider: <span id="chat-provider">—</span></span>
    <button class="btn-ghost" id="btn-reset">&#8592; Setup</button>
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

/* ── refs ── */
const scrSelect  = document.getElementById('scr-select');
const scrConfirm = document.getElementById('scr-confirm');
const scrChat    = document.getElementById('scr-chat');
const chkAll     = document.getElementById('chk-all');
const btnLaunch  = document.getElementById('btn-launch');
const selStatus  = document.getElementById('sel-status');
const pcardList  = document.getElementById('pcard-list');
const messages   = document.getElementById('messages');
const prompt     = document.getElementById('prompt');
const btnSend    = document.getElementById('btn-send');
const btnStop    = document.getElementById('btn-stop');
const btnReset   = document.getElementById('btn-reset');
const chatProv   = document.getElementById('chat-provider');
const provChecks = document.querySelectorAll('input[name="provider"]');
const provRows   = document.querySelectorAll('.prow');

/* ── provider selection ── */
function syncAllChk(){
  const any=[...provChecks].some(c=>c.checked);
  const all=[...provChecks].every(c=>c.checked);
  chkAll.checked=all; chkAll.indeterminate=any&&!all;
}
function updateRow(row){row.classList.toggle('on',row.querySelector('input').checked)}
provRows.forEach(row=>{
  updateRow(row);
  row.addEventListener('click',()=>{
    const c=row.querySelector('input'); c.checked=!c.checked;
    updateRow(row); syncAllChk();
  });
  row.querySelector('input').addEventListener('click',e=>e.stopPropagation());
});
chkAll.addEventListener('change',()=>{
  provChecks.forEach(c=>{c.checked=chkAll.checked});
  provRows.forEach(updateRow);
});

function selectedProviders(){return[...provChecks].filter(c=>c.checked).map(c=>c.value)}

/* ── screen transitions ── */
function show(scr){
  [scrSelect,scrConfirm,scrChat].forEach(s=>s.classList.add('hidden'));
  scr.classList.remove('hidden');
}
function setStatus(t,isErr=false){selStatus.textContent=t;selStatus.className=isErr?'err':''}

/* ── provider cards (screen 2) ── */
let pcards={};   // id → {el, phase}

function buildCards(providers){
  pcardList.innerHTML='';
  pcards={};
  providers.forEach(({id,label})=>{
    const el=document.createElement('div');
    el.className='pcard';
    el.dataset.id=id;
    el.innerHTML=\`
      <div class="pcard-head">
        <div class="dot waiting" data-dot></div>
        <span class="pcard-name">\${label}</span>
        <span class="pcard-tag" data-tag>Waiting…</span>
      </div>
      <div class="pcard-body hidden" data-body></div>\`;
    pcardList.appendChild(el);
    pcards[id]={el,phase:'waiting'};
  });
}

function setCardPending(id,detected){
  const c=pcards[id]; if(!c)return;
  c.phase='pending';
  const dot=c.el.querySelector('[data-dot]');
  const tag=c.el.querySelector('[data-tag]');
  const body=c.el.querySelector('[data-body]');
  dot.className='dot pending';
  tag.textContent='Needs confirmation';
  body.classList.remove('hidden');
  body.innerHTML=\`
    <div class="\${detected?'detected-yes':'detected-no'}">
      \${detected?'✓ Interface detected in Chrome':'⚠ Interface not detected — you may need to log in'}
    </div>
    <div class="confirm-hint">Log in to this provider in Chrome if prompted, then confirm.</div>
    <div class="confirm-btns">
      <button class="btn-confirm" onclick="confirmCurrent()">✓ Confirm Ready</button>
      <button class="btn-skip-sm" onclick="skipCurrent()">Skip</button>
    </div>\`;
}

function setCardDone(id,action){
  const c=pcards[id]; if(!c)return;
  const confirmed=action==='confirm';
  c.phase=confirmed?'confirmed':'skipped';
  const dot=c.el.querySelector('[data-dot]');
  const tag=c.el.querySelector('[data-tag]');
  const body=c.el.querySelector('[data-body]');
  dot.className='dot '+(confirmed?'confirmed':'skipped');
  tag.textContent=confirmed?'✓ Ready':'Skipped';
  body.classList.add('hidden');
}

function confirmCurrent(){
  // Optimistic update — mark the pending card done immediately
  Object.entries(pcards).forEach(([id,c])=>{if(c.phase==='pending')setCardDone(id,'confirm')});
  vscode.postMessage({type:'confirm_provider'});
}
function skipCurrent(){
  Object.entries(pcards).forEach(([id,c])=>{if(c.phase==='pending')setCardDone(id,'skip')});
  vscode.postMessage({type:'skip_provider'});
}

/* ── chat helpers ── */
function addMsg(text,cls){
  if(!text)return;
  const d=document.createElement('div');
  d.className='msg '+cls; d.textContent=text;
  messages.appendChild(d);
  messages.scrollTop=messages.scrollHeight;
}

btnSend.addEventListener('click',()=>{
  const text=prompt.value.trim(); if(!text)return;
  addMsg(text,'user');
  vscode.postMessage({type:'start_task',prompt:text});
  prompt.value='';
  btnSend.classList.add('hidden');
  btnStop.classList.remove('hidden');
});
btnStop.addEventListener('click',()=>vscode.postMessage({type:'stop'}));
prompt.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();btnSend.click()}});
btnLaunch.addEventListener('click',()=>{
  const providers=selectedProviders();
  if(!providers.length){setStatus('Select at least one provider.',true);return}
  btnLaunch.disabled=true;
  setStatus('Launching browser automation…');
  vscode.postMessage({type:'launch_bridge',providers});
});
btnReset.addEventListener('click',()=>{
  show(scrSelect); setStatus(''); btnLaunch.disabled=false;
  vscode.postMessage({type:'reset'});
});

/* ── incoming messages ── */
window.addEventListener('message',e=>{
  const msg=e.data; if(!msg?.type)return;
  switch(msg.type){

    case 'bridge_starting':
      buildCards(msg.providers||[]);
      show(scrConfirm);
      break;

    case 'setup_state':{
      const s=msg.state;
      if(s.phase==='waiting_confirm'&&s.provider){
        setCardPending(s.provider.id,s.provider.detected);
      }
      // 'starting' phase transitions are handled optimistically on button click
      break;
    }

    case 'bridge_ready':{
      const label=msg.providerLabel||'bridge';
      chatProv.textContent=label;
      if(msg.alreadyRunning){
        show(scrChat);
        addMsg('Bridge is already running — ready.','system');
      } else {
        // briefly show all cards as done before switching to chat
        Object.keys(pcards).forEach(id=>{
          if(pcards[id].phase==='waiting')setCardDone(id,'confirm');
        });
        setTimeout(()=>{show(scrChat);addMsg('Bridge ready. What would you like to do?','system')},500);
      }
      break;
    }

    case 'bridge_failed':
      show(scrSelect);
      setStatus(msg.text||'Bridge failed to start.',true);
      btnLaunch.disabled=false;
      break;

    case 'log':
    case 'message_complete':
      addMsg(msg.text||msg.content||'','agent'); break;
    case 'thinking':
      addMsg(msg.text||'Thinking…','thinking'); break;
    case 'system_message':
      addMsg(msg.text,msg.level==='error'?'error':'system');
      if(msg.level!=='error'){btnSend.classList.remove('hidden');btnStop.classList.add('hidden')}
      break;
    case 'session_end':
    case 'task_complete':
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
