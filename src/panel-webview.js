/* jshint browser: true */
/* global acquireVsCodeApi */
const vscode = acquireVsCodeApi();

/* ── debug log (ring buffer, included in debug snapshots) ── */
const _debugLog = [];
const MAX_DEBUG_LOG = 120;
function _dlog(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  _debugLog.push(`[${ts}] ${msg}`);
  if (_debugLog.length > MAX_DEBUG_LOG) _debugLog.shift();
}

/* ── debug snapshot ── */
function debugSnapshot() {
  const state = {
    ts: new Date().toISOString(),
    screen: (() => {
      if (scrChat && !scrChat.classList.contains('hidden')) return 'chat';
      if (scrConnect && !scrConnect.classList.contains('hidden')) return 'connect';
      if (scrProvider && !scrProvider.classList.contains('hidden')) return 'provider';
      if (scrConfirm && !scrConfirm.classList.contains('hidden')) return 'confirm';
      if (scrProject && !scrProject.classList.contains('hidden')) return 'project';
      return 'unknown';
    })(),
    sessionLocked, runningSid, activeSid,
    sessionCount: sessions.length,
    currentPhase, currentStepIdx,
    _compact: typeof _compact !== 'undefined' ? _compact : null,
    aiSessionsBarVisible: aiSessionsBar ? !aiSessionsBar.classList.contains('hidden') : false,
    phaseBarVisible: phaseBar ? !phaseBar.classList.contains('hidden') : false,
    recentLog: _debugLog.slice(-50),
  };
  const html = document.documentElement.outerHTML;
  vscode.postMessage({ type: 'debug_snapshot', html, state });
  _dlog('debug_snapshot sent');
}
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
const aiSessionsBar    = document.getElementById('ai-sessions-bar');
const aiSessPrimary    = document.getElementById('ai-sess-primary');
const aiSessAuxiliary  = document.getElementById('ai-sess-auxiliary');
const toolChip   = document.getElementById('tool-chip');
const prompt     = document.getElementById('prompt');
const btnSend    = document.getElementById('btn-send');
const btnStop    = document.getElementById('btn-stop');
const btnAttach  = document.getElementById('btn-attach');
const attachPreview = document.getElementById('attach-preview');
const sessionList    = document.getElementById('session-list');
const sessionsDrop   = document.getElementById('sessions-drop');
const settingsDrop   = document.getElementById('settings-drop');
const hdrProj    = document.getElementById('hdr-proj');
const btnSessions    = document.getElementById('btn-sessions');
const btnSettingsBtn = document.getElementById('btn-settings');
const btnNewChat     = document.getElementById('btn-new-chat');
const btnNotes       = document.getElementById('btn-notes');
const notesDrawer    = document.getElementById('notes-drawer');
const notesList      = document.getElementById('notes-list');
const notesEmpty     = document.getElementById('notes-empty');
const notesBadge     = document.getElementById('notes-badge');
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

// notes drawer
btnNotes.addEventListener('click', e=>{
  e.stopPropagation();
  closeDropdowns();
  const open = notesDrawer.classList.toggle('open');
  btnNotes.classList.toggle('active', open);
});
document.getElementById('notes-close').addEventListener('click', ()=>{
  notesDrawer.classList.remove('open');
  btnNotes.classList.remove('active');
});
notesDrawer.addEventListener('click', e=>e.stopPropagation());

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

/* ── JSON extraction ── */
function extractAgentText(raw) {
  const s = (raw || '').trim();
  if (!s.startsWith('{') && !s.startsWith('[')) return raw;
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      const strs = parsed.filter(x => typeof x === 'string');
      return strs.length ? strs.join('\n\n') : raw;
    }
    if (typeof parsed !== 'object' || parsed === null) return raw;
    // Priority-ordered fields that typically hold the human-readable content
    const FIELDS = ['plan','review','content','text','message','response',
                    'analysis','summary','result','description','output',
                    'reasoning','explanation','answer','feedback'];
    for (const f of FIELDS) {
      const v = parsed[f];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    // Multi-field: goal + steps
    const parts = [];
    if (typeof parsed.goal === 'string') parts.push(parsed.goal);
    if (typeof parsed.objective === 'string') parts.push(parsed.objective);
    if (Array.isArray(parsed.steps)) {
      parts.push(parsed.steps.map((st, i) =>
        (i+1) + '. ' + (typeof st === 'string' ? st : (st.description || JSON.stringify(st)))
      ).join('\n'));
    }
    if (parts.length) return parts.join('\n\n');
    // Last resort: render as fenced JSON
    return '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
  } catch { return raw; }
}

/* ── phase elapsed timer ── */
let _phaseStartTs = null, _phaseTimer = null, _phaseBaseLabel = '';
function startPhaseTimer(label) {
  _phaseBaseLabel = label;
  _phaseStartTs = Date.now();
  clearInterval(_phaseTimer);
  _phaseTimer = setInterval(() => {
    const s = Math.round((Date.now() - _phaseStartTs) / 1000);
    phaseLbl.textContent = _phaseBaseLabel;
    const el = phaseLbl.querySelector('.phase-elapsed') || (() => {
      const e = document.createElement('span'); e.className = 'phase-elapsed';
      phaseLbl.appendChild(e); return e;
    })();
    el.textContent = ' · ' + (s >= 60 ? Math.floor(s/60)+'m '+s%60+'s' : s+'s');
    // tick the live duration on the active phase pill
    const liveDur = phasePillsEl?.querySelector('.pp-live');
    if (liveDur && _stepTimes[currentStepIdx]) {
      liveDur.textContent = _fmtDur(Date.now() - _stepTimes[currentStepIdx].start);
    }
  }, 1000);
}
function stopPhaseTimer() { clearInterval(_phaseTimer); _phaseTimer = null; _phaseStartTs = null; }

/* ── AI sessions bar ──────────────────────────────────────────────────── */
const _PROVIDER_LABELS = {
  deepseek: 'DeepSeek', chatgpt: 'ChatGPT', gemini: 'Gemini',
  grok: 'Grok', copilot: 'Copilot', claude: 'Claude', unknown: '—',
};
function _providerLabel(id) {
  if (!id) return '—';
  return _PROVIDER_LABELS[id.toLowerCase()] || id;
}
function updateAiSessionBar(role, status, provider, task) {
  if (!aiSessionsBar) return;
  const el = role === 'primary' ? aiSessPrimary : aiSessAuxiliary;
  if (!el) return;

  const nameEl = el.querySelector('.ai-sess-name');
  const taskEl = el.querySelector('.ai-sess-task');
  const isActive = status === 'active';

  el.classList.toggle('active', isActive);
  if (nameEl) nameEl.textContent = _providerLabel(provider);
  if (taskEl) taskEl.textContent = isActive && task ? task : '';

  // Show/hide the bar: show whenever either session has been touched
  aiSessionsBar.classList.add('show');
}
function resetAiSessionBar() {
  if (!aiSessionsBar) return;
  aiSessionsBar.classList.remove('show');
  [aiSessPrimary, aiSessAuxiliary].forEach(el => {
    if (!el) return;
    el.classList.remove('active');
    const nameEl = el.querySelector('.ai-sess-name');
    const taskEl = el.querySelector('.ai-sess-task');
    if (nameEl) nameEl.textContent = '—';
    if (taskEl) taskEl.textContent = '';
  });
}

/* ── copy agent message ── */
function copyMsg(btn) {
  const text = btn.closest('.msg-a').querySelector('.mab-md').innerText;
  clipboardWrite(text).then(() => {
    const orig = btn.textContent; btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
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
   FILE DIFF (Claude Code style)
══════════════════════════════════════ */
function openFile(p) { vscode.postMessage({type:'open_file', path:p}); }

function langColor(ext) {
  const m = {js:'#f7c948',ts:'#3178c6',tsx:'#61dafb',jsx:'#61dafb',
             py:'#3776ab',json:'#f97316',css:'#264de4',scss:'#cf649a',
             html:'#e34f26',md:'#888',sh:'#89e051',go:'#00add8',
             rs:'#dea584',java:'#f89820',cpp:'#f34b7d',c:'#aaa'};
  return m[(ext||'').toLowerCase()] || '#888';
}

function addFileDiff(data) {
  const isNew = data.isNew;
  const ext   = data.ext || '';
  const rel   = data.relPath || '';
  const slash = rel.lastIndexOf('/');
  const fname = slash >= 0 ? rel.slice(slash + 1) : rel;
  const fdir  = slash >= 0 ? rel.slice(0, slash + 1) : '';

  const addTxt = data.added   ? `<span class="ds-add">+${data.added}</span>` : '';
  const remTxt = data.removed ? `<span class="ds-rem">-${data.removed}</span>` : '';
  const badge  = isNew ? `<span class="diff-badge new">new</span>` : '';

  let bodyHtml = '';
  (data.hunks || []).forEach((hunk, hi) => {
    if (hi > 0) bodyHtml += `<div class="diff-hunk-sep">···</div>`;
    for (const line of hunk) {
      const cls   = line.t === 'a' ? 'add' : line.t === 'r' ? 'rem' : 'ctx';
      const sym   = line.t === 'a' ? '+'  : line.t === 'r' ? '−'  : ' ';
      const oldLn = (line.t === 'r' || line.t === 'c') ? (line.o || '') : '';
      const newLn = (line.t === 'a' || line.t === 'c') ? (line.n || '') : '';
      bodyHtml += `<div class="dl ${cls}"><span class="dl-lo">${oldLn}</span><span class="dl-ln">${newLn}</span><span class="dl-sym">${sym}</span><span class="dl-code">${esc(line.s ?? '')}</span></div>`;
    }
  });
  if (!bodyHtml) {
    bodyHtml = `<div class="dl ctx"><span class="dl-lo"></span><span class="dl-ln"></span><span class="dl-sym"> </span><span class="dl-code" style="font-style:italic;opacity:.5">no changes detected</span></div>`;
  }

  const openBtn = data.filePath
    ? `<button class="diff-open" title="Open in editor" onclick="event.stopPropagation();openFile(this.dataset.fp)" data-fp="${esc(data.filePath)}">↗</button>`
    : '';

  // Only auto-open if there are actual changes (skip "no changes detected" cards)
  const hasChanges = (data.added || 0) + (data.removed || 0) > 0 || data.isNew;

  const d = document.createElement('div');
  d.className = 'diff-card' + (hasChanges ? ' open' : ''); // open by default when there are changes
  d.innerHTML = `<div class="diff-hdr">
    <span class="diff-chevron">▶</span>
    <span class="diff-lang-dot" style="background:${langColor(ext)}"></span>
    ${badge}
    <span class="diff-fname">${esc(fname)}</span>
    <span class="diff-fdir">${esc(fdir)}</span>
    <div class="diff-stats">${addTxt}${remTxt}</div>
    ${openBtn}
  </div>
  <div class="diff-body">${bodyHtml}</div>`;
  d.querySelector('.diff-hdr').addEventListener('click', () => d.classList.toggle('open'));
  ibt(d);
  return d;
}

/* ══════════════════════════════════════
   SESSION MANAGEMENT
══════════════════════════════════════ */
const sessions = [];
let activeSid = null, runningSid = null, sessionLocked = false, sidSeq = 0;
let _sessionStartTs = null; // wall-clock start of current task run
let _stoppedByUser = false; // user clicked Stop — suppress session_end done-banner
let _hadError      = false; // session ended with an error
let _activeTaskId  = null;  // tag from extension; stale session_ends are ignored

/* ── session activity tracking ── */
let _writesThisSession = []; // {path, isNew}
let _readsThisSession  = new Set();
let _runsThisSession   = 0;
let _subtasksCompleted = 0;
let _subtasksTotal     = 0;

/* ── phase timeline ── */
let _stepTimes = []; // [{start, end|null}] indexed by STEPS index

/* ── activity strip ── */
const _chipMap = new Map(); // relPath → {chip, added, removed}
let _hiddenChipsCount = 0;
let _totalAdded = 0, _totalRemoved = 0;
let _lastRunSummary = null;
const MAX_CHIPS = 7;
let _notesSeq = 0;

const progressFill      = document.getElementById('progress-fill');
const phaseStats        = document.getElementById('phase-stats');
const ctxMeter          = document.getElementById('ctx-meter');
const ctxFill           = document.getElementById('ctx-fill');
const ctxLbl            = document.getElementById('ctx-lbl');
const phasePillsEl      = document.getElementById('phase-pills');
const activityStrip     = document.getElementById('activity-strip');
const activityChips     = document.getElementById('activity-chips');
const activityOverflow  = document.getElementById('activity-overflow');
const sessionDeltaEl    = document.getElementById('session-delta');
const phaseSubtask      = document.getElementById('phase-subtask');
const taskPin           = document.getElementById('task-pin');
const taskPinText       = document.getElementById('task-pin-text');
const taskPinClose      = document.getElementById('task-pin-close');
const typingLblEl       = document.querySelector('#typing .t-lbl');

const PHASE_PROGRESS = {
  PLANNING:12, ORCHESTRATING:18,
  RESEARCHING:28, SCOPING:35,
  EXECUTION:55, WRITING:60,
  VERIFYING:78, REVIEWING:84,
  DEBUGGING:70,
};

function setProgress(pct, color) {
  progressFill.style.width = pct + '%';
  if (color) progressFill.style.background = color;
}

function resetProgress() {
  progressFill.style.transition = 'none';
  progressFill.style.width = '0';
  progressFill.style.background = '';
  requestAnimationFrame(() => { progressFill.style.transition = ''; });
}

function updatePhaseStats() {
  const r = _readsThisSession.size, w = _writesThisSession.length, x = _runsThisSession;
  const parts = [];
  if (r) parts.push(`<span class="pstat"><span class="pstat-val">${r}</span>r</span>`);
  if (w) parts.push(`<span class="pstat"><span class="pstat-val">${w}</span>w</span>`);
  if (x) parts.push(`<span class="pstat"><span class="pstat-val">${x}</span>!</span>`);
  phaseStats.innerHTML = parts.join('');
}

function resetSessionTracking() {
  _writesThisSession = []; _readsThisSession = new Set(); _runsThisSession = 0;
  _subtasksCompleted = 0; _subtasksTotal = 0;
  _totalAdded = 0; _totalRemoved = 0; _lastRunSummary = null;
  _chipMap.clear(); _hiddenChipsCount = 0;
  if (activityChips) activityChips.innerHTML = '';
  activityOverflow?.classList.add('hidden');
  activityStrip?.classList.add('hidden');
  sessionDeltaEl?.classList.add('hidden');
  _stepTimes = [];
  phasePillsEl?.classList.add('hidden');
  ctxMeter?.classList.remove('show');
  phaseStats.innerHTML = ''; resetProgress();
}

/* ── notes drawer ─────────────────────────────────────────────────── */
function clearNotes() {
  _notesSeq = 0;
  if (notesList) { notesList.innerHTML = ''; notesList.appendChild(notesEmpty); }
  notesBadge?.classList.remove('show');
}

function addNoteChip(type, html) {
  _notesSeq++;
  notesEmpty?.remove();
  const cfg = { plan:{ label:'Plan', icon:'≡' }, review:{ label:'Review', icon:'◎' } }[type]
    || { label: type, icon: '·' };
  const chip = document.createElement('div');
  chip.className = 'note-chip ' + type + ' open';
  chip.innerHTML = '<div class="note-chip-hdr" onclick="this.parentElement.classList.toggle(\'open\')">'
    + '<span class="note-chip-icon">' + cfg.icon + '</span>'
    + '<span class="note-chip-label">' + cfg.label + '</span>'
    + '<span class="note-chip-seq">#' + _notesSeq + '</span>'
    + '<span class="note-chip-caret">▾</span>'
    + '</div>'
    + '<div class="note-chip-body mab-md">' + html + '</div>';
  notesList?.appendChild(chip);
  if (notesBadge) { notesBadge.textContent = _notesSeq; notesBadge.classList.add('show'); }
}

/* ── phase timeline helpers ── */
function _fmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  return Math.floor(s/60) + 'm' + (s % 60 ? (s%60) + 's' : '');
}

function enterStep(idx) {
  if (idx < 0) return;
  const now = Date.now();
  if (!_stepTimes[idx]) _stepTimes[idx] = { start: now, end: null };
  for (let i = 0; i < idx; i++) {
    if (_stepTimes[i] && _stepTimes[i].end === null) _stepTimes[i].end = now;
  }
  renderPhasePills();
}

function renderPhasePills() {
  if (!phasePillsEl) return;
  phasePillsEl.innerHTML = '';
  phasePillsEl.classList.remove('hidden');
  STEPS.forEach((step, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'pp-sep'; sep.textContent = '›';
      phasePillsEl.appendChild(sep);
    }
    const t = _stepTimes[i];
    const isActive = i === currentStepIdx;
    const isDone = t && t.end !== null;
    const item = document.createElement('div');
    item.className = 'pp-item' + (isDone ? ' done' : isActive ? ' active' : '');
    item.style.setProperty('--pc', step.color);
    if (isDone) {
      item.innerHTML = '<span class="pp-check">✓</span>'
        + '<span class="pp-label">' + step.label + '</span>'
        + '<span class="pp-dur">' + _fmtDur(t.end - t.start) + '</span>';
    } else if (isActive) {
      const el = t ? _fmtDur(Date.now() - t.start) : '';
      item.innerHTML = '<span class="pp-pulse"></span>'
        + '<span class="pp-label">' + step.label + '</span>'
        + (el ? '<span class="pp-dur pp-live">' + el + '</span>' : '');
    } else {
      item.innerHTML = '<span class="pp-num">' + (i+1) + '</span>'
        + '<span class="pp-label">' + step.label + '</span>';
    }
    phasePillsEl.appendChild(item);
  });
}

/* ── activity strip helpers ── */
function addActivityChip(data, diffEl) {
  if (!activityStrip) return;
  activityStrip.classList.remove('hidden');
  const { relPath='', ext='', isNew, added=0, removed=0 } = data;
  const slash = relPath.lastIndexOf('/');
  const fname = slash >= 0 ? relPath.slice(slash+1) : relPath;

  if (_chipMap.has(relPath)) {
    const entry = _chipMap.get(relPath);
    entry.added += added; entry.removed += removed;
    const st = entry.chip.querySelector('.ac-stats');
    if (st) st.innerHTML = _chipStatsHtml(entry.added, entry.removed, isNew);
    return;
  }
  const chip = document.createElement('div');
  chip.className = 'ac-chip';
  chip.title = relPath;
  chip.innerHTML = '<span class="ac-dot" style="background:' + langColor(ext) + '"></span>'
    + '<span class="ac-name">' + esc(fname) + '</span>'
    + '<span class="ac-stats">' + _chipStatsHtml(added, removed, isNew) + '</span>';
  if (diffEl) chip.addEventListener('click', e => {
    e.stopPropagation();
    diffEl.scrollIntoView({ behavior:'smooth', block:'nearest' });
    diffEl.classList.add('diff-flash');
    setTimeout(() => diffEl.classList.remove('diff-flash'), 750);
  });
  _placeChip(chip);
  _chipMap.set(relPath, { chip, added, removed });
}


function _placeChip(chip) {
  const visible = activityChips.querySelectorAll('.ac-chip').length;
  if (visible < MAX_CHIPS) {
    activityChips.appendChild(chip);
  } else {
    _hiddenChipsCount++;
    if (activityOverflow) {
      activityOverflow.textContent = '+' + _hiddenChipsCount + ' more';
      activityOverflow.classList.remove('hidden');
    }
  }
}

function _chipStatsHtml(added, removed, isNew) {
  if (isNew) return '<span class="ac-new">new</span>';
  let s = '';
  if (added)   s += '<span class="ac-add">+' + added + '</span>';
  if (removed) s += '<span class="ac-rem">-' + removed + '</span>';
  return s;
}

function updateSessionDelta(added, removed) {
  _totalAdded += added; _totalRemoved += removed;
  if (!sessionDeltaEl) return;
  if (!_totalAdded && !_totalRemoved) { sessionDeltaEl.classList.add('hidden'); return; }
  sessionDeltaEl.classList.remove('hidden');
  let html = '';
  if (_totalAdded)   html += '<span class="sd-add">+' + _totalAdded + '</span>';
  if (_totalRemoved) html += '<span class="sd-rem"> −' + _totalRemoved + '</span>';
  sessionDeltaEl.innerHTML = html;
}

function updateCtxMeter(messageCount, threshold, segmentIndex) {
  if (!ctxMeter || !ctxFill || !ctxLbl) return;
  if (!threshold) { ctxMeter.classList.remove('show'); return; }
  const pct = Math.min(100, Math.round((messageCount / threshold) * 100));
  ctxFill.style.width = pct + '%';
  ctxFill.classList.toggle('warn', pct >= 60 && pct < 85);
  ctxFill.classList.toggle('crit', pct >= 85);
  // Show "S2 · 45/60" when on a non-first segment so rotation is obvious
  const segPfx = segmentIndex > 1 ? 'S' + segmentIndex + ' · ' : '';
  ctxLbl.textContent = segPfx + messageCount + '/' + threshold;
  ctxMeter.classList.add('show');
}

function addHandoffCard(msg) {
  const d = document.createElement('div');
  d.className = 'handoff-card';

  const provLabel = (msg.providerName || 'Browser')
    .replace('copilot365','Copilot').replace('deepseek','DeepSeek').replace('claude','Claude');
  const sessionNum = msg.segmentIndex ?? 1;

  // Progress fraction
  const subtasks = msg.subtasks || [];
  const currentIdx = msg.currentSubtaskIndex ?? 0;
  const completedCount = subtasks.filter((_, i) => i < currentIdx).length;
  const totalCount = subtasks.length;
  const currentTask = subtasks[currentIdx]?.task || '';
  const modCount = (msg.allModifiedFiles || []).length;

  // Progress bar segments
  let progressBar = '';
  if (totalCount > 0) {
    const pct = Math.round((completedCount / totalCount) * 100);
    progressBar = '<div class="hc-progress-wrap">'
      + '<div class="hc-progress-bar"><div class="hc-progress-fill" style="width:' + pct + '%"></div></div>'
      + '<span class="hc-progress-label">' + completedCount + '/' + totalCount + ' subtasks</span>'
      + '</div>';
  }

  // Subtask list (collapsible)
  let taskList = '';
  if (subtasks.length > 0) {
    const rows = subtasks.map((s, i) => {
      const marker = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'pending';
      const glyph = i < currentIdx ? '✓' : i === currentIdx ? '→' : '○';
      const filesNote = s.files?.length > 0 ? '<span class="hc-task-files">' + esc(s.files.join(', ')) + '</span>' : '';
      return '<div class="hc-task ' + marker + '">'
        + '<span class="hc-task-marker">' + glyph + '</span>'
        + '<span class="hc-task-label">' + esc(s.task) + '</span>'
        + filesNote
        + '</div>';
    }).join('');
    taskList = '<div class="hc-tasks hidden">' + rows + '</div>';
  }

  d.innerHTML =
    '<div class="hc-header" onclick="this.nextElementSibling?.classList.toggle(\'hidden\');this.querySelector(\'.hc-caret\').classList.toggle(\'open\')">'
    + '<span class="hc-icon">↻</span>'
    + '<div class="hc-header-body">'
    + '<div class="hc-title">Session ' + sessionNum + ' · ' + provLabel + '</div>'
    + '<div class="hc-subtitle">'
    + (currentTask ? 'Continuing: <em>' + esc(currentTask.slice(0, 60)) + (currentTask.length > 60 ? '…' : '') + '</em>' : 'Context handed off to new session')
    + (modCount > 0 ? ' · ' + modCount + ' file' + (modCount !== 1 ? 's' : '') + ' carried over' : '')
    + '</div>'
    + progressBar
    + '</div>'
    + (subtasks.length > 0 ? '<span class="hc-caret">▾</span>' : '')
    + '</div>'
    + taskList;

  ibt(d);
  updateCtxMeter(0, msg.threshold ?? null);
}

function addSpecialCard(type, text) {
  if (!text?.trim()) return;
  const cfg = {
    plan:   { label:'Plan',   color:'var(--cp)', icon:'≡' },
    review: { label:'Review', color:'var(--cv)', icon:'◎' },
  }[type] || { label: type, color: 'var(--mu)', icon:'·' };
  const renderedHtml = renderMarkdown(text);
  const d = document.createElement('div'); d.className = 'sc-card ' + type + ' open';
  d.innerHTML = '<div class="sc-hdr" onclick="this.parentElement.classList.toggle(\'open\')">'
    + '<span class="sc-icon" style="color:'+cfg.color+'">'+cfg.icon+'</span>'
    + '<span class="sc-label">'+cfg.label+'</span>'
    + '<span class="sc-caret">▾</span>'
    + '</div>'
    + '<div class="sc-body mab-md">'+renderedHtml+'</div>';
  ibt(d);
  requestAnimationFrame(()=>{
    const body=d.querySelector('.sc-body');
    if(body && body.scrollHeight>320){ d.classList.add('collapsible'); _addExpandToggle(d, body); }
  });
  addNoteChip(type, renderedHtml);
}

function addChangesSummary() {
  if (!_writesThisSession.length && !_runsThisSession) return;
  const d = document.createElement('div'); d.className = 'changes-card open';
  const wLabel = _writesThisSession.length
    ? _writesThisSession.length + ' file' + (_writesThisSession.length > 1 ? 's' : '') + ' written'
    : '';
  const rLabel = _runsThisSession
    ? _runsThisSession + ' command' + (_runsThisSession > 1 ? 's' : '') + ' run'
    : '';
  const title = [wLabel, rLabel].filter(Boolean).join(' · ');
  const items = _writesThisSession.map(f => {
    const sym = f.isNew ? 'new' : 'mod', glyph = f.isNew ? '+' : '✎', tag = f.isNew ? 'new' : '';
    return '<div class="change-item">'
      + '<span class="change-sym '+sym+'">'+glyph+'</span>'
      + '<span class="change-path">'+esc(f.path)+'</span>'
      + (tag ? '<span class="change-tag">'+tag+'</span>' : '')
      + '</div>';
  });
  if (_runsThisSession) {
    items.push('<div class="change-item">'
      + '<span class="change-sym run">⚡</span>'
      + '<span class="change-path">'+_runsThisSession+' shell command'+ (_runsThisSession>1?'s ran':'ran')+'</span>'
      + '</div>');
  }
  d.innerHTML = '<div class="changes-hdr" onclick="this.parentElement.classList.toggle(\'open\')">'
    + '<span class="changes-title">'+title+'</span>'
    + '<span class="changes-caret">▾</span>'
    + '</div>'
    + '<div class="changes-list">'+items.join('')+'</div>';
  ibt(d);
}

function createSession(promptText){
  if(activeSid !== null) saveSession(activeSid);
  const id = ++sidSeq;
  _sessionStartTs = Date.now();
  _stoppedByUser = false; _hadError = false;
  resetSessionTracking(); clearNotes();
  sessions.unshift({id, prompt:promptText.slice(0,80), ts:new Date(), status:'running', html:'', notes:[], tools:0});
  activeSid = id; runningSid = id; sessionLocked = true;
  clearMsgs(); hideWelcome();
  renderSessions();
  return id;
}
function finishSession(status){
  const s=sessions.find(x=>x.id===runningSid);
  if(s){
    s.status=status;
    if(_sessionStartTs) s.elapsed=Math.round((Date.now()-_sessionStartTs)/1000);
    s.files=_writesThisSession.length;
    if(_subtasksTotal>1) s.subtasks={done:_subtasksCompleted,total:_subtasksTotal};
  }
  saveSession(activeSid);
  runningSid=null; sessionLocked=false;
  renderSessions();
}
function switchSession(id){
  if(sessionLocked||id===activeSid) return;
  saveSession(activeSid); activeSid=id; clearMsgs(); clearNotes();
  const s=sessions.find(x=>x.id===id);
  if(s?.html){
    const tmp=document.createElement('div'); tmp.innerHTML=s.html;
    while(tmp.firstChild) messages.insertBefore(tmp.firstChild, typingEl);
    hideWelcome();
  } else { showWelcome(); }
  if(s?.notes?.length) s.notes.forEach(n=>addNoteChip(n.type, n.html));
  scrollMsgs(); renderSessions(); closeDropdowns();
}
function newChat(){
  if(sessionLocked) return;
  if(activeSid!==null) saveSession(activeSid);
  activeSid=null; clearMsgs(); showWelcome(); hideTyping();
  phaseBar.classList.add('hidden');
  phasePillsEl?.classList.add('hidden');
  activityStrip?.classList.add('hidden');
  sessionDeltaEl?.classList.add('hidden');
  ctxMeter?.classList.remove('show');
  taskPin?.classList.remove('show');
  if (phaseSubtask) phaseSubtask.classList.remove('show');
  if (typingLblEl) typingLblEl.textContent = '';
  stopPhaseTimer();
  _stoppedByUser=false; _hadError=false;
  _userScrolled=false; scrollBtn.classList.remove('show');
  currentStepIdx=-1; lastPhase=''; currentPhase=''; readBuf=[]; pendingCard=null;
  _stepTimes=[]; _chipMap.clear(); _hiddenChipsCount=0;
  _totalAdded=0; _totalRemoved=0;
  if(activityChips) activityChips.innerHTML='';
  activityOverflow?.classList.add('hidden');
  resetDividers();
  _histIdx=-1;
  clearNotes();
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
  // save notes for this session
  s.notes = notesList ? Array.from(notesList.querySelectorAll('.note-chip')).map(c=>({
    type: c.classList.contains('plan') ? 'plan' : 'review',
    html: c.querySelector('.note-chip-body')?.innerHTML || '',
  })) : [];
}
function clearMsgs(){
  Array.from(messages.children).forEach(n=>{ if(n!==typingEl&&n!==welcomeEl) n.remove(); });
}
function showWelcome(){ welcomeEl.style.display=''; }
function hideWelcome(){ welcomeEl.style.display='none'; }

function renderSessions(){
  const count = sessions.length;
  const badge = document.getElementById('session-count');
  if (badge) badge.textContent = count > 1 ? count : '';
  if(!count){
    sessionList.innerHTML='<div class="sb-empty">No sessions yet</div>';
    return;
  }
  sessionList.innerHTML='';
  sessions.forEach(s=>{
    const btn=document.createElement('button'); btn.className='sitem'+(s.id===activeSid?' active':'');
    if(sessionLocked&&s.id!==activeSid) btn.disabled=true;
    const metaParts=[relTime(s.ts)];
    if(s.files) metaParts.push(s.files+' file'+(s.files!==1?'s':''));
    if(s.tools) metaParts.push(s.tools+' tools');
    if(s.subtasks) metaParts.push(s.subtasks.done+'/'+s.subtasks.total+' subtasks');
    if(s.elapsed!=null){ const m=Math.floor(s.elapsed/60), sec=s.elapsed%60; metaParts.push(m?m+'m '+sec+'s':sec+'s'); }
    btn.innerHTML='<div class="s-dot '+s.status+'"></div>'
      +'<div class="s-body">'
      +'<div class="s-prompt">'+esc(s.prompt)+'</div>'
      +'<div class="s-meta">'+metaParts.join(' · ')+'</div>'
      +'</div>';
    btn.addEventListener('click', ()=>switchSession(s.id));
    sessionList.appendChild(btn);
  });
}
setInterval(renderSessions, 30000);

/* ── scroll / typing ── */
const scrollBtn = document.getElementById('scroll-btn');
let _userScrolled = false;

messages.addEventListener('scroll', () => {
  const threshold = 80;
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < threshold;
  _userScrolled = !atBottom;
  scrollBtn.classList.toggle('show', _userScrolled);
});
scrollBtn.addEventListener('click', () => {
  _userScrolled = false;
  scrollBtn.classList.remove('show');
  messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
});

function scrollMsgs(){
  if(!_userScrolled) messages.scrollTop=messages.scrollHeight;
}
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
  PLANNING:{icon:'○',label:'PLANNING',color:'var(--cp)'},
  ORCHESTRATING:{icon:'○',label:'ORCHESTRATING',color:'var(--cp)'},
  RESEARCHING:{icon:'◎',label:'RESEARCHING',color:'var(--cr)'},
  SCOPING:{icon:'◎',label:'SCOPING',color:'var(--cr)'},
  EXECUTION:{icon:'▷',label:'EXECUTING',color:'var(--ce)'},
  WRITING:{icon:'▷',label:'WRITING',color:'var(--ce)'},
  VERIFYING:{icon:'◇',label:'VERIFYING',color:'var(--cv)'},
  REVIEWING:{icon:'◇',label:'REVIEWING',color:'var(--cv)'},
  DEBUGGING:{icon:'△',label:'DEBUGGING',color:'var(--cd)'},
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
    const c=document.createElement('div'); c.className='tcrd done';
    c.innerHTML='<span class="tc-pfx">↳</span><span class="tc-name">read</span>'
      +'<span class="tc-file">'+esc((readBuf[0].s||readBuf[0].n).slice(0,80))+'</span>'
      +'<span class="tc-st">✓</span>';
    ibt(c);
  } else {
    const g=document.createElement('div'); g.className='rg-card';
    const items=readBuf.map(r=>'<div class="rg-item">'+esc((r.s||r.n).slice(0,70))+'</div>').join('');
    g.innerHTML='<div class="rg-hdr" onclick="this.parentElement.classList.toggle(\'open\')">'
      +'<span class="tc-pfx">↳</span><span class="tc-name">read</span>'
      +'<span class="tc-file">'+readBuf.length+' files</span>'
      +'<span class="rg-caret">▾</span></div>'
      +'<div class="rg-list">'+items+'</div>';
    ibt(g);
  }
  readBuf=[];
}
function addToolCard(name,summary){
  flushReads();
  const s=toolStyle(name); const c=document.createElement('div'); c.className='tcrd pending '+s.label;
  c.innerHTML='<span class="tc-pfx">↳</span><span class="tc-name">'+s.label+'</span>'
    +'<span class="tc-file">'+esc(summary?summary.slice(0,80):name)+'</span>'
    +'<span class="tc-st">—</span>';
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
  d.innerHTML='<div class="msg-sender">You</div>'
    +'<div class="msg-body">'+esc(text)+'</div>';
  ibt(d);
}
function addAttachmentMsg(count){
  const d=document.createElement('div'); d.className='msg-u att-sent';
  d.innerHTML='<div class="msg-sender">You</div>'
    +'<div class="msg-body att-body">📎 '+count+' image'+(count!==1?'s':'')+' attached</div>';
  ibt(d);
}
function _addExpandToggle(container, bodyEl) {
  const btn = document.createElement('button');
  btn.className = 'msg-expand-btn';
  btn.textContent = 'Show more ▾';
  btn.addEventListener('click', () => {
    const expanded = container.classList.toggle('expanded');
    btn.textContent = expanded ? 'Show less ▴' : 'Show more ▾';
    if (expanded) scrollMsgs();
  });
  container.appendChild(btn);
}

function addAgentMsg(text){
  if(!text?.trim()) return;
  const d=document.createElement('div'); d.className='msg-a';
  d.innerHTML='<div class="msg-sender agent">Dev Agent</div>'
    +'<div class="mab-md">'+renderMarkdown(text)+'</div>'
    +'<button class="msg-copy" onclick="copyMsg(this)" title="Copy response">⎘</button>';
  ibt(d);
  requestAnimationFrame(()=>{
    const body=d.querySelector('.mab-md');
    if(body && body.scrollHeight>320){ d.classList.add('collapsible'); _addExpandToggle(d, body); }
  });
}
function addSysMsg(text,isErr,isWarn,isOk){
  if(!text) return;
  const d=document.createElement('div');
  if(isErr){ d.className='msg-err'; d.textContent='✗ '+text; }
  else if(isWarn){ d.className='msg-warn'; d.textContent=text; }
  else if(isOk){ d.className='msg-ok'; d.textContent=text; }
  else { d.className='msg-sys'; d.textContent=text; }
  ibt(d);
}
function _bannerTime() {
  if (!_sessionStartTs) return '';
  const s = Math.round((Date.now() - _sessionStartTs) / 1000);
  return ' · ' + (s >= 60 ? Math.floor(s/60) + 'm ' + s%60 + 's' : s + 's');
}

function _addBannerActs(lastPrompt) {
  if (!lastPrompt) return;
  const acts = document.createElement('div'); acts.className = 'banner-acts';
  const fileCount = _writesThisSession.length;
  const newCount  = _writesThisSession.filter(f => f.isNew).length;
  const fileStat  = fileCount ? (fileCount + ' file' + (fileCount !== 1 ? 's' : '') + (newCount ? ' · ' + newCount + ' new' : '')) : '';
  acts.innerHTML =
    (fileStat ? '<span class="bstat">' + fileStat + '</span>' : '')
    + '<button class="bact primary" data-p="'+esc(lastPrompt)+'" onclick="retryPrompt(this)">↺ Run again</button>'
    + '<button class="bact" onclick="fillPrompt(\'Fix any remaining issues, errors or warnings\')">Fix issues</button>'
    + '<button class="bact" onclick="fillPrompt(\'Add comprehensive tests for all the changes made\')">Add tests</button>'
    + '<button class="bact" onclick="fillPrompt(\'Review the code and suggest improvements\')">Review</button>';
  ibt(acts);
}

function retryPrompt(btn) {
  const text = btn?.dataset?.p || _history[0] || '';
  if (!text || sessionLocked) return;
  fillPrompt(text);
  btnSend.click();
}

function addDoneBanner(){
  const d=document.createElement('div'); d.className='done-banner';
  let label='✓ Task complete' + _bannerTime();
  const sess=sessions.find(x=>x.id===runningSid||x.id===activeSid);
  if(sess?.tools) label+=' · '+sess.tools+' tools';
  if(_subtasksTotal > 1) label+=' · '+_subtasksCompleted+'/'+_subtasksTotal+' subtasks';
  d.innerHTML='<div class="done-line"></div><span>'+label+'</span><div class="done-line"></div>';
  ibt(d);
  _addBannerActs(_history[0]);
}
function addStopBanner(){
  const d=document.createElement('div'); d.className='stop-banner';
  d.innerHTML='<div class="stop-line"></div><span>✗ Stopped'+_bannerTime()+'</span><div class="stop-line"></div>';
  ibt(d);
  _addBannerActs(_history[0]);
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
        const provLabel = data.provider.name || pid;
        if (!pcards[pid]) buildCards([{ id: pid, label: provLabel }]);
        document.getElementById('bridge-launch').style.display = 'none';
        document.getElementById('pcard-list').classList.remove('hidden');
        setCardPending(pid, data.provider.detected);
        const titleEl = scrConfirm.querySelector('.sh-title');
        if (titleEl) titleEl.textContent = 'Log in to ' + provLabel;
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
      c.innerHTML=`<div class="pinfo"><div class="pname">${esc(f.name)}</div><div class="ppath">${esc(f.path)}</div></div>`
        +`<span class="parr">›</span>`;
      c.addEventListener('click',()=>chooseFolder(f)); projBody.appendChild(c);
    });
  } else {
    const e=document.createElement('div'); e.className='proj-lbl'; e.textContent='No workspace folders open'; projBody.appendChild(e);
  }
}
function chooseFolder(f){ vscode.postMessage({type:'confirm_workspace',name:f.name,path:f.path}); }
document.getElementById('btn-browse').addEventListener('click',()=>vscode.postMessage({type:'browse_folder'}));
document.getElementById('btn-new-folder').addEventListener('click',()=>vscode.postMessage({type:'create_folder'}));

/* ── compact mode ── */
const chatMain = document.getElementById('chat-main');
const compactDot = document.getElementById('compact-dot');
let _compact = localStorage.getItem('da-compact') === '1';
function applyCompact() {
  chatMain.classList.toggle('compact', _compact);
  compactDot?.classList.toggle('on', _compact);
}
applyCompact();
document.getElementById('btn-compact').addEventListener('click', e => {
  e.stopPropagation();
  _compact = !_compact;
  localStorage.setItem('da-compact', _compact ? '1' : '0');
  applyCompact();
});

/* ── export transcript ── */
function exportSession() {
  closeDropdowns();
  const lines = [];
  for (const node of messages.children) {
    if (node === typingEl || node === welcomeEl) continue;
    if (node.classList.contains('msg-u')) {
      lines.push('**You**\n' + (node.querySelector('.msg-body')?.textContent || '').trim());
    } else if (node.classList.contains('msg-a')) {
      lines.push('**Dev Agent**\n' + (node.querySelector('.mab-md')?.innerText || '').trim());
    } else if (node.classList.contains('diff-card')) {
      const dir = node.querySelector('.diff-fdir')?.textContent || '';
      const fname = node.querySelector('.diff-fname')?.textContent || '';
      const st = node.querySelector('.diff-stats')?.textContent || '';
      lines.push('`' + dir + fname + '`' + (st ? '  ' + st : ''));
    } else if (node.classList.contains('done-banner') || node.classList.contains('stop-banner')) {
      lines.push('---\n' + (node.querySelector('span')?.textContent || '').trim());
    }
  }
  const text = lines.join('\n\n');
  clipboardWrite(text).then(() => {
    const btn = document.getElementById('btn-export');
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(() => btn.textContent = orig, 1500); }
  });
}
document.getElementById('btn-export').addEventListener('click', exportSession);
if (taskPinClose) taskPinClose.addEventListener('click', () => taskPin?.classList.remove('show'));

/* ── char count ── */
const inpChar = document.getElementById('inp-char');
const inpHint = document.getElementById('inp-hint');

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
document.getElementById('btn-stop-bridge').addEventListener('click',()=>{
  closeDropdowns();
  vscode.postMessage({type:'stop_bridge'});
});
/* ── welcome example prompts ── */
document.querySelectorAll('.w-ex').forEach(btn=>{
  btn.addEventListener('click',()=>{
    prompt.value=btn.dataset.prompt;
    prompt.dispatchEvent(new Event('input'));
    prompt.focus();
  });
});

/* ── input history ── */
const _history = [];
let _histIdx = -1, _histSaved = '';

function histPush(text) {
  if (_history[0] !== text) _history.unshift(text);
  if (_history.length > 50) _history.pop();
  _histIdx = -1;
}

/* ── image attachments ── */
let _pendingImages = []; // [{data: base64DataUrl, mimeType, name}]

function renderAttachPreviews() {
  if (!attachPreview) return;
  attachPreview.innerHTML = '';
  _pendingImages.forEach((img, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'att-thumb';
    const im = document.createElement('img');
    im.src = img.data;
    im.alt = img.name || 'image';
    const rm = document.createElement('button');
    rm.className = 'att-rm';
    rm.title = 'Remove';
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      _pendingImages.splice(idx, 1);
      renderAttachPreviews();
    });
    wrap.appendChild(im);
    wrap.appendChild(rm);
    attachPreview.appendChild(wrap);
  });
  attachPreview.classList.toggle('hidden', _pendingImages.length === 0);
}

function addImageFromFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const raw = e.target.result; // data:image/png;base64,...
    _pendingImages.push({ data: raw, mimeType: file.type, name: file.name });
    renderAttachPreviews();
  };
  reader.readAsDataURL(file);
}

if (btnAttach) {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);
  fileInput.addEventListener('change', () => {
    Array.from(fileInput.files).forEach(addImageFromFile);
    fileInput.value = '';
  });
  btnAttach.addEventListener('click', () => fileInput.click());
}

// Paste images from clipboard into the input area
prompt.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  let hasImage = false;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      hasImage = true;
      const file = item.getAsFile();
      if (file) addImageFromFile(file);
    }
  }
  // Don't prevent default — allow text paste to continue normally
});

/* ── streaming state ── */
let _streamingEl = null;
let _streamingBuf = '';

/* ── phase color map (matches CSS --cp/--cr/--ce/--cv/--cd/--ck) ── */
const PHASE_COLORS = {
  PLANNING:      'var(--cp)', ORCHESTRATING: 'var(--cp)',
  RESEARCHING:   'var(--cr)', SCOPING:       'var(--cr)',
  EXECUTION:     'var(--ce)', WRITING:       'var(--ce)',
  VERIFYING:     'var(--cv)', REVIEWING:     'var(--cv)',
  DEBUGGING:     'var(--cd)',
};

/* ── send / stop ── */
let currentPhase='';
// PLANNING and REVIEWING show as collapsible special cards; others are silent
const SILENT=new Set(['ORCHESTRATING','RESEARCHING','SCOPING']);

btnSend.addEventListener('click',()=>{
  const text=prompt.value.trim(); if(!text && !_pendingImages.length) return;
  histPush(text); _histIdx = -1;
  _dlog('send: "'+text.slice(0,60)+'"');
  // Clear any leftover streaming state from a previous session
  if (_streamingEl) { _streamingEl.remove(); _streamingEl = null; _streamingBuf = ''; }
  createSession(text); addUserMsg(text); showTyping();
  if(_pendingImages.length) addAttachmentMsg(_pendingImages.length);
  phaseBar.classList.remove('hidden'); phaseLbl.textContent='Starting…';
  phaseBar.style.removeProperty('--phase-color');
  progressFill.style.removeProperty('--phase-color');
  // Show pinned task prompt
  if (taskPinText) taskPinText.textContent = text.length > 90 ? text.slice(0, 90) + '…' : text;
  taskPin?.classList.add('show');
  // Reset subtask counter
  if (phaseSubtask) { phaseSubtask.textContent=''; phaseSubtask.classList.remove('show'); }
  // Reset typing label
  if (typingLblEl) typingLblEl.textContent = '';
  currentStepIdx=-1; lastPhase=''; currentPhase=''; readBuf=[]; pendingCard=null; resetDividers();
  stopPhaseTimer();
  resetAiSessionBar();
  // Serialize images as {data, mimeType} objects — strip the name field to keep the payload lean
  const images = _pendingImages.map(i=>({data:i.data, mimeType:i.mimeType}));
  vscode.postMessage({type:'start_task', prompt:text, provider: _selectedProvider || undefined, ...(images.length?{images}:{})});
  prompt.value=''; prompt.style.height=''; btnSend.disabled=true;
  _pendingImages=[]; renderAttachPreviews();
  btnSend.classList.add('hidden'); btnStop.classList.remove('hidden');
});
btnStop.addEventListener('click',()=>{
  if(btnStop.disabled) return;
  btnStop.disabled=true;
  _stoppedByUser=true;
  // Show "Stopping…" feedback in the phase bar
  phaseLbl.textContent='Stopping…';
  const elapsed=phaseLbl.querySelector('.phase-elapsed'); if(elapsed) elapsed.remove();
  toolChip.style.display='none';
  // Signal extension immediately
  vscode.postMessage({type:'stop'});
  // Brief delay so user sees the feedback, then clean up
  setTimeout(()=>{
    flushReads(); hideTyping(); stopPhaseTimer();
    addStopBanner();
    finishSession('stopped');
    btnStop.classList.add('hidden'); btnStop.disabled=false;
    btnSend.classList.remove('hidden');
    setTimeout(()=>{ phaseBar.classList.add('hidden'); currentStepIdx=-1; resetProgress(); },300);
  }, 300);
});

prompt.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); btnSend.click(); return; }

  // History navigation (only when cursor is at start of first line)
  const atLineStart = prompt.selectionStart === 0;
  if(e.key==='ArrowUp' && atLineStart && _history.length){
    e.preventDefault();
    if(_histIdx===-1){ _histSaved=prompt.value; _histIdx=0; }
    else if(_histIdx<_history.length-1) _histIdx++;
    prompt.value=_history[_histIdx];
    prompt.style.height=''; prompt.style.height=Math.min(prompt.scrollHeight,160)+'px';
    btnSend.disabled=!prompt.value.trim();
    return;
  }
  if(e.key==='ArrowDown' && _histIdx>=0){
    e.preventDefault();
    if(_histIdx===0){ _histIdx=-1; prompt.value=_histSaved; }
    else _histIdx--;
    if(_histIdx>=0) prompt.value=_history[_histIdx];
    prompt.style.height=''; prompt.style.height=Math.min(prompt.scrollHeight,160)+'px';
    btnSend.disabled=!prompt.value.trim();
    return;
  }

  // Cmd/Ctrl+K — new chat
  if((e.metaKey||e.ctrlKey) && e.key==='k'){ e.preventDefault(); newChat(); }
});

function fillPrompt(text) {
  if (sessionLocked) return;
  prompt.value = text;
  prompt.dispatchEvent(new Event('input'));
  prompt.focus();
}

prompt.addEventListener('input',()=>{
  _histIdx=-1; // any manual edit exits history mode
  prompt.style.height=''; prompt.style.height=Math.min(prompt.scrollHeight,160)+'px';
  btnSend.disabled=!prompt.value.trim();
  const len = prompt.value.length;
  if (inpChar) inpChar.textContent = len > 60 ? len + ' chars' : '';
  if (inpHint) inpHint.style.display = len > 60 ? 'none' : '';
});
btnSend.disabled=true;

/* ── global keyboard shortcuts ── */
document.addEventListener('keydown',e=>{
  // Cmd/Ctrl+K — new chat (when prompt not focused)
  if((e.metaKey||e.ctrlKey)&&e.key==='k'&&document.activeElement!==prompt){
    e.preventDefault(); newChat();
  }
  // Cmd/Ctrl+Shift+I — debug snapshot (Inspect/Info shortcut)
  if((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.key==='i'){
    e.preventDefault(); debugSnapshot();
  }
});

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
        blDetail.textContent = 'Starting the browser and automation server';
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
          const provLabel = st.provider.name || pid;
          if (!pcards[pid]) buildCards([{ id: pid, label: provLabel }]);
          setCardPending(pid, st.provider.detected);
          const titleEl = scrConfirm.querySelector('.sh-title');
          if (titleEl) titleEl.textContent = 'Log in to ' + provLabel;
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
      _dlog('phase_change: '+ph);
      const L={
        EXECUTION:'Executing',PLANNING:'Planning',
        ORCHESTRATING:'Orchestrating',RESEARCHING:'Researching',
        SCOPING:'Scoping',VERIFYING:'Verifying',
        REVIEWING:'Reviewing',DEBUGGING:'Debugging',WRITING:'Writing',
      };
      const label=(L[ph]||msg.label||ph)+'…';
      phaseLbl.textContent=label;
      startPhaseTimer(label);
      // Apply phase color to the phase bar and progress bar via CSS custom property
      const phColor = PHASE_COLORS[ph] || 'var(--acc)';
      phaseBar.style.setProperty('--phase-color', phColor);
      progressFill.style.setProperty('--phase-color', phColor);
      // Update typing dots and label to match phase
      typingEl?.style.setProperty('--phase-color', phColor);
      if (typingLblEl) typingLblEl.textContent = L[ph] || ph;
      const pct=PHASE_PROGRESS[ph]; if(pct) setProgress(pct);
      const si=phaseToStep(ph); if(si>=0) { setStep(si,ph==='DEBUGGING'); enterStep(si); }
      addPhaseDivider(ph);
      break;
    }

    case 'tool_call_start':
      if(msg.tool){
        _dlog('tool_start: '+msg.tool+' '+(msg.paramsSummary||'').slice(0,40));
        const ts_=toolStyle(msg.tool);
        if(ts_.label==='read'){
          if(msg.paramsSummary) _readsThisSession.add(msg.paramsSummary.split('\n')[0].trim());
          readBuf.push({n:msg.tool,s:msg.paramsSummary||''});
          toolChip.style.display='flex'; toolChip.textContent='↳ '+(msg.paramsSummary||msg.tool).slice(0,36);
        } else if(ts_.label==='write'){
          if(msg.paramsSummary){
            const p=msg.paramsSummary.split('\n')[0].trim();
            if(!_writesThisSession.find(f=>f.path===p))
              _writesThisSession.push({path:p, isNew:!_readsThisSession.has(p)});
          }
          hideTyping(); addToolCard(msg.tool,msg.paramsSummary);
          toolChip.style.display='flex'; toolChip.textContent='↳ '+(msg.paramsSummary||msg.tool).slice(0,36);
        } else if(ts_.label==='run'){
          _runsThisSession++;
          _lastRunSummary = msg.paramsSummary || null;
          hideTyping(); addToolCard(msg.tool,msg.paramsSummary);
          toolChip.style.display='flex'; toolChip.textContent='↳ '+(msg.paramsSummary||msg.tool).slice(0,36);
        } else {
          hideTyping(); addToolCard(msg.tool,msg.paramsSummary);
          toolChip.style.display='flex'; toolChip.textContent='↳ '+(msg.paramsSummary||msg.tool).slice(0,36);
        }
        updatePhaseStats();
      }
      break;

    case 'tool_call_end': {
      const isRead=toolStyle(msg.tool||'').label==='read';
      const isWrite=toolStyle(msg.tool||'').label==='write';
      const isRun=toolStyle(msg.tool||'').label==='run';
      // Increment tool counter for running session
      { const s=sessions.find(x=>x.id===runningSid); if(s) s.tools=(s.tools||0)+1; }
      if(isRead){
        toolChip.style.display='none';
      } else {
        flushReads(); resolveCard(!!msg.isError); toolChip.style.display='none';
        // Write tools: suppress typing — the file_diff card follows immediately
        if(!isWrite || msg.isError) showTyping();
        if(msg.isError){
          const errDetail = msg.errorSummary || msg.error || msg.tool;
          addSysMsg('Tool error: '+errDetail,true);
        }
      }
      break;
    }

    case 'file_diff': {
      const diffEl = addFileDiff(msg);
      addActivityChip(msg, diffEl);
      updateSessionDelta(msg.added || 0, msg.removed || 0);
      showTyping();
      break;
    }

    case 'message_chunk': {
      const chunk = msg.text || msg.chunk || '';
      if (!chunk) break;
      _streamingBuf += chunk;
      if (!_streamingEl) {
        // First chunk — create a streaming element and hide the typing indicator
        _streamingEl = document.createElement('div');
        _streamingEl.className = 'msg-a streaming';
        _streamingEl.innerHTML =
          '<div class="msg-sender agent">Dev Agent</div>'
          + '<div class="mab-md"></div>';
        hideTyping();
        ibt(_streamingEl);
      }
      const mdEl = _streamingEl.querySelector('.mab-md');
      if (mdEl) { mdEl.innerHTML = renderMarkdown(_streamingBuf); scrollMsgs(); }
      break;
    }

    case 'message_complete': {
      hideTyping();
      _dlog('message_complete phase='+currentPhase+' len='+(msg.text||msg.content||'').length);

      if (SILENT.has(currentPhase)) {
        // Discard any streaming content for silent phases
        if (_streamingEl) { _streamingEl.remove(); _streamingEl = null; _streamingBuf = ''; }
        break;
      }

      const raw = msg.text || msg.content || '';
      // EMPTY_RESPONSE is a pipeline sentinel injected when the AI returns nothing
      // (context overflow). Show it as a warning chip, never as an AI message.
      if (raw.includes('[EMPTY_RESPONSE]')) {
        if (_streamingEl) { _streamingEl.remove(); _streamingEl = null; _streamingBuf = ''; }
        addSysMsg('⚠ AI returned empty response — resetting session', false, true);
        break;
      }

      if (_streamingEl) {
        // Finalize the streaming element: remove cursor, add copy button
        const finalText = _streamingBuf || extractAgentText(raw);
        _streamingEl.classList.remove('streaming');
        _streamingEl.innerHTML =
          '<div class="msg-sender agent">Dev Agent</div>'
          + '<div class="mab-md">' + renderMarkdown(finalText) + '</div>'
          + '<button class="msg-copy" onclick="copyMsg(this)" title="Copy response">⎘</button>';
        const body = _streamingEl.querySelector('.mab-md');
        if (body && body.scrollHeight > 320) {
          _streamingEl.classList.add('collapsible');
          _addExpandToggle(_streamingEl, body);
        }
        _streamingEl = null; _streamingBuf = '';
        scrollMsgs();
        break;
      }

      // No streaming: normal path
      const cleaned = extractAgentText(raw);
      if (!cleaned.trim()) break;
      if (currentPhase === 'PLANNING') addSpecialCard('plan', cleaned);
      else if (currentPhase === 'REVIEWING') addSpecialCard('review', cleaned);
      else addAgentMsg(cleaned);
      break;
    }

    case 'task_started':
      _activeTaskId = msg.taskId || null;
      break;

    case 'session_replay':
      // Replay buffered session messages — fires when panel is reopened during/after a session
      if (Array.isArray(msg.messages) && msg.messages.length > 0) {
        // Ensure we're on the chat screen before replaying
        if (scrChat.classList.contains('hidden')) show(scrChat);
        for (const m of msg.messages) {
          window.dispatchEvent(new MessageEvent('message', { data: m }));
        }
      }
      break;

    case 'system_message': {
      const isErr = msg.level==='error';
      const isWarn = msg.level==='warning' || msg.level==='warn';
      // ✓-prefixed info messages get green styling (verifier success, subtask pass, etc.)
      const isOk = !isErr && !isWarn && msg.level==='info'
        && (msg.text||'').trimStart().startsWith('✓');
      _dlog('sys_msg ['+msg.level+'] '+(msg.text||'').slice(0,60));
      hideTyping(); addSysMsg(msg.text, isErr, isWarn, isOk);
      if(isErr) _hadError=true;
      else if(!sessionLocked){ btnSend.classList.remove('hidden'); btnStop.classList.add('hidden'); }
      break;
    }

    case 'debug_snapshot_request':
      debugSnapshot();
      break;

    case 'session_end':
    case 'task_complete': {
      // Drop stale events from a previous session that was aborted/replaced
      if(msg._taskId && _activeTaskId && msg._taskId !== _activeTaskId) break;
      _dlog('session_end type='+msg.type+' stopped='+_stoppedByUser+' err='+_hadError);
      flushReads(); hideTyping(); toolChip.style.display='none';
      // Clear streaming state and UI chrome
      if (_streamingEl) { _streamingEl.remove(); _streamingEl = null; _streamingBuf = ''; }
      taskPin?.classList.remove('show');
      if (phaseSubtask) phaseSubtask.classList.remove('show');
      if (typingLblEl) typingLblEl.textContent = '';
      stopPhaseTimer();

      if(_stoppedByUser){
        // Stop banner already shown in btnStop handler — just confirm cleanup
        _stoppedByUser=false;
        btnStop.classList.add('hidden'); btnStop.disabled=false;
        btnSend.classList.remove('hidden');
        // Phase bar may still be visible if session_end fires before the 300ms timeout
        setTimeout(()=>{ phaseBar.classList.add('hidden'); currentStepIdx=-1; resetProgress(); },50);
        break;
      }

      if(_hadError){
        // Error message already shown — don't overlay a false "done"
        _hadError=false;
        finishSession('error');
        btnStop.classList.add('hidden'); btnStop.disabled=false;
        btnSend.classList.remove('hidden');
        phaseBar.classList.add('hidden'); currentStepIdx=-1; resetProgress();
        break;
      }

      // Natural completion
      setProgress(100,'var(--ok)');
      setTimeout(()=>{ document.getElementById('progress-bar').style.opacity='0'; },1200);
      setStep(4);
      // Finalize phase timeline: close any open steps, mark Done
      for(let i=0;i<4;i++){ if(_stepTimes[i]&&_stepTimes[i].end===null) _stepTimes[i].end=Date.now(); }
      if(!_stepTimes[4]) _stepTimes[4]={start:Date.now(),end:Date.now()};
      renderPhasePills();
      addDoneBanner(); addChangesSummary(); finishSession('done');
      btnSend.classList.remove('hidden'); btnStop.classList.add('hidden'); btnStop.disabled=false;
      setTimeout(()=>{
        phaseBar.classList.add('hidden'); currentStepIdx=-1;
        ctxMeter?.classList.remove('show');
        document.getElementById('progress-bar').style.opacity='';
        resetProgress();
        resetAiSessionBar();
      },1400);
      break;
    }

    case 'subtask_kickoff': {
      const idx = (msg.index || 0) + 1;
      const total = msg.total || '?';
      const label = msg.label || '';
      _dlog('subtask_kickoff: ' + idx + '/' + total + ' "' + label.slice(0, 30) + '"');
      if (typeof total === 'number' && total > _subtasksTotal) _subtasksTotal = total;
      if (phaseSubtask) {
        phaseSubtask.textContent = idx + ' / ' + total;
        phaseSubtask.title = label;
        phaseSubtask.classList.add('show');
      }
      // Update typing label to show what's being worked on
      if (typingLblEl) typingLblEl.textContent = label.length > 45 ? label.slice(0, 45) + '…' : label;
      break;
    }

    case 'subtask_status': {
      const isPassed = msg.feedback === 'PASS';
      const idx = (msg.index || 0) + 1;
      const total = msg.total || '?';
      const retries = msg.retries || 0;
      const label = msg.label || '';
      const score = msg.score != null ? Math.round(msg.score * 100) : null;
      _dlog('subtask_status: ' + msg.feedback + ' [' + idx + '/' + total + '] retries=' + retries + (score!=null?' score='+score+'%':''));
      if (typeof total === 'number' && total > _subtasksTotal) _subtasksTotal = total;
      if (isPassed) {
        _subtasksCompleted++;
        // Brief brightness pulse on the counter to signal completion
        if (phaseSubtask) {
          phaseSubtask.style.filter = 'brightness(1.5)';
          setTimeout(() => { if (phaseSubtask) phaseSubtask.style.filter = ''; }, 700);
        }
      } else if (retries > 0) {
        // Show an inline retry notice so the user knows the agent is trying again
        const shortLabel = label.length > 42 ? label.slice(0, 42) + '…' : label;
        const notice = document.createElement('div');
        notice.className = 'retry-notice';
        notice.innerHTML = '<span class="rn-icon">↺</span>'
          + 'Retry ' + retries
          + (shortLabel ? ' <span class="rn-label" title="'+esc(label)+'">· '+esc(shortLabel)+'</span>' : '')
          + (score != null ? '<span class="rn-score">'+score+'%</span>' : '');
        ibt(notice);
      }
      break;
    }

    case 'progress_update': {
      const { completed = 0, total = 1 } = msg;
      _dlog('progress_update: ' + completed + '/' + total);
      // Drive progress bar: scale 15→90% range across subtask completion
      if (total > 0) setProgress(Math.min(90, Math.round((completed / total) * 80) + 12));
      break;
    }

    case 'browser_context_update':
      updateCtxMeter(msg.messageCount, msg.threshold, msg.segmentIndex);
      break;

    case 'session_handoff':
      addHandoffCard(msg);
      break;

    case 'copilot365_segment_boundary':
      // Only show banner if session_handoff wasn't already shown for this rotation
      if (!msg._suppressBanner) addHandoffCard(msg);
      break;

    case 'session_role_update':
      _dlog('sess_role: '+msg.role+' '+msg.status+' '+msg.provider+(msg.task?' "'+msg.task.slice(0,30)+'"':''));
      updateAiSessionBar(msg.role, msg.status, msg.provider, msg.task);
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
