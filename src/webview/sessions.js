/**
 * sessions.js — Session lifecycle management
 *
 * Handles creating, switching, saving, finishing, and rendering sessions.
 * Sessions are stored as plain objects in the shared `sessions` array.
 *
 * Each session object:
 *   { id, prompt, ts, status, html, notes, tools, files?, elapsed?, subtasks? }
 *
 * Exports:
 *   createSession(promptText) — start a new session, returns its ID
 *   finishSession(status)     — mark the running session done/error/stopped
 *   switchSession(id)         — restore a previous session's messages
 *   saveSession(id)           — snapshot current messages into the session
 *   renderSessions()          — rebuild the session list dropdown
 *   newChat()                 — clear the UI and start fresh
 */

import {
  sessions, activeSid, runningSid, sessionLocked, sidSeq,
  setActiveSid, setRunningSid, setSessionLocked, setSidSeq,
  setSessionStartTs, setStoppedByUser, setHadError,
  _writesThisSession, _sessionStartTs, _subtasksCompleted, _subtasksTotal,
  _selectedProvider,
} from './state.js';
import { clearNotes, addNoteChip } from './messages.js';
import { resetSessionTracking } from './activity.js';
import { stopPhaseTimer, resetProgress } from './phases.js';

// ── Element refs ───────────────────────────────────────────────────────────
const messages    = document.getElementById('messages');
const typingEl    = document.getElementById('typing');
const welcomeEl   = document.getElementById('welcome');
const sessionList = document.getElementById('session-list');
const phaseBar    = document.getElementById('phase-bar');
const phasePillsEl = document.getElementById('phase-pills');
const activityStrip = document.getElementById('activity-strip');
const sessionDeltaEl = document.getElementById('session-delta');
const ctxMeter    = document.getElementById('ctx-meter');
const taskPin     = document.getElementById('task-pin');
const phaseSubtask = document.getElementById('phase-subtask');
const typingLblEl = document.querySelector('#typing .t-lbl');
const btnSend     = document.getElementById('btn-send');
const btnStop     = document.getElementById('btn-stop');
const prompt      = document.getElementById('prompt');
const scrollBtn   = document.getElementById('scroll-btn');

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Format a date as a relative time string (e.g. "3m ago", "just now").
 * @param {Date} d
 * @returns {string}
 */
function relTime(d) {
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 5)     return 'just now';
  if (s < 60)    return s + 's ago';
  if (s < 3600)  return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

/**
 * HTML-escape a string.
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Extract a concise, meaningful title from a prompt by stripping leading
 * filler phrases ("please", "can you build", etc.) and capitalising.
 * @param {string} text
 * @returns {string}
 */
function _sessionTitle(text) {
  const stripped = text
    .trim()
    // Strip leading polite filler and common imperative prefixes
    .replace(
      /^(please\s+|could you\s+|can you\s+|would you\s+|i want you to\s+|i need you to\s+|help me\s+|help me to\s+)/i,
      ''
    )
    // Strip common task-start verbs when followed by content
    .replace(
      /^(make\s+me\s+|create\s+|build\s+|add\s+|write\s+|update\s+|fix\s+|refactor\s+|implement\s+|generate\s+|set up\s+|setup\s+)/i,
      m => m  // keep the verb — it's signal
    )
    .trim();
  // Capitalise first letter, then cap at 72 chars
  return stripped.charAt(0).toUpperCase() + stripped.slice(1, 72);
}

/**
 * Close all open dropdowns (delegated — defined in index.js).
 * We import via window to avoid a circular dependency with connection.js.
 */
function closeDropdowns() { window._closeDropdowns?.(); }

/** Scroll the messages pane to the bottom unless the user has scrolled up. */
function scrollMsgs() {
  if (window._userScrolled) return;
  messages.scrollTop = messages.scrollHeight;
}

// ── Session lifecycle ──────────────────────────────────────────────────────

/**
 * Create a new session, reset the UI, and return the new session ID.
 * Saves the currently active session's HTML before switching.
 *
 * @param {string} promptText - The user's task prompt.
 * @returns {number} The new session's ID.
 */
export function createSession(promptText) {
  if (activeSid !== null) saveSession(activeSid);

  const id = sidSeq + 1;
  setSidSeq(id);

  setSessionStartTs(Date.now());
  setStoppedByUser(false);
  setHadError(false);
  resetSessionTracking();
  clearNotes();

  sessions.unshift({
    id,
    prompt:   _sessionTitle(promptText),
    ts:       new Date(),
    status:   'running',
    html:     '',
    notes:    [],
    tools:    0,
    provider: _selectedProvider || null,
  });

  setActiveSid(id);
  setRunningSid(id);
  setSessionLocked(true);
  clearMsgs();
  hideWelcome();
  renderSessions();
  return id;
}

/**
 * Finalize the running session with a terminal status.
 * Records elapsed time, file/subtask counts, and unlocks the UI.
 *
 * @param {'done'|'error'|'stopped'} status
 */
export function finishSession(status) {
  const s = sessions.find(x => x.id === runningSid);
  if (s) {
    s.status = status;
    if (_sessionStartTs) s.elapsed = Math.round((Date.now() - _sessionStartTs) / 1000);
    s.files = _writesThisSession.length;
    if (_subtasksTotal > 1) s.subtasks = { done: _subtasksCompleted, total: _subtasksTotal };
  }
  saveSession(activeSid);
  setRunningSid(null);
  setSessionLocked(false);
  renderSessions();
}

/**
 * Switch the view to a previous session by restoring its saved HTML.
 * No-op if the session is locked (a task is running) or already active.
 *
 * @param {number} id - Session ID to switch to.
 */
export function switchSession(id) {
  if (sessionLocked || id === activeSid) return;
  saveSession(activeSid);
  setActiveSid(id);
  clearMsgs();
  clearNotes();
  const s = sessions.find(x => x.id === id);
  if (s?.html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = s.html;
    while (tmp.firstChild) messages.insertBefore(tmp.firstChild, typingEl);
    hideWelcome();
  } else {
    showWelcome();
  }
  if (s?.notes?.length) s.notes.forEach(n => addNoteChip(n.type, n.html));
  scrollMsgs();
  renderSessions();
  closeDropdowns();
}

/**
 * Start a fresh chat: clear messages, hide controls, reset all state.
 * No-op if a session is currently locked.
 */
export function newChat() {
  if (sessionLocked) return;
  if (activeSid !== null) saveSession(activeSid);
  setActiveSid(null);
  clearMsgs();
  showWelcome();
  hideTyping();

  // Hide all phase/activity chrome
  phaseBar.classList.add('hidden');
  phasePillsEl?.classList.add('hidden');
  activityStrip?.classList.add('hidden');
  sessionDeltaEl?.classList.add('hidden');
  ctxMeter?.classList.remove('show');
  taskPin?.classList.remove('show');
  if (phaseSubtask) phaseSubtask.classList.remove('show');
  if (typingLblEl) typingLblEl.textContent = '';

  stopPhaseTimer();
  setStoppedByUser(false);
  setHadError(false);
  window._userScrolled = false;
  scrollBtn?.classList.remove('show');

  // Reset phase tracking globals via the shared window bindings set in index.js
  window._resetNewChat?.();

  renderSessions();
  closeDropdowns();
  prompt?.focus();
}

/**
 * Snapshot the current message feed HTML into the session object
 * so it can be restored when the user switches back later.
 *
 * @param {number|null} id - Session ID to save (no-op if null or not found).
 */
export function saveSession(id) {
  const s = sessions.find(x => x.id === id);
  if (!s) return;

  // Collect HTML from all non-chrome children
  const parts = [];
  for (const n of messages.children) {
    if (n === typingEl || n === welcomeEl) continue;
    parts.push(n.outerHTML);
  }
  s.html = parts.join('');

  // Save notes for restoration when the session is revisited
  const notesList = document.getElementById('notes-list');
  s.notes = notesList
    ? Array.from(notesList.querySelectorAll('.note-chip')).map(c => ({
        type: c.classList.contains('plan') ? 'plan' : 'review',
        html: c.querySelector('.note-chip-body')?.innerHTML || '',
      }))
    : [];
}

// ── Session search state ───────────────────────────────────────────────────

let _sessionFilter = '';

// Ensure the search input exists above the session list; inject once.
(function _initSessionSearch() {
  const drop = document.getElementById('sessions-drop');
  if (!drop || drop.querySelector('.ss-search')) return;
  const wrap = document.createElement('div');
  wrap.className = 'ss-search-wrap';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'ss-search';
  inp.placeholder = 'Search sessions…';
  inp.autocomplete = 'off';
  inp.addEventListener('input', () => {
    _sessionFilter = inp.value.trim().toLowerCase();
    renderSessions();
  });
  inp.addEventListener('click', e => e.stopPropagation());
  // Arrow key navigation: move focus from search to session items
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = sessionList.querySelector('.sitem:not(:disabled)');
      first?.focus();
    } else if (e.key === 'Escape') {
      window._closeDropdowns?.();
    }
  });
  wrap.appendChild(inp);
  drop.insertBefore(wrap, drop.firstChild);
})();

/**
 * Rebuild the session list dropdown with the current sessions array.
 * Also updates the session-count badge in the header.
 */
export function renderSessions() {
  const count = sessions.length;
  const badge = document.getElementById('session-count');
  if (badge) badge.textContent = count > 1 ? String(count) : '';

  // Welcome screen: show "Continue last session" when sessions exist but none is active
  const wRecent    = document.getElementById('w-recent');
  const wRecentBtn = document.getElementById('btn-w-recent');
  if (wRecent && wRecentBtn) {
    const last = activeSid === null && sessions[0];
    if (last) {
      wRecentBtn.textContent = last.prompt;
      wRecentBtn.onclick = () => switchSession(last.id);
      wRecent.classList.remove('hidden');
    } else {
      wRecent.classList.add('hidden');
    }
  }

  const filtered = _sessionFilter
    ? sessions.filter(s => s.prompt.toLowerCase().includes(_sessionFilter))
    : sessions;

  if (!filtered.length) {
    sessionList.innerHTML = _sessionFilter
      ? '<div class="sb-empty">No matches</div>'
      : '<div class="sb-empty">No sessions yet</div>';
    return;
  }

  sessionList.innerHTML = '';
  filtered.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'sitem' + (s.id === activeSid ? ' active' : '');
    if (sessionLocked && s.id !== activeSid) btn.disabled = true;

    const metaParts = [relTime(s.ts)];
    if (s.files) metaParts.push(s.files + ' file' + (s.files !== 1 ? 's' : ''));
    if (s.tools) metaParts.push(s.tools + ' tools');
    if (s.subtasks) metaParts.push(s.subtasks.done + '/' + s.subtasks.total + ' subtasks');
    if (s.elapsed != null) {
      const m = Math.floor(s.elapsed / 60), sec = s.elapsed % 60;
      metaParts.push(m ? m + 'm ' + sec + 's' : sec + 's');
    }

    const PROV_SHORT = {
      chatgpt: 'GPT', gemini: 'Gem', deepseek: 'DSK',
      grok: 'Grk', copilot: 'Cop', copilot365: 'C365', claude: 'Cld',
    };
    const provBadge = s.provider
      ? '<span class="s-prov" data-prov="' + s.provider + '">'
        + (PROV_SHORT[s.provider] || s.provider.slice(0, 3).toUpperCase())
        + '</span>'
      : '';

    // Highlight matching text when filtering
    let promptHtml = esc(s.prompt);
    if (_sessionFilter) {
      const idx = s.prompt.toLowerCase().indexOf(_sessionFilter);
      if (idx >= 0) {
        const before = esc(s.prompt.slice(0, idx));
        const match  = esc(s.prompt.slice(idx, idx + _sessionFilter.length));
        const after  = esc(s.prompt.slice(idx + _sessionFilter.length));
        promptHtml   = before + '<mark class="s-match">' + match + '</mark>' + after;
      }
    }

    btn.innerHTML = '<div class="s-dot ' + s.status + '"></div>'
      + '<div class="s-body">'
      + '<div class="s-prompt">' + promptHtml + '</div>'
      + '<div class="s-meta">' + metaParts.join(' · ') + '</div>'
      + '</div>'
      + provBadge;
    btn.addEventListener('click', () => switchSession(s.id));
    // Arrow key navigation within the list
    btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = btn.nextElementSibling;
        if (next) next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = btn.previousElementSibling;
        if (prev) prev.focus();
        else document.querySelector('.ss-search')?.focus();
      } else if (e.key === 'Escape') {
        window._closeDropdowns?.();
      }
    });
    sessionList.appendChild(btn);
  });
}

// Auto-refresh relative timestamps in the session list every 30s
setInterval(renderSessions, 30000);

// ── Internal DOM helpers ───────────────────────────────────────────────────

function clearMsgs() {
  Array.from(messages.children).forEach(n => {
    if (n !== typingEl && n !== welcomeEl) n.remove();
  });
}

function showWelcome() { welcomeEl.style.display = ''; }
function hideWelcome() { welcomeEl.style.display = 'none'; }
function hideTyping()  { typingEl.style.display = 'none'; }
