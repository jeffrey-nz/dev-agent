/**
 * index.js — Webview entry point
 *
 * This is the single file compiled by esbuild into dist/panel-webview.js.
 * It wires all webview modules together, registers DOM event listeners,
 * and exposes the global functions required by HTML onclick attributes.
 *
 * Boot sequence:
 *   1. Acquire vscode API and store on window._vscode.
 *   2. Import all modules (side-effects initialise phase steps DOM etc.)
 *   3. Register button listeners (Send, Stop, NewChat, dropdowns, …)
 *   4. Set window._closeDropdowns / _ibt / _snapshotState helpers.
 *   5. Determine start screen from _INIT and navigate there.
 *   6. Call registerMessageHandler() so incoming extension events are handled.
 *   7. Notify extension that the panel is ready.
 *
 * Global window functions exposed here (called from HTML onclick attrs):
 *   copyMsg(btn)       — copy an agent message
 *   copyCode(btn)      — copy a code block
 *   fillPrompt(text)   — fill the prompt textarea without sending
 *   openFile(path)     — ask extension to open a file in the editor
 *   retryPrompt(btn)   — re-send the prompt from a "Run again" button
 */

/* global acquireVsCodeApi */

// ── VS Code API ────────────────────────────────────────────────────────────
// acquireVsCodeApi() is a webview-only global injected by VS Code.
// It must be called exactly once per webview lifetime.
const vscode = acquireVsCodeApi();
window._vscode = vscode;

// ── SCSS colour map (used by connection.js / events.js) ────────────────────
window._PROV_COLORS = {
  chatgpt:    '#10a37f',
  gemini:     '#4285f4',
  deepseek:   '#4f8ef7',
  grok:       '#9b59b6',
  copilot:    '#0078d4',
  copilot365: '#0078d4',
};

// ── Module imports ─────────────────────────────────────────────────────────
// State must be imported first — other modules read state at module-eval time.
import {
  _INIT, sessions, _history, _pendingImages, _userScrolled,
  activeSid, runningSid, sessionLocked,
  _writesThisSession, _readsThisSession, _runsThisSession,
  _subtasksTotal, _subtasksCompleted,
  _selectedProvider, _availableProviders, _inSetupMode, _bridgePort,
  currentPhase, currentStepIdx, lastPhase, _stepTimes,
  _streamingEl, _streamingBuf,
  _histIdx, _histSaved, _debugLog,
  setRunningSid, setSessionLocked,
  setStoppedByUser,
  setSelectedProvider, setAvailableProviders, setInSetupMode, setBridgePort,
  setCurrentPhase, setCurrentStepIdx, setLastPhase,
  setStreamingEl, setStreamingBuf,
  setPendingImages, setUserScrolled,
  setHistIdx, setHistSaved,
} from './state.js';

import { renderMarkdown } from './markdown.js';
import { addFileDiff }    from './diffs.js';

import {
  createSession, finishSession, newChat,
  renderSessions, saveSession,
} from './sessions.js';

import {
  STEPS, PHASE_COLORS, PHASE_PROGRESS, PM,
  setStep, setProgress, resetProgress,
  startPhaseTimer, stopPhaseTimer,
  enterStep, renderPhasePills, addPhaseDivider, resetDividers,
  phaseToStep,
} from './phases.js';

import {
  toolStyle, addToolCard, resolveCard, flushReads,
} from './tools.js';

import {
  addActivityChip, updateSessionDelta, resetSessionTracking,
  addChangesSummary,
} from './activity.js';
import { setSubtasksTotal } from './state.js';

import {
  ibt, showTyping, hideTyping,
  addUserMsg, addAttachmentMsg, addAgentMsg, addSysMsg,
  addSpecialCard, addDoneBanner, addStopBanner, addHandoffCard,
  updateCtxMeter, clearNotes, resetUnread,
} from './messages.js';

import {
  cncShow, cncStartPoll, cncStopPoll,
  buildCards, buildProviderCards,
  startBridgeTicker, stopBridgeTicker,
  _onBridgeReady,
} from './connection.js';

import { clipboardWrite, copyMsg, copyCode, exportSession, debugSnapshot } from './export.js';
import { showToast } from './toast.js';

import { registerMessageHandler } from './events.js';

// ── Element refs ───────────────────────────────────────────────────────────
const scrConnect  = document.getElementById('scr-connect');
const scrConfirm  = document.getElementById('scr-confirm');
const scrProvider = document.getElementById('scr-provider');
const scrProject  = document.getElementById('scr-project');
const scrChat     = document.getElementById('scr-chat');

const messages      = document.getElementById('messages');
const typingEl      = document.getElementById('typing');
const welcomeEl     = document.getElementById('welcome');
const phaseBar      = document.getElementById('phase-bar');
const phaseLbl      = document.getElementById('phase-lbl');
const phasePillsEl  = document.getElementById('phase-pills');
const phaseSubtask  = document.getElementById('phase-subtask');
const taskPin       = document.getElementById('task-pin');
const taskPinText   = document.getElementById('task-pin-text');
const taskPinClose  = document.getElementById('task-pin-close');
const toolChip      = document.getElementById('tool-chip');
const progressFill  = document.getElementById('progress-fill');
const ctxMeterEl    = document.getElementById('ctx-meter');
const aiSessionsBar = document.getElementById('ai-sessions-bar');
const activityStrip = document.getElementById('activity-strip');
const sessionDeltaEl = document.getElementById('session-delta');

const sessionList    = document.getElementById('session-list');
const sessionsDrop   = document.getElementById('sessions-drop');
const settingsDrop   = document.getElementById('settings-drop');
const hdrProj        = document.getElementById('hdr-proj');
const btnSessions    = document.getElementById('btn-sessions');
const btnSettingsBtn = document.getElementById('btn-settings');
const btnNewChat     = document.getElementById('btn-new-chat');
const btnNotes       = document.getElementById('btn-notes');
const notesDrawer    = document.getElementById('notes-drawer');
const notesList      = document.getElementById('notes-list');
const notesEmpty     = document.getElementById('notes-empty');
const notesBadge     = document.getElementById('notes-badge');

const prompt        = document.getElementById('prompt');
const btnSend       = document.getElementById('btn-send');
const btnStop       = document.getElementById('btn-stop');
const btnAttach     = document.getElementById('btn-attach');
const attachPreview = document.getElementById('attach-preview');

const btnProv  = document.getElementById('btn-prov');
const provName = document.getElementById('prov-name');
const provDrop = document.getElementById('prov-drop');

const scrollBtn    = document.getElementById('scroll-btn');
const typingLblEl  = document.querySelector('#typing .t-lbl');
const chatMain     = document.getElementById('chat-main');
const compactDot   = document.getElementById('compact-dot');
const inpChar      = document.getElementById('inp-char');
const inpHint      = document.getElementById('inp-hint');

// ── Expose state refs on window ────────────────────────────────────────────
// events.js and other modules access these via window._ to avoid circular deps.

window._sessions       = sessions;
window._runningSid     = runningSid;
window._sessionLocked  = sessionLocked;
window._lastPhase      = lastPhase;

// Live binding bridges: events.js mutates these via window._ because ES module
// re-exports are not assignable from other modules.
Object.defineProperties(window, {
  _runningSid:    { get: () => runningSid,    set: v => setRunningSid(v),    configurable: true },
  _sessionLocked: { get: () => sessionLocked, set: v => setSessionLocked(v), configurable: true },
  _lastPhase:     { get: () => lastPhase,     set: v => setLastPhase(v),     configurable: true },
  _currentStepIdx: { get: () => currentStepIdx, set: v => setCurrentStepIdx(v), configurable: true },
  _writesThisSession: { get: () => _writesThisSession, configurable: true },
  _readsThisSession:  { get: () => _readsThisSession,  configurable: true },
  _runsThisSession:   { get: () => _runsThisSession,   configurable: true },
  _subtasksTotal:     { get: () => _subtasksTotal,     set: v => setSubtasksTotal(v), configurable: true },
  _userScrolled:      { get: () => _userScrolled,      set: v => setUserScrolled(v), configurable: true },
  _sessions:          { get: () => sessions,            configurable: true },
  _selectedProvider:  { get: () => _selectedProvider,  configurable: true },
  _availableProviders: { get: () => _availableProviders, configurable: true },
  _inSetupMode:       { get: () => _inSetupMode,        configurable: true },
  _bridgePort:        { get: () => _bridgePort,         configurable: true },
  _history:           { get: () => _history,            configurable: true },
  _pendingImages:     { get: () => _pendingImages,      configurable: true },
  _subtasksCompleted: { get: () => _subtasksCompleted,  configurable: true },
  _streamingEl:       { get: () => _streamingEl,        configurable: true },
  _streamingBuf:      { get: () => _streamingBuf,       configurable: true },
  _stepTimes: { get: () => _stepTimes, configurable: true },
});

// Expose a setter for currentStepIdx used by events.js session_end handler
window._setCurrentStepIdx = (v) => setCurrentStepIdx(v);

// ── ibt bridge (insert-before-typing) ─────────────────────────────────────
// messages.js sets this but we re-declare to ensure the module is initialised first.
window._ibt = function _ibt(el) {
  if (el) messages.insertBefore(el, typingEl);
  if (!_userScrolled) messages.scrollTop = messages.scrollHeight;
};

// ── stateRefs snapshot (used by export.js debugSnapshot) ──────────────────
window._snapshotState = function () {
  return {
    sessionLocked,
    runningSid,
    activeSid,
    sessionCount: sessions.length,
    currentPhase,
    currentStepIdx,
    selectedProvider: _selectedProvider,
    availableProviders: _availableProviders.map(p => p.id),
    aiSessionsBarVisible: aiSessionsBar ? !aiSessionsBar.classList.contains('hidden') : false,
    phaseBarVisible: phaseBar ? !phaseBar.classList.contains('hidden') : false,
  };
};

// ── Dropdown helpers ───────────────────────────────────────────────────────

/**
 * Close all open dropdown menus and remove their active states.
 */
function closeDropdowns() {
  sessionsDrop?.classList.add('hidden');
  btnSessions?.classList.remove('active');
  settingsDrop?.classList.add('hidden');
  btnSettingsBtn?.classList.remove('active');
  provDrop?.classList.add('hidden');
  btnProv?.classList.remove('open');
  // Clear session search on close
  const ssInput = document.querySelector('.ss-search');
  if (ssInput) ssInput.value = '';
}

// Expose for use across modules
window._closeDropdowns = closeDropdowns;

// ── Scroll helpers ─────────────────────────────────────────────────────────

function scrollMsgs() {
  if (!_userScrolled) messages.scrollTop = messages.scrollHeight;
}

// Scroll-button label: shows unread count when the user is scrolled up
window._onUnreadIncrement = (count) => {
  if (scrollBtn) scrollBtn.textContent = count > 0 ? count + ' new ↓' : '↓';
};

messages.addEventListener('scroll', () => {
  const threshold = 80;
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < threshold;
  setUserScrolled(!atBottom);
  scrollBtn?.classList.toggle('show', !atBottom);
  if (atBottom) resetUnread();
});

scrollBtn?.addEventListener('click', () => {
  setUserScrolled(false);
  resetUnread();
  scrollBtn.classList.remove('show');
  messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
});

// ── Dropdown button wiring ─────────────────────────────────────────────────

btnSessions?.addEventListener('click', e => {
  e.stopPropagation();
  const open = !sessionsDrop.classList.contains('hidden');
  closeDropdowns();
  if (!open) {
    sessionsDrop.classList.remove('hidden');
    btnSessions.classList.add('active');
    // Focus search input if sessions exist
    setTimeout(() => {
      const si = document.querySelector('.ss-search');
      if (si && sessions.length > 2) si.focus();
    }, 50);
  }
});

btnSettingsBtn?.addEventListener('click', e => {
  e.stopPropagation();
  const open = !settingsDrop.classList.contains('hidden');
  closeDropdowns();
  if (!open) { settingsDrop.classList.remove('hidden'); btnSettingsBtn.classList.add('active'); }
});

document.addEventListener('click', closeDropdowns);
sessionsDrop?.addEventListener('click', e => e.stopPropagation());
settingsDrop?.addEventListener('click', e => e.stopPropagation());

// ── Notes drawer ───────────────────────────────────────────────────────────

btnNotes?.addEventListener('click', e => {
  e.stopPropagation();
  closeDropdowns();
  const open = notesDrawer.classList.toggle('open');
  btnNotes.classList.toggle('active', open);
});

document.getElementById('notes-close')?.addEventListener('click', () => {
  notesDrawer?.classList.remove('open');
  btnNotes?.classList.remove('active');
});

document.getElementById('notes-copy')?.addEventListener('click', () => {
  const chips = document.querySelectorAll('.note-chip');
  const parts = Array.from(chips).map(c => {
    const type = c.classList.contains('plan') ? 'Plan' : 'Review';
    const body = c.querySelector('.note-chip-body')?.innerText?.trim() || '';
    return '## ' + type + '\n\n' + body;
  });
  if (!parts.length) return;
  navigator.clipboard.writeText(parts.join('\n\n---\n\n'))
    .then(() => showToast('Notes copied', 'ok', 1800))
    .catch(() => {});
});

notesDrawer?.addEventListener('click', e => e.stopPropagation());

// ── Provider chip / dropdown ───────────────────────────────────────────────

function _applyProviderChip(id) {
  const COLORS = window._PROV_COLORS || {};
  if (!btnProv) return;
  const color = COLORS[id] || 'var(--ce)';
  const label = _availableProviders.find(p => p.id === id)?.name || id;
  btnProv.style.setProperty('--prov-color', color);
  btnProv.classList.toggle('connected', !!id);
  if (provName) provName.textContent = id ? label : 'No provider';
  if (provDrop) {
    provDrop.querySelectorAll('.pi-item').forEach(el =>
      el.classList.toggle('active', el.dataset.id === id)
    );
  }
}

// Expose for connection.js and events.js
window._applyProviderChip = _applyProviderChip;

function _buildProvDrop(id) {
  if (!provDrop) return;
  provDrop.innerHTML = '';
  if (!id) return;
  const COLORS = window._PROV_COLORS || {};
  const color = COLORS[id] || '#888';
  const label = _availableProviders.find(p => p.id === id)?.name || id;
  const hdr = document.createElement('div');
  hdr.className = 'pi-hdr';
  hdr.textContent = 'Active provider';
  provDrop.appendChild(hdr);
  const item = document.createElement('div');
  item.className = 'pi-item active';
  item.innerHTML = `<span class="pi-dot" style="background:${color}"></span>${label}<span class="pi-check">✓</span>`;
  provDrop.appendChild(item);
}

btnProv?.addEventListener('click', e => {
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

provDrop?.addEventListener('click', e => e.stopPropagation());

// ── compact mode ───────────────────────────────────────────────────────────

let _compact = localStorage.getItem('da-compact') === '1';

function applyCompact() {
  chatMain?.classList.toggle('compact', _compact);
  compactDot?.classList.toggle('on', _compact);
}
applyCompact();

document.getElementById('btn-compact')?.addEventListener('click', e => {
  e.stopPropagation();
  _compact = !_compact;
  localStorage.setItem('da-compact', _compact ? '1' : '0');
  applyCompact();
});

// ── Image attachments ──────────────────────────────────────────────────────

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
      const imgs = [..._pendingImages];
      imgs.splice(idx, 1);
      setPendingImages(imgs);
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
    const raw = e.target.result;
    setPendingImages([..._pendingImages, { data: raw, mimeType: file.type, name: file.name }]);
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

// Paste images from clipboard
prompt?.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) addImageFromFile(file);
    }
  }
});

// ── AI session bar helpers ─────────────────────────────────────────────────

function resetAiSessionBar() {
  if (!aiSessionsBar) return;
  aiSessionsBar.classList.remove('show');
  const aiSessPrimary   = document.getElementById('ai-sess-primary');
  const aiSessAuxiliary = document.getElementById('ai-sess-auxiliary');
  [aiSessPrimary, aiSessAuxiliary].forEach(el => {
    if (!el) return;
    el.classList.remove('active');
    const nameEl = el.querySelector('.ai-sess-name');
    const taskEl = el.querySelector('.ai-sess-task');
    if (nameEl) nameEl.textContent = '—';
    if (taskEl) taskEl.textContent = '';
  });
}

// ── Send / Stop ────────────────────────────────────────────────────────────

/**
 * Push a prompt string to the top of the input history ring buffer.
 * @param {string} text
 */
function histPush(text) {
  if (_history[0] !== text) _history.unshift(text);
  if (_history.length > 50) _history.pop();
  setHistIdx(-1);
}

btnSend?.addEventListener('click', () => {
  const text = prompt.value.trim();
  if (!text && !_pendingImages.length) return;
  histPush(text);
  setHistIdx(-1);

  // Clear any leftover streaming state
  if (_streamingEl) { _streamingEl.remove(); setStreamingEl(null); setStreamingBuf(''); }

  createSession(text);
  addUserMsg(text);
  showTyping();
  if (_pendingImages.length) addAttachmentMsg(_pendingImages.length);

  phaseBar?.classList.remove('hidden');
  if (phaseLbl) phaseLbl.textContent = 'Starting…';
  phaseBar?.style.removeProperty('--phase-color');
  progressFill?.style.removeProperty('--phase-color');

  if (taskPinText) taskPinText.textContent = text.length > 90 ? text.slice(0, 90) + '…' : text;
  taskPin?.classList.add('show');

  if (phaseSubtask) { phaseSubtask.textContent = ''; phaseSubtask.classList.remove('show'); }
  if (typingLblEl) typingLblEl.textContent = '';

  setCurrentStepIdx(-1); setLastPhase(''); setCurrentPhase('');
  // readBuf and pendingCard cleared via state reset in resetSessionTracking (called by createSession)
  resetDividers();
  stopPhaseTimer();
  resetAiSessionBar();

  const images = _pendingImages.map(i => ({ data: i.data, mimeType: i.mimeType }));
  vscode.postMessage({
    type: 'start_task',
    prompt: text,
    provider: _selectedProvider || undefined,
    ...(images.length ? { images } : {}),
  });

  prompt.value = '';
  prompt.style.height = '';
  btnSend.disabled = true;
  setPendingImages([]);
  renderAttachPreviews();
  btnSend.classList.add('hidden');
  btnStop?.classList.remove('hidden');
});

btnStop?.addEventListener('click', () => {
  if (btnStop.disabled) return;
  btnStop.disabled = true;
  setStoppedByUser(true);

  if (phaseLbl) phaseLbl.textContent = 'Stopping…';
  const elapsed = phaseLbl?.querySelector('.phase-elapsed');
  if (elapsed) elapsed.remove();
  if (toolChip) toolChip.style.display = 'none';

  vscode.postMessage({ type: 'stop' });

  setTimeout(() => {
    flushReads();
    hideTyping();
    stopPhaseTimer();
    addStopBanner();
    finishSession('stopped');
    btnStop?.classList.add('hidden');
    if (btnStop) btnStop.disabled = false;
    btnSend?.classList.remove('hidden');
    setTimeout(() => {
      phaseBar?.classList.add('hidden');
      setCurrentStepIdx(-1);
      resetProgress();
    }, 300);
  }, 300);
});

// ── Prompt textarea ────────────────────────────────────────────────────────

prompt?.addEventListener('keydown', e => {
  // Enter sends; Shift+Enter inserts newline; ⌘/Ctrl+Enter also sends
  if (e.key === 'Enter' && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
    e.preventDefault(); btnSend?.click(); return;
  }

  // Tab when empty — accept the current rotating placeholder into the input
  if (e.key === 'Tab' && !prompt.value.trim()) {
    e.preventDefault();
    prompt.value = prompt.placeholder;
    prompt.style.height = '';
    prompt.style.height = Math.min(prompt.scrollHeight, 160) + 'px';
    if (btnSend) btnSend.disabled = false;
    return;
  }

  // History navigation (ArrowUp/Down when cursor is at start of first line)
  const atLineStart = prompt.selectionStart === 0;
  if (e.key === 'ArrowUp' && atLineStart && _history.length) {
    e.preventDefault();
    if (_histIdx === -1) { setHistSaved(prompt.value); setHistIdx(0); }
    else if (_histIdx < _history.length - 1) setHistIdx(_histIdx + 1);
    prompt.value = _history[_histIdx];
    prompt.style.height = '';
    prompt.style.height = Math.min(prompt.scrollHeight, 160) + 'px';
    if (btnSend) btnSend.disabled = !prompt.value.trim();
    return;
  }
  if (e.key === 'ArrowDown' && _histIdx >= 0) {
    e.preventDefault();
    if (_histIdx === 0) { setHistIdx(-1); prompt.value = _histSaved; }
    else setHistIdx(_histIdx - 1);
    if (_histIdx >= 0) prompt.value = _history[_histIdx];
    prompt.style.height = '';
    prompt.style.height = Math.min(prompt.scrollHeight, 160) + 'px';
    if (btnSend) btnSend.disabled = !prompt.value.trim();
    return;
  }

  // Cmd/Ctrl+K — new chat
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); newChat(); }
});

prompt?.addEventListener('input', () => {
  setHistIdx(-1);
  prompt.style.height = '';
  prompt.style.height = Math.min(prompt.scrollHeight, 160) + 'px';
  if (btnSend) btnSend.disabled = !prompt.value.trim();
  const len = prompt.value.length;
  if (inpChar) inpChar.textContent = len > 60 ? len + ' chars' : '';
  if (inpHint) inpHint.style.display = len > 60 ? 'none' : '';
});

if (btnSend) btnSend.disabled = true;

// ── Rotating placeholder prompts ───────────────────────────────────────────
// Cycles through example prompts in the textarea when the user isn't typing.

const _PLACEHOLDERS = [
  'Ask Dev Agent to build something…',
  'Add comprehensive tests for the auth module…',
  'Refactor the API client to use async/await…',
  'Fix the race condition in the job queue…',
  'Explain how the caching layer works…',
  'Add TypeScript types to all exported functions…',
  'Review and optimise the database queries…',
  'Set up Docker and a CI pipeline…',
];
let _phIdx = 0;
if (prompt) {
  prompt.placeholder = _PLACEHOLDERS[0];
  setInterval(() => {
    if (document.activeElement === prompt || prompt.value.length > 0) return;
    _phIdx = (_phIdx + 1) % _PLACEHOLDERS.length;
    // Fade transition via opacity on the textarea
    prompt.style.transition = 'none';
    setTimeout(() => {
      prompt.placeholder = _PLACEHOLDERS[_phIdx];
    }, 0);
  }, 5000);
}

// ── Global keyboard shortcuts ──────────────────────────────────────────────

document.addEventListener('keydown', e => {
  // Escape — close any open dropdowns or notes drawer
  if (e.key === 'Escape') {
    closeDropdowns();
    notesDrawer?.classList.remove('open');
    btnNotes?.classList.remove('active');
    return;
  }
  // Cmd/Ctrl+K — new chat (when prompt not focused)
  if ((e.metaKey || e.ctrlKey) && e.key === 'k' && document.activeElement !== prompt) {
    e.preventDefault(); newChat();
  }
  // Cmd/Ctrl+Shift+I — debug snapshot
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'i') {
    e.preventDefault(); debugSnapshot();
  }
  // Cmd/Ctrl+Shift+C — copy the last agent response to clipboard
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'c') {
    e.preventDefault();
    const msgs = document.querySelectorAll('.msg-a');
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg) {
      const text = lastMsg.querySelector('.mab-md')?.innerText?.trim() || '';
      if (text) {
        navigator.clipboard.writeText(text)
          .then(() => showToast('Last reply copied', 'ok', 1800))
          .catch(() => {});
      }
    }
  }
});

// ── Header bar actions ─────────────────────────────────────────────────────

btnNewChat?.addEventListener('click', newChat);

document.getElementById('btn-sb-proj')?.addEventListener('click', () => {
  closeDropdowns();
  vscode.postMessage({ type: 'change_project' });
});

document.getElementById('btn-sb-prov')?.addEventListener('click', () => {
  closeDropdowns();
  setSelectedProvider(null);
  setInSetupMode(false);
  window._showScreen?.(scrConnect);
  cncShow('connecting');
  cncStartPoll();
  vscode.postMessage({ type: 'reset' });
});

document.getElementById('btn-stop-bridge')?.addEventListener('click', () => {
  closeDropdowns();
  vscode.postMessage({ type: 'stop_bridge' });
});

// ── Connect screen retry button ────────────────────────────────────────────

document.getElementById('btn-cnc-retry')?.addEventListener('click', () => {
  cncShow('connecting');
  cncStartPoll();
});

// ── Project screen ─────────────────────────────────────────────────────────

document.getElementById('btn-browse')?.addEventListener('click', () =>
  vscode.postMessage({ type: 'browse_folder' })
);

document.getElementById('btn-new-folder')?.addEventListener('click', () =>
  vscode.postMessage({ type: 'create_folder' })
);

// ── Task pin close ─────────────────────────────────────────────────────────

taskPinClose?.addEventListener('click', () => taskPin?.classList.remove('show'));

// ── Export button ──────────────────────────────────────────────────────────

document.getElementById('btn-export')?.addEventListener('click', exportSession);

// ── Welcome example prompts ────────────────────────────────────────────────

document.querySelectorAll('.w-ex').forEach(btn => {
  btn.addEventListener('click', () => {
    prompt.value = btn.dataset.prompt;
    prompt.dispatchEvent(new Event('input'));
    prompt.focus();
  });
});

// ── Global functions (called from HTML onclick attributes) ─────────────────

/**
 * Copy the text of an agent message to the clipboard.
 * Called from HTML: onclick="copyMsg(this)"
 * @param {HTMLElement} btn
 */
window.copyMsg = copyMsg;

/**
 * Copy the content of a code block to the clipboard.
 * Called from HTML: onclick="copyCode(this)"
 * @param {HTMLElement} btn
 */
window.copyCode = copyCode;

/**
 * Fill the prompt textarea with text (without sending).
 * Called from HTML banner action buttons.
 * @param {string} text
 */
window.fillPrompt = function fillPrompt(text) {
  if (sessionLocked) return;
  prompt.value = text;
  prompt.dispatchEvent(new Event('input'));
  prompt.focus();
};

/**
 * Open a file in the VS Code editor.
 * Called from HTML: onclick="openFile(this.dataset.fp)"
 * @param {string} path
 */
window.openFile = function openFile(path) {
  vscode.postMessage({ type: 'open_file', path });
};

/**
 * Re-send the prompt stored in a "Run again" button's data-p attribute.
 * Called from HTML: onclick="retryPrompt(this)"
 * @param {HTMLElement} btn
 */
window.retryPrompt = function retryPrompt(btn) {
  const text = btn?.dataset?.p || _history[0] || '';
  if (!text || sessionLocked) return;
  window.fillPrompt(text);
  btnSend?.click();
};

// ── Start screen navigation ────────────────────────────────────────────────
// Based on _INIT, jump to the correct screen without waiting for a message.

if (_INIT && _INIT.bridgeReady) {
  // Bridge is already up — go straight to project / chat.
  if (_INIT.bridgeProviders && _INIT.bridgeProviders.length) {
    const provs = _INIT.bridgeProviders.map(p => ({ id: p.id || p, name: p.label || p.id || p }));
    setAvailableProviders(provs);
    setSelectedProvider(provs[0]?.id || null);
  }
  _onBridgeReady(_INIT);
  vscode.postMessage({ type: 'bridge_connected_direct' });
} else if (_INIT && _INIT.bridgePhase === 'waiting_provider_selection') {
  // Bridge is up but waiting for the user to pick a provider.
  setBridgePort(_INIT.bridgePort || 3333);
  setAvailableProviders(_INIT.availableProviders || []);
  setInSetupMode(true);
  buildProviderCards(_availableProviders);
  window._showScreen?.(scrProvider);
  vscode.postMessage({ type: 'bridge_connected_direct' });
  cncStartPoll(); // keep polling to catch waiting_confirm
} else {
  // Default: show connect screen and start polling.
  cncShow('connecting');
  cncStartPoll();
}

// ── Register event handler ─────────────────────────────────────────────────
registerMessageHandler();

// ── Signal readiness ───────────────────────────────────────────────────────
// The extension replies with the current bridge status, which drives navigation.
vscode.postMessage({ type: 'panel_ready' });
