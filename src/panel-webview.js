/* jshint browser: true */
/* global acquireVsCodeApi */
const vscode = acquireVsCodeApi();
const _INIT = JSON.parse(document.getElementById('init-data').textContent || '{}');

/* ── element refs ── */
const scrConnect  = document.getElementById('scr-connect');
const scrConfirm  = document.getElementById('scr-confirm');
const scrProvider = document.getElementById('scr-provider');
const scrProject  = document.getElementById('scr-project');
const scrChat     = document.getElementById('scr-chat');
const pcardList   = document.getElementById('pcard-list');
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
const sessionList    = document.getElementById('session-list');
const sessionsDrop   = document.getElementById('sessions-drop');
const settingsDrop   = document.getElementById('settings-drop');
const hdrProj    = document.getElementById('hdr-proj');
const hdrProv    = null; // replaced by #btn-prov dropdown
const btnSessions    = document.getElementById('btn-sessions');
const btnSettingsBtn = document.getElementById('btn-settings');
const ALL_SCRS   = [scrConnect, scrConfirm, scrProvider, scrProject, scrChat];

/* ── screen helpers ── */
function show(s){ ALL_SCRS.forEach(x=>x.classList.add('hidden')); s.classList.remove('hidden'); closeDropdowns(); }
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

/* ── dropdown toggles ── */
function closeDropdowns(){
  sessionsDrop.classList.add('hidden'); btnSessions.classList.remove('active');
  settingsDrop.classList.add('hidden'); btnSettingsBtn.classList.remove('active');
  provDrop.classList.add('hidden'); btnProv.classList.remove('open');
}
btnSessions.addEventListener('click', e=>{
  e.stopPropagation();
  const open = !sessionsDrop.classList.contains('hidden');
  closeDropdowns();
  if(!open){ sessionsDrop.classList.remove('hidden'); btnSessions.classList.add('active'); }
});
btnSettingsBtn.addEventListener('click', e=>{
  e.stopPropagation();
  const open = !settingsDrop.classList.contains('hidden');
  closeDropdowns();
  if(!open){ settingsDrop.classList.remove('hidden'); btnSettingsBtn.classList.add('active'); }
});
document.addEventListener('click', closeDropdowns);
sessionsDrop.addEventListener('click', e=>e.stopPropagation());
settingsDrop.addEventListener('click', e=>e.stopPropagation());

/* ══════════════════════════════════════
   MARKDOWN RENDERER
══════════════════════════════════════ */
const CB_S = '', CB_E = '';

function renderCodeBlock(code, lang) {
  const escaped = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return '<div class="cb"><div class="cb-hdr">'
    + (lang ? '<span class="cb-lang">'+esc(lang)+'</span>' : '<span></span>')
    + '<button class="cb-copy" onclick="copyCode(this)">Copy</button>'
    + '</div><pre class="cb-pre"><code>'+escaped+'</code></pre></div>';
}

function renderMarkdown(md) {
  if (!md) return '';
  const blocks = [];
  let text = md.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const key = CB_S + blocks.length + CB_E;
    blocks.push({lang: lang.trim(), code: code.replace(/\n$/, '')});
    return key;
  });
  text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  text = text
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="ic">$1</code>');
  const lines = text.split('\n');
  const out = [];
  let inList = null;
  const closeList = () => { if (inList) { out.push('</'+inList+'>'); inList = null; } };
  for (const line of lines) {
    if (line.includes(CB_S)) { closeList(); out.push(line); continue; }
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
  blocks.forEach((b, i) => {
    text = text.replace(CB_S + i + CB_E, renderCodeBlock(b.code, b.lang));
  });
  return text;
}

function clipboardWrite(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = Object.assign(document.createElement('textarea'), {value:text,style:'position:fixed;opacity:0'});
  document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  return Promise.resolve();
}
function copyCode(btn) {
  const code = btn.closest('.cb').querySelector('pre code').textContent;
  clipboardWrite(code).then(() => {
    const orig = btn.textContent; btn.textContent = '✓ Copied';
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
  const d = document.createElement('div'); d.className = 'fp-card';
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
  clipboardWrite(code).then(() => {
    const orig = btn.textContent; btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}
function openFile(p) { vscode.postMessage({type:'open_file', path:p}); }

/* ══════════════════════════════════════
   SESSION MANAGEMENT
══════════════════════════════════════ */
const sessions = [];
let activeSid = null, runningSid = null, sessionLocked = false, sidSeq = 0;

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
  saveSession(activeSid); activeSid=id; clearMsgs();
  const s=sessions.find(x=>x.id===id);
  if(s?.html){
    const tmp=document.createElement('div'); tmp.innerHTML=s.html;
    while(tmp.firstChild) messages.insertBefore(tmp.firstChild, typingEl);
    hideWelcome();
  } else { showWelcome(); }
  scrollMsgs(); renderSessions(); closeDropdowns();
}
function newChat(){
  if(sessionLocked) return;
  if(activeSid!==null) saveSession(activeSid);
  activeSid=null; clearMsgs(); showWelcome(); hideTyping();
  phaseBar.classList.add('hidden');
  currentStepIdx=-1; lastPhase=''; currentPhase=''; readBuf=[]; pendingCard=null;
  resetDividers();
  btnSend.classList.remove('hidden'); btnStop.classList.add('hidden');
  renderSessions(); closeDropdowns(); prompt.focus();
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
  Array.from(messages.children).forEach(n=>{ if(n!==typingEl&&n!==welcomeEl) n.remove(); });
}
function showWelcome(){ welcomeEl.style.display=''; }
function hideWelcome(){ welcomeEl.style.display='none'; }

function renderSessions(){
  const count = sessions.length;
  btnSessions.textContent = count ? `Sessions (${count}) ▾` : 'Sessions ▾';
  if(!count){
    sessionList.innerHTML='<div class="sb-empty">No sessions yet</div>';
    return;
  }
  sessionList.innerHTML='';
  sessions.forEach(s=>{
    const btn=document.createElement('button'); btn.className='sitem'+(s.id===activeSid?' active':'');
    if(sessionLocked&&s.id!==activeSid) btn.disabled=true;
    btn.innerHTML='<div class="s-dot '+s.status+'"></div>'
      +'<div class="s-body">'
      +'<div class="s-prompt">'+esc(s.prompt)+'</div>'
      +'<div class="s-meta">'+relTime(s.ts)+'</div>'
      +'</div>';
    btn.addEventListener('click', ()=>switchSession(s.id));
    sessionList.appendChild(btn);
  });
}
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
    const d=document.createElement('div'); d.className='phase-step'; d.id='st'+i;
    d.innerHTML='<div class="sdot" id="sd'+i+'">'+(i+1)+'</div><div class="slabel">'+s.label+'</div>';
    c.appendChild(d);
    if(i<STEPS.length-1){ const l=document.createElement('div'); l.className='sline'; l.id='sl'+i; c.appendChild(l); }
  });
})();
function setStep(idx,isDbg){
  if(idx===currentStepIdx&&!isDbg) return;
  currentStepIdx=idx;
  STEPS.forEach((_,i)=>{
    const se=document.getElementById('st'+i), de=document.getElementById('sd'+i), le=document.getElementById('sl'+i);
    if(i<idx){ se.className='phase-step done'; de.textContent='✓'; if(le) le.className='sline done'; }
    else if(i===idx){
      const c=isDbg?'var(--cd)':STEPS[i].color;
      se.className='phase-step active'; se.style.setProperty('--sc',c); de.textContent=i+1;
      if(le) le.className='sline';
    } else { se.className='phase-step'; se.style.removeProperty('--sc'); de.textContent=i+1; if(le) le.className='sline'; }
  });
}
function phaseToStep(p){ for(let i=0;i<STEPS.length;i++) if(STEPS[i].phases.includes(p)) return i; return -1; }

/* ── phase dividers ── */
const PM={
  PLANNING:{icon:'📋',label:'PLANNING',color:'var(--cp)'},
  ORCHESTRATING:{icon:'🎯',label:'ORCHESTRATING',color:'var(--cp)'},
  RESEARCHING:{icon:'🔬',label:'RESEARCHING',color:'var(--cr)'},
  SCOPING:{icon:'🗺',label:'SCOPING',color:'var(--cr)'},
  EXECUTION:{icon:'⚡',label:'EXECUTING',color:'var(--ce)'},
  WRITING:{icon:'✏️',label:'WRITING',color:'var(--ce)'},
  VERIFYING:{icon:'🧪',label:'VERIFYING',color:'var(--cv)'},
  REVIEWING:{icon:'👀',label:'REVIEWING',color:'var(--cv)'},
  DEBUGGING:{icon:'🐛',label:'DEBUGGING',color:'var(--cd)'},
};
let lastDividerPhase=''; const seenPhases=new Map();
function addPhaseDivider(phase){
  if(phase===lastDividerPhase) return; lastDividerPhase=phase;
  const m=PM[phase]; if(!m) return;
  const n=(seenPhases.get(phase)||0)+1; seenPhases.set(phase,n);
  if(n>3) return;
  const isRepeat=n>1;
  const d=document.createElement('div'); d.className='pdiv'+(isRepeat?' repeat':'');
  const labelTxt=isRepeat?m.icon+' '+m.label+' ×'+n:m.icon+' '+m.label;
  d.innerHTML='<div class="pdline"></div>'
    +'<div class="pdlabel" style="color:'+m.color+';border-color:'+m.color+'33;background:color-mix(in srgb,'+m.color+' 8%,transparent)">'+labelTxt+'</div>'
    +'<div class="pdline"></div>';
  ibt(d);
}
function resetDividers(){ lastDividerPhase=''; seenPhases.clear(); }

/* ── tool cards ── */
let pendingCard=null, readBuf=[];
function toolStyle(n){
  const t=(n||'').toLowerCase();
  if(/read|list|search|glob|get|find|cat|view|ls/.test(t)) return{icon:'📖',color:'var(--cr)',label:'read'};
  if(/write|creat|patch|edit|updat|delet|remov|modif|apply|put/.test(t)) return{icon:'✏️',color:'var(--ce)',label:'write'};
  if(/run|exec|bash|shell|command|cmd|spawn|npm|test/.test(t)) return{icon:'⚡',color:'var(--cv)',label:'run'};
  return{icon:'🔧',color:'#888',label:'tool'};
}
function flushReads(){
  if(!readBuf.length) return;
  if(readBuf.length===1){
    const c=document.createElement('div'); c.className='tcrd'; c.style.setProperty('--tc','var(--cr)');
    c.innerHTML='<span class="tc-ico">📖</span><span class="tc-name">read</span>'
      +'<span class="tc-file">'+esc((readBuf[0].s||readBuf[0].n).slice(0,80))+'</span><span class="tc-st">✓</span>';
    ibt(c);
  } else {
    const g=document.createElement('div'); g.className='rg-card';
    const items=readBuf.map(r=>'<div class="rg-item">'+esc((r.s||r.n).slice(0,70))+'</div>').join('');
    g.innerHTML='<div class="rg-hdr" onclick="this.parentElement.classList.toggle(\'open\')">'
      +'<span class="tc-ico">📖</span><span class="tc-name">read</span>'
      +'<span class="tc-file">'+readBuf.length+' files</span><span class="rg-caret">▾</span></div>'
      +'<div class="rg-list">'+items+'</div>';
    ibt(g);
  }
  readBuf=[];
}
function addToolCard(name,summary){
  flushReads();
  const s=toolStyle(name); const c=document.createElement('div'); c.className='tcrd pending';
  c.style.setProperty('--tc',s.color);
  c.innerHTML='<span class="tc-ico">'+s.icon+'</span><span class="tc-name">'+s.label+'</span>'
    +'<span class="tc-file">'+esc(summary?summary.slice(0,80):name)+'</span><span class="tc-st">…</span>';
  ibt(c); pendingCard=c;
}
function resolveCard(isErr){
  if(!pendingCard) return;
  pendingCard.classList.remove('pending');
  if(isErr) pendingCard.classList.add('error');
  pendingCard.querySelector('.tc-st').textContent=isErr?'✗':'✓'; pendingCard=null;
}

/* ── message helpers ── */
function addUserMsg(text){
  const d=document.createElement('div'); d.className='msg-u';
  d.innerHTML='<div class="muh"><span class="mtime">'+ts()+'</span><span class="msend">You</span></div>'
    +'<div class="mub">'+esc(text)+'</div>';
  ibt(d);
}
function addAgentMsg(text){
  if(!text?.trim()) return;
  const d=document.createElement('div'); d.className='msg-a';
  d.innerHTML='<div class="av-a">A</div><div class="mab-md">'+renderMarkdown(text)+'</div>';
  ibt(d);
}
function addSysMsg(text,isErr){
  if(!text) return;
  const d=document.createElement('div'); d.className=isErr?'msg-err':'msg-sys';
  d.textContent=isErr?'⚠ '+text:text; ibt(d);
}
function addDoneBanner(){
  const d=document.createElement('div'); d.className='done-banner';
  d.innerHTML='<span>✅</span><span>Task complete</span>'; ibt(d);
}

/* ── provider selection ── */
const PROV_COLORS = {
  chatgpt:    '#10a37f',
  gemini:     '#4285f4',
  deepseek:   '#4f8ef7',
  grok:       '#9b59b6',
  copilot:    '#0078d4',
  copilot365: '#0078d4',
};

let _availableProviders = []; // providers bridge can set up
let _selectedProvider   = null;
let _inSetupMode        = false; // true while bridge is in waiting_provider_selection

const btnProv   = document.getElementById('btn-prov');
const provName  = document.getElementById('prov-name');
const provDrop  = document.getElementById('prov-drop');

function _applyProviderChip(id) {
  const color = PROV_COLORS[id] || 'var(--ce)';
  const label = _availableProviders.find(p => p.id === id)?.name || id;
  btnProv.style.setProperty('--prov-color', color);
  btnProv.classList.toggle('connected', !!id);
  provName.textContent = id ? label : 'No provider';
  provDrop.querySelectorAll('.pi-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === id)
  );
}

/** Populate the provider card list (used for setup selection). */
function buildProviderCards(providers) {
  const list = document.getElementById('psel-list');
  if (!list) return;
  list.innerHTML = '';
  providers.forEach(p => {
    const color = PROV_COLORS[p.id] || '#888';
    const btn = document.createElement('button');
    btn.className = 'psel-card';
    btn.dataset.id = p.id;
    btn.innerHTML = `<span class="psel-card-dot" style="background:${color}"></span>`
      + `<span class="psel-card-name">${p.name || p.label || p.id}</span>`
      + `<span class="psel-card-arr">›</span>`;
    btn.addEventListener('click', () => _onProviderCardClick(p));
    list.appendChild(btn);
  });
}

async function _onProviderCardClick(p) {
  _selectedProvider = p.id;
  _applyProviderChip(p.id);
  // Tell extension which provider was chosen so it can track it
  vscode.postMessage({ type: 'provider_chosen', id: p.id });

  if (_inSetupMode) {
    _inSetupMode = false;
    const id = p.id;
    const label = p.name || p.label || p.id;
    // Pre-build the confirm card so it's ready when waiting_confirm arrives
    buildCards([{ id, label }]);
    show(scrConfirm);
    startBridgeTicker();
    try {
      await fetch('http://localhost:' + _bridgePort + '/api/setup/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: [id] }),
      });
    } catch {}
    // Keep polling so setup_state updates (detected/confirmed) reach the card
    cncStartPoll();
  } else {
    // Bridge already ready — go straight to project
    show(scrProject);
    vscode.postMessage({ type: 'get_workspaces' });
  }
}

/** Populate the in-chat provider dropdown (single item — informational). */
function _buildProvDrop(id) {
  provDrop.innerHTML = '';
  if (!id) return;
  const color = PROV_COLORS[id] || '#888';
  const label = _availableProviders.find(p => p.id === id)?.name || id;
  const hdr = document.createElement('div'); hdr.className = 'pi-hdr'; hdr.textContent = 'Active provider';
  provDrop.appendChild(hdr);
  const item = document.createElement('div');
  item.className = 'pi-item active';
  item.innerHTML = `<span class="pi-dot" style="background:${color}"></span>${label}<span class="pi-check">✓</span>`;
  provDrop.appendChild(item);
}

btnProv.addEventListener('click', e => {
  e.stopPropagation();
  if (!_selectedProvider) return;
  const open = !provDrop.classList.contains('hidden');
  closeDropdowns();
  if (!open) {
    _buildProvDrop(_selectedProvider);
    provDrop.classList.remove('hidden');
    btnProv.classList.add('open');
  }
});
provDrop.addEventListener('click', e => e.stopPropagation());


/* ── connect screen (screen 1) ── */
let _bridgePort = (_INIT && _INIT.bridgePort) || 3333;
let _cncPollTimer = null;
let _cncElapsed = 0;
let _cncState = 'connecting';

function cncShow(state) {
  _cncState = state;
  document.getElementById('cnc-connecting').classList.toggle('hidden', state !== 'connecting');
  document.getElementById('cnc-waiting').classList.toggle('hidden', state !== 'waiting');
  document.getElementById('cnc-offline').classList.toggle('hidden', state !== 'offline');
  document.getElementById('cnc-error').classList.toggle('hidden', state !== 'error');
}

function cncStopPoll() {
  clearInterval(_cncPollTimer);
  _cncPollTimer = null;
}

async function _cncTick() {
  try {
    const res = await fetch('http://localhost:' + _bridgePort + '/api/setup', { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error('not ok');
    const data = await res.json();

    if (data.phase === 'ready') {
      cncStopPoll();
      _onBridgeReady(data);
    } else if (data.phase === 'waiting_provider_selection') {
      // Only show provider screen if we haven't already advanced past it.
      // _inSetupMode===false can mean "not started yet" OR "user already picked",
      // so also guard against scrConfirm/scrProject/scrChat already being visible.
      const alreadyAdvanced = !scrConfirm.classList.contains('hidden')
        || !scrProject.classList.contains('hidden')
        || !scrChat.classList.contains('hidden');
      if (!_inSetupMode && !alreadyAdvanced) {
        _availableProviders = data.availableProviders || [];
        _inSetupMode = true;
        buildProviderCards(_availableProviders);
        show(scrProvider);
        vscode.postMessage({type:'bridge_connected_direct'});
      }
    } else if (data.phase === 'waiting_confirm') {
      if (scrConfirm.classList.contains('hidden')) {
        show(scrConfirm);
        startBridgeTicker();
      }
      if (data.provider) {
        const pid = data.provider.id;
        if (!pcards[pid]) buildCards([{ id: pid, label: data.provider.name || pid }]);
        document.getElementById('bridge-launch').style.display = 'none';
        document.getElementById('pcard-list').classList.remove('hidden');
        setCardPending(pid, data.provider.detected);
      }
      vscode.postMessage({type:'bridge_connected_direct'});
    } else if (data.phase === 'starting') {
      if (_cncState !== 'waiting') cncShow('waiting');
    }
  } catch {
    if (_cncState !== 'offline') {
      cncShow('offline');
      vscode.postMessage({type:'get_bridge_info'});
    }
    _cncElapsed++;
    const countdown = 3 - (_cncElapsed % 3);
    const lbl = document.getElementById('cnc-poll-lbl');
    if (lbl) lbl.textContent = countdown > 0 ? 'Retrying in ' + countdown + 's…' : 'Checking…';
  }
}

function cncStartPoll() {
  cncStopPoll();
  _cncElapsed = 0;
  _cncTick();
  _cncPollTimer = setInterval(_cncTick, 2000);
}

document.getElementById('btn-cnc-retry').addEventListener('click', () => {
  cncShow('connecting');
  cncStartPoll();
});

/* ── provider cards (screen 2) ── */
let pcards={};
function buildCards(providers){
  pcardList.innerHTML=''; pcards={};
  providers.forEach(({id,label})=>{
    const el=document.createElement('div'); el.className='pcard'; el.dataset.id=id;
    el.innerHTML=`<div class="pcard-head">
      <div class="dot waiting" data-dot></div>
      <span class="pcard-name">${label}</span>
      <span class="pcard-tag" data-tag>Waiting…</span>
    </div>
    <div class="pcard-body hidden" data-body></div>`;
    pcardList.appendChild(el); pcards[id]={el,phase:'waiting'};
  });
}
function setCardPending(id,det){
  const c=pcards[id]; if(!c) return; c.phase='pending';
  c.el.querySelector('[data-dot]').className='dot pending';
  c.el.querySelector('[data-tag]').textContent='Needs confirmation';
  const b=c.el.querySelector('[data-body]'); b.classList.remove('hidden');
  b.innerHTML=`<div class="${det?'det-y':'det-n'}">${det?'✓ Interface detected':'⚠ Not detected — log in via the browser panel →'}</div>
    <div class="conf-hint">Log in using the browser panel on the right, then confirm.</div>
    <div class="conf-btns">
      <button class="btn-conf">✓ Confirm Ready</button>
      <button class="btn-skip">Skip</button>
    </div>`;
  b.querySelector('.btn-conf').addEventListener('click', confirmCard);
  b.querySelector('.btn-skip').addEventListener('click', skipCard);
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
    const l=document.createElement('div'); l.className='proj-lbl'; l.textContent='Open workspaces'; projBody.appendChild(l);
    folders.forEach(f=>{
      const c=document.createElement('div'); c.className='proj-card';
      c.innerHTML=`<span class="pi">🗂</span>
        <div class="pinfo"><div class="pname">${esc(f.name)}</div><div class="ppath">${esc(f.path)}</div></div>
        <span class="parr">›</span>`;
      c.addEventListener('click',()=>chooseFolder(f)); projBody.appendChild(c);
    });
  } else {
    const e=document.createElement('div'); e.className='proj-lbl'; e.textContent='No workspace folders open'; projBody.appendChild(e);
  }
}
function chooseFolder(f){ vscode.postMessage({type:'confirm_workspace',name:f.name,path:f.path}); }
document.getElementById('btn-browse').addEventListener('click',()=>vscode.postMessage({type:'browse_folder'}));
document.getElementById('btn-new-folder').addEventListener('click',()=>vscode.postMessage({type:'create_folder'}));

/* ── header bar actions ── */
document.getElementById('btn-new-chat').addEventListener('click', newChat);
document.getElementById('btn-sb-proj').addEventListener('click',()=>{
  closeDropdowns(); vscode.postMessage({type:'change_project'});
});
document.getElementById('btn-sb-prov').addEventListener('click',()=>{
  closeDropdowns();
  _selectedProvider = null; _inSetupMode = false;
  show(scrConnect); cncShow('connecting');
  cncStartPoll();
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
  createSession(text); addUserMsg(text); showTyping();
  phaseBar.classList.remove('hidden'); phaseLbl.textContent='Starting…';
  currentStepIdx=-1; lastPhase=''; readBuf=[]; pendingCard=null; resetDividers();
  vscode.postMessage({type:'start_task', prompt:text, provider: _selectedProvider || undefined});
  prompt.value=''; prompt.style.height='';
  btnSend.classList.add('hidden'); btnStop.classList.remove('hidden');
});
btnStop.addEventListener('click',()=>{
  hideTyping(); phaseBar.classList.add('hidden');
  btnStop.classList.add('hidden'); btnSend.classList.remove('hidden');
  finishSession('stopped'); vscode.postMessage({type:'stop'});
});
prompt.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();btnSend.click();} });
prompt.addEventListener('input',()=>{
  prompt.style.height=''; prompt.style.height=Math.min(prompt.scrollHeight,160)+'px';
  btnSend.disabled=!prompt.value.trim();
});
btnSend.disabled=true;

/* ── incoming messages ── */
window.addEventListener('message',e=>{
  const msg=e.data; if(!msg?.type) return;
  switch(msg.type){

    case 'bridge_port':
      _bridgePort = msg.port || 3333;
      break;

    case 'bridge_info': {
      const cmd = document.getElementById('cnc-cmd');
      if (cmd) cmd.textContent = msg.cmd || 'dev-agent';
      break;
    }

    case 'bridge_offline':
      // Don't reset UI mid-session — the bridge may be slow under load.
      if (runningSid !== null) break;
      // Bridge went down — reset state and go back to connect screen so the
      // next startup cycle (waiting_provider_selection etc.) works correctly.
      cncStopPoll();
      stopBridgeTicker();
      _inSetupMode = false;
      _selectedProvider = null;
      Object.keys(pcards).forEach(id => delete pcards[id]);
      show(scrConnect);
      cncShow('offline');
      cncStartPoll();
      break;

    case 'bridge_starting':
      // Show confirm screen only if bridge jumped straight to waiting_confirm
      // (e.g. BROWSER_AI_PROVIDERS env var set). Otherwise setup_state will handle it.
      break;

    case 'setup_state': {
      const st = msg.state; if(!st) break;
      const blLaunch = document.getElementById('bridge-launch');
      const blStage  = document.getElementById('bl-stage');
      const blDetail = document.getElementById('bl-detail');
      const blElapsed= document.getElementById('bl-elapsed');
      const blPort   = document.getElementById('bl-port');

      if (st.elapsed != null) blElapsed.textContent = st.elapsed + 's elapsed';
      if (st.port) blPort.textContent = 'port ' + st.port;

      if (st.phase === 'waiting_provider_selection') {
        // Don't stop polling — _cncTick needs to keep running to catch waiting_confirm.
        // Guard against going backwards if user already advanced past provider screen.
        const alreadyAdvanced = !scrConfirm.classList.contains('hidden')
          || !scrProject.classList.contains('hidden')
          || !scrChat.classList.contains('hidden');
        if (!_inSetupMode && !alreadyAdvanced) {
          _availableProviders = st.availableProviders || [];
          _inSetupMode = true;
          buildProviderCards(_availableProviders);
          show(scrProvider);
        }
      } else if (st.phase === 'waiting_for_server') {
        blLaunch.classList.remove('error');
        blStage.textContent  = 'Launching browser process…';
        blDetail.textContent = 'Starting Chrome and the automation server';
        pcardList.classList.add('hidden'); blLaunch.style.display = '';
      } else if (st.phase === 'starting') {
        blLaunch.classList.remove('error');
        blStage.textContent  = 'Browser connected';
        blDetail.textContent = 'Running authentication sequence…';
        pcardList.classList.add('hidden'); blLaunch.style.display = '';
      } else if (st.phase === 'waiting_confirm') {
        if (scrConfirm.classList.contains('hidden')) { show(scrConfirm); startBridgeTicker(); }
        blLaunch.style.display = 'none'; pcardList.classList.remove('hidden');
        if (st.provider) {
          const pid = st.provider.id;
          if (!pcards[pid]) buildCards([{ id: pid, label: st.provider.name || pid }]);
          setCardPending(pid, st.provider.detected);
        }
      } else if (st.phase === 'lost_connection') {
        blLaunch.classList.add('error');
        blStage.textContent  = 'Lost connection to browser process';
        blDetail.textContent = 'Lost connection — the bridge process may have crashed.';
        pcardList.classList.add('hidden'); blLaunch.style.display = '';
      }
      break;
    }

    case 'bridge_ready':
      cncStopPoll();
      stopBridgeTicker();
      Object.keys(pcards).forEach(id=>{ if(pcards[id].phase==='waiting') setCardDone(id,'confirm'); });
      _onBridgeReady(msg);
      break;

    case 'bridge_failed':
      cncStopPoll();
      stopBridgeTicker();
      if (!scrChat.classList.contains('hidden') || !scrProject.classList.contains('hidden')) break;
      show(scrConnect);
      cncShow('error');
      document.getElementById('cnc-err-txt').textContent = msg.text || 'Bridge failed to start.';
      break;

    case 'workspaces':
      renderWorkspaces(msg.folders||[]); break;

    case 'folder_chosen':
      chooseFolder(msg.folder); break;

    case 'workspace_confirmed':
      hdrProj.textContent = msg.name || '—';
      show(scrChat); break;

    case 'show_project_screen':
      show(scrProject); vscode.postMessage({type:'get_workspaces'}); break;

    case 'provider_selected_quickpick':
      // Update pill selection if provider is in our list
      if (msg.id) {
        _selectedProvider = msg.id;
        _applyProviderChip(msg.id);
      }
      break;

    case 'phase_change': {
      const ph=msg.phase||'';
      if(ph===lastPhase) break;
      flushReads(); lastPhase=ph; currentPhase=ph;
      const L={
        EXECUTION:'Executing changes…',PLANNING:'Planning approach…',
        ORCHESTRATING:'Selecting pipeline…',RESEARCHING:'Researching codebase…',
        SCOPING:'Scoping task…',VERIFYING:'Verifying changes…',
        REVIEWING:'Reviewing output…',DEBUGGING:'Debugging issues…',WRITING:'Writing code…',
      };
      phaseLbl.textContent=L[ph]||msg.label||ph;
      const si=phaseToStep(ph); if(si>=0) setStep(si,ph==='DEBUGGING');
      addPhaseDivider(ph);
      break;
    }

    case 'tool_call_start':
      if(msg.tool){
        const ts_=toolStyle(msg.tool);
        if(ts_.label==='read'){
          readBuf.push({n:msg.tool,s:msg.paramsSummary||''});
          toolChip.style.display='flex'; toolChip.textContent=(msg.paramsSummary||msg.tool).slice(0,38);
        } else {
          hideTyping(); addToolCard(msg.tool,msg.paramsSummary);
          toolChip.style.display='flex'; toolChip.textContent=(msg.paramsSummary||msg.tool).slice(0,38);
        }
      }
      break;

    case 'tool_call_end':
      if(toolStyle(msg.tool||'').label==='read'){
        toolChip.style.display='none';
      } else {
        flushReads(); resolveCard(!!msg.isError); toolChip.style.display='none'; showTyping();
        if(msg.isError) addSysMsg('Tool error: '+msg.tool,true);
      }
      break;

    case 'file_preview':
      addFilePreview(msg); break;

    case 'message_complete': {
      hideTyping();
      if(SILENT.has(currentPhase)) break;
      const raw=msg.text||msg.content||'';
      const preview=raw.length>2400?raw.slice(0,2400)+'…':raw;
      if(preview.trim()) addAgentMsg(preview);
      break;
    }

    case 'system_message':
      hideTyping(); addSysMsg(msg.text,msg.level==='error');
      if(msg.level!=='error'){ btnSend.classList.remove('hidden'); btnStop.classList.add('hidden'); }
      break;

    case 'session_end':
    case 'task_complete':
      flushReads(); hideTyping(); toolChip.style.display='none';
      setStep(4); addDoneBanner(); finishSession('done');
      btnSend.classList.remove('hidden'); btnStop.classList.add('hidden');
      setTimeout(()=>{ phaseBar.classList.add('hidden'); currentStepIdx=-1; },1400);
      break;
  }
});

/* ── bridge ready helper ── */
function _onBridgeReady(data) {
  if (!scrProject.classList.contains('hidden') || !scrChat.classList.contains('hidden')) return;

  // Merge provider list from the message (extension-side tracking)
  const provs = data?.providers || [];
  if (provs.length) {
    _availableProviders = provs.map(p => ({ id: p.id, name: p.label || p.id }));
    if (!_selectedProvider) _selectedProvider = provs[0].id;
  }

  // Bridge is ready — always go to project. Provider chip shows what we know.
  if (_selectedProvider) _applyProviderChip(_selectedProvider);
  show(scrProject);
  vscode.postMessage({ type: 'get_workspaces' });
}

/* ── bridge launch elapsed ticker ── */
let _bridgeLaunchTs = null;
let _elapsedTick    = null;
function startBridgeTicker() {
  _bridgeLaunchTs = Date.now();
  if (_elapsedTick) clearInterval(_elapsedTick);
  _elapsedTick = setInterval(() => {
    const el = document.getElementById('bl-elapsed');
    if (el && _bridgeLaunchTs) {
      el.textContent = Math.round((Date.now() - _bridgeLaunchTs) / 1000) + 's elapsed';
    }
  }, 1000);
}
function stopBridgeTicker() {
  if (_elapsedTick) { clearInterval(_elapsedTick); _elapsedTick = null; }
}

// On load: jump to the right screen based on what the bridge phase was when this panel opened.
if (_INIT && _INIT.bridgeReady) {
  if (_INIT.bridgeProviders && _INIT.bridgeProviders.length) {
    _availableProviders = _INIT.bridgeProviders.map(p => ({ id: p.id || p, name: p.label || p.id || p }));
    _selectedProvider = _availableProviders[0]?.id || null;
  }
  _onBridgeReady(_INIT);
  vscode.postMessage({type:'bridge_connected_direct'});
} else if (_INIT && _INIT.bridgePhase === 'waiting_provider_selection') {
  _bridgePort = _INIT.bridgePort || 3333;
  _availableProviders = _INIT.availableProviders || [];
  _inSetupMode = true;
  buildProviderCards(_availableProviders);
  show(scrProvider);
  vscode.postMessage({type:'bridge_connected_direct'});
  cncStartPoll(); // keep polling so we catch waiting_confirm if bridge advances
} else {
  cncShow('connecting');
  cncStartPoll();
}
// Signal the extension that the webview is ready — it replies with current bridge status.
vscode.postMessage({type:'panel_ready'});
