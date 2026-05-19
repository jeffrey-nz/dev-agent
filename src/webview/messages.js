/**
 * messages.js — Chat message rendering
 *
 * All functions that create DOM nodes for the message feed, plus the notes
 * drawer management and session handoff card.
 *
 * Exports:
 *   addUserMsg(text)           — right-aligned user bubble
 *   addAgentMsg(text)          — left-aligned agent response (with Markdown)
 *   addAttachmentMsg(count)    — attachment-sent indicator
 *   addSysMsg(text, err, warn, ok) — coloured system/info message
 *   addSpecialCard(type, text) — collapsible plan/review card
 *   addDoneBanner()            — session-complete green banner
 *   addStopBanner()            — user-stopped red banner
 *   addErrorBanner(lastPrompt) — task-failed amber banner with recovery actions
 *   addHandoffCard(msg)        — browser session rotation card
 *   addNoteChip(type, html)    — plan/review entry in the notes drawer
 *   clearNotes()               — clear the notes drawer
 */

import { renderMarkdown, extractAgentText } from './markdown.js';
import {
  sessions, runningSid, activeSid, _sessionStartTs,
  _writesThisSession, _subtasksCompleted, _subtasksTotal,
  _notesSeq, setNotesSeq,
  _totalAdded, _totalRemoved,
} from './state.js';
import { _history } from './state.js';

// ── Element refs ───────────────────────────────────────────────────────────
const messages   = document.getElementById('messages');
const typingEl   = document.getElementById('typing');
const welcomeEl  = document.getElementById('welcome');
const notesList  = document.getElementById('notes-list');
const notesEmpty = document.getElementById('notes-empty');
const notesBadge = document.getElementById('notes-badge');

/**
 * Escape HTML special characters.
 * @param {string} s
 * @returns {string}
 */
export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Scroll helpers ─────────────────────────────────────────────────────────

function scrollMsgs() {
  if (!window._userScrolled) messages.scrollTop = messages.scrollHeight;
}

// Track unseen messages while the user has scrolled up
let _unreadCount = 0;

/** Reset the unread counter and notify the scroll-button updater. */
export function resetUnread() {
  _unreadCount = 0;
  window._onUnreadIncrement?.(0);
}

/**
 * Insert a node before the typing indicator, then scroll to bottom.
 * Exposed on window as _ibt so other modules can call it without circular deps.
 *
 * @param {HTMLElement} el - Element to insert.
 */
export function ibt(el) {
  if (el) {
    messages.insertBefore(el, typingEl);
    if (window._userScrolled) {
      _unreadCount++;
      window._onUnreadIncrement?.(_unreadCount);
    }
  }
  scrollMsgs();
}

// Make ibt available to modules that only use window._ibt
window._ibt = ibt;

// ── Typing indicator ───────────────────────────────────────────────────────

export function showTyping() {
  ibt(null);
  typingEl.style.display = 'flex';
  scrollMsgs();
}

export function hideTyping() {
  typingEl.style.display = 'none';
}

// ── User message ───────────────────────────────────────────────────────────

/**
 * Add a user chat bubble to the message feed.
 *
 * @param {string} text - The user's prompt text.
 */
export function addUserMsg(text) {
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const d = document.createElement('div');
  d.className = 'msg-u';
  d.innerHTML = '<div class="msg-sender" title="' + timeStr + '">You</div>'
    + '<div class="msg-body">' + esc(text) + '</div>';

  // Copy button (appears on hover)
  const copyBtn = document.createElement('button');
  copyBtn.className = 'msg-u-copy';
  copyBtn.title = 'Copy message';
  copyBtn.textContent = '⎘';
  copyBtn.addEventListener('click', e => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = '✓';
      setTimeout(() => { copyBtn.textContent = '⎘'; }, 1400);
    }).catch(() => {});
  });
  d.appendChild(copyBtn);

  // Double-click bubble to refill the prompt input
  const body = d.querySelector('.msg-body');
  if (body) {
    body.title = 'Double-click to reuse';
    body.addEventListener('dblclick', () => window.fillPrompt?.(text));
  }

  ibt(d);
  // Collapse very long user messages
  requestAnimationFrame(() => {
    const b = d.querySelector('.msg-body');
    if (b && b.scrollHeight > 160) {
      d.classList.add('msg-u-long');
      const btn = document.createElement('button');
      btn.className = 'msg-expand-btn';
      btn.textContent = 'Show more ▾';
      btn.addEventListener('click', () => {
        const expanded = d.classList.toggle('expanded');
        btn.textContent = expanded ? 'Show less ▴' : 'Show more ▾';
      });
      d.appendChild(btn);
    }
  });
}

/**
 * Add an attachment-sent indicator (shown after images are queued with a prompt).
 *
 * @param {number} count - Number of images attached.
 */
export function addAttachmentMsg(count) {
  const d = document.createElement('div');
  d.className = 'msg-u att-sent';
  d.innerHTML = '<div class="msg-sender">You</div>'
    + '<div class="msg-body att-body">📎 ' + count + ' image' + (count !== 1 ? 's' : '') + ' attached</div>';
  ibt(d);
}

// ── Agent message ──────────────────────────────────────────────────────────

/**
 * Add a collapsible "Show more / Show less" toggle to a message or card.
 * The button is added as a child of `container`.
 *
 * @param {HTMLElement} container - The parent element (.msg-a or .sc-card).
 * @param {HTMLElement} bodyEl    - The element to expand/collapse.
 */
export function _addExpandToggle(container, bodyEl) {
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

const _PROV_LABELS = {
  deepseek: 'DeepSeek', chatgpt: 'ChatGPT', gemini: 'Gemini',
  grok: 'Grok', copilot: 'Copilot', copilot365: 'Copilot', claude: 'Claude',
};

/**
 * Add an agent message to the feed with rendered Markdown.
 * Long messages (> 320px) get a "Show more" collapse toggle.
 *
 * @param {string}  text     - Raw text or Markdown from the agent.
 * @param {string}  [provider] - Provider ID that generated the message.
 */
export function addAgentMsg(text, provider) {
  if (!text?.trim()) return;
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const provLabel = provider ? (_PROV_LABELS[provider] || provider) : null;
  const provBadge = provLabel
    ? '<span class="msg-via-prov" data-prov="' + provider + '">' + provLabel + '</span>'
    : '';
  const d = document.createElement('div');
  d.className = 'msg-a';
  if (provider) d.dataset.prov = provider;
  d.innerHTML = '<div class="msg-sender agent" title="' + timeStr + '">Dev Agent' + (provBadge ? ' ' + provBadge : '') + '</div>'
    + '<div class="mab-md">' + renderMarkdown(text) + '</div>'
    + '<button class="msg-copy" onclick="copyMsg(this)" title="Copy response">⎘</button>';
  ibt(d);
  requestAnimationFrame(() => {
    const body = d.querySelector('.mab-md');
    if (body && body.scrollHeight > 320) {
      d.classList.add('collapsible');
      _addExpandToggle(d, body);
    }
  });
}

// ── System messages ────────────────────────────────────────────────────────

/**
 * Add a system/status message to the feed.
 *
 * @param {string}  text   - Message text.
 * @param {boolean} [isErr]  - Render as an error message.
 * @param {boolean} [isWarn] - Render as a warning message.
 * @param {boolean} [isOk]   - Render as a success message (green).
 */
export function addSysMsg(text, isErr, isWarn, isOk) {
  if (!text) return;
  const d = document.createElement('div');
  if (isErr)       { d.className = 'msg-err';  d.textContent = '✗ ' + text; }
  else if (isWarn) { d.className = 'msg-warn'; d.textContent = text; }
  else if (isOk)   { d.className = 'msg-ok';   d.textContent = text; }
  else             { d.className = 'msg-sys';  d.textContent = text; }
  // Error and warning messages are clickable to copy
  if (isErr || isWarn) {
    d.title = 'Click to copy';
    d.style.cursor = 'pointer';
    d.addEventListener('click', () => {
      navigator.clipboard?.writeText(text).catch(() => {});
      const prev = d.style.opacity;
      d.style.opacity = '0.5';
      setTimeout(() => { d.style.opacity = prev || ''; }, 300);
    });
  }
  // Errors get a subtle "Try again" link when a previous prompt exists
  if (isErr && _history[0]) {
    const retry = document.createElement('button');
    retry.className = 'msg-err-retry';
    retry.textContent = '↺ Try again';
    retry.addEventListener('click', e => {
      e.stopPropagation();
      window.fillPrompt?.(_history[0]);
    });
    d.appendChild(retry);
  }
  ibt(d);
}

// ── Special cards (plan / review) ─────────────────────────────────────────

/**
 * Insert a collapsible plan or review card into the message feed,
 * and also add a note chip to the notes drawer.
 *
 * @param {'plan'|'review'} type - Card type.
 * @param {string} text          - Raw Markdown content.
 */
export function addSpecialCard(type, text) {
  if (!text?.trim()) return;
  const cfg = {
    plan:   { label: 'Plan',   color: 'var(--cp)', icon: '≡' },
    review: { label: 'Review', color: 'var(--cv)', icon: '◎' },
  }[type] || { label: type, color: 'var(--mu)', icon: '·' };

  const renderedHtml = renderMarkdown(text);
  const d = document.createElement('div');
  d.className = 'sc-card ' + type + ' open';
  // seq = _notesSeq + 1 (addNoteChip will increment it after we set this)
  d.dataset.noteSeq = String(_notesSeq + 1);
  d.innerHTML = '<div class="sc-hdr" onclick="this.parentElement.classList.toggle(\'open\')">'
    + '<span class="sc-icon" style="color:' + cfg.color + '">' + cfg.icon + '</span>'
    + '<span class="sc-label">' + cfg.label + '</span>'
    + '<span class="sc-caret">▾</span>'
    + '</div>'
    + '<div class="sc-body mab-md">' + renderedHtml + '</div>';
  ibt(d);

  requestAnimationFrame(() => {
    const body = d.querySelector('.sc-body');
    if (body && body.scrollHeight > 320) {
      d.classList.add('collapsible');
      _addExpandToggle(d, body);
    }
  });

  addNoteChip(type, renderedHtml);
}

// ── Banner helpers ─────────────────────────────────────────────────────────

/**
 * Format the elapsed session time as " · Xs" or " · Xm Ys".
 * Returns an empty string if no session is running.
 *
 * @returns {string}
 */
function _bannerTime() {
  if (!_sessionStartTs) return '';
  const s = Math.round((Date.now() - _sessionStartTs) / 1000);
  return ' · ' + (s >= 60 ? Math.floor(s / 60) + 'm ' + s % 60 + 's' : s + 's');
}

/**
 * Insert a row of quick-action buttons below a done/stop banner.
 * Buttons fill the prompt input (fillPrompt) or re-submit (retryPrompt).
 *
 * @param {string} lastPrompt - The prompt that just finished running.
 */
function _addBannerActs(lastPrompt) {
  if (!lastPrompt) return;
  const acts = document.createElement('div');
  acts.className = 'banner-acts';
  const fileCount = _writesThisSession.length;
  const newCount  = _writesThisSession.filter(f => f.isNew).length;
  const fileStat  = fileCount
    ? (fileCount + ' file' + (fileCount !== 1 ? 's' : '') + (newCount ? ' · ' + newCount + ' new' : ''))
    : '';
  acts.innerHTML =
    (fileStat ? '<span class="bstat">' + fileStat + '</span>' : '')
    + '<button class="bact primary" data-p="' + esc(lastPrompt) + '" onclick="retryPrompt(this)">↺ Run again</button>'
    + '<button class="bact" onclick="fillPrompt(\'Fix any remaining issues, errors or warnings\')">Fix issues</button>'
    + '<button class="bact" onclick="fillPrompt(\'Add comprehensive tests for all the changes made\')">Add tests</button>'
    + '<button class="bact" onclick="fillPrompt(\'Review the code and suggest improvements\')">Review</button>';
  ibt(acts);
}

/**
 * Generate context-aware follow-up suggestion chips below the done banner.
 * Picks 4 suggestions from a context-sensitive pool based on written files.
 */
function _addFollowUpSuggestions() {
  const writes = _writesThisSession;
  if (!writes.length && !_history[0]) return;

  const exts = new Set(writes.map(f => (f.path.split('.').pop() || '').toLowerCase()));

  // Build a pool ordered by relevance; first 4 are always shown
  const pool = [
    { icon: '🧪', label: 'Write tests',    prompt: 'Write comprehensive tests for all the changes made, covering edge cases and error paths' },
    { icon: '🔍', label: 'Code review',    prompt: 'Carefully review all the changes for bugs, edge cases, security issues, and potential improvements' },
    { icon: '📝', label: 'Add docs',       prompt: 'Add clear documentation comments and update the README for all the changes' },
    { icon: '🔒', label: 'Harden it',      prompt: 'Add input validation, error handling, and defensive checks to all the new code' },
    { icon: '🚀', label: 'Optimise',       prompt: 'Profile and optimise the new code for performance, memory usage, and bundle size' },
    { icon: '♿', label: 'Accessibility',  prompt: 'Audit and improve accessibility: ARIA labels, keyboard navigation, colour contrast' },
  ];

  // Prepend context-specific suggestions (higher priority = inserted later so it wins)
  if (writes.some(f => f.isNew)) {
    pool.unshift({ icon: '🐳', label: 'Dockerise',  prompt: 'Create a production-ready Dockerfile, docker-compose.yml, and .dockerignore for this project' });
  }
  if (exts.has('jsx') || exts.has('tsx')) {
    pool.unshift({ icon: '⚛', label: 'Add stories', prompt: 'Create Storybook stories for all React components created or modified, with realistic mock data' });
  }
  if (exts.has('css') || exts.has('scss') || exts.has('less')) {
    pool.unshift({ icon: '🌙', label: 'Dark mode',   prompt: 'Add a dark mode theme: CSS variables for colours, a toggle button, and persist the preference in localStorage' });
  }
  if (exts.has('sql') || writes.some(f => /migrat|model|schema/i.test(f.path))) {
    pool.unshift({ icon: '🗃', label: 'Add indexes',  prompt: 'Analyse the database queries and add appropriate indexes to improve performance' });
  }
  if (writes.some(f => /route|api|endpoint|controller/i.test(f.path))) {
    pool.unshift({ icon: '📡', label: 'Document API', prompt: 'Generate OpenAPI / Swagger documentation for all API endpoints, including request and response schemas' });
  }
  if (exts.has('py')) {
    pool.unshift({ icon: '📎', label: 'Type hints', prompt: 'Add comprehensive type hints and Google-style docstrings to all Python functions and classes' });
  }
  if (exts.has('ts') || exts.has('tsx')) {
    pool.unshift({ icon: '⌨', label: 'Fix TS types', prompt: 'Fix all TypeScript type errors and add precise type annotations to every new function and interface' });
  }

  const chosen = pool.slice(0, 4);
  const wrap = document.createElement('div');
  wrap.className = 'fu-grid';
  chosen.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'fu-btn';
    btn.addEventListener('click', () => window.fillPrompt?.(s.prompt));
    btn.innerHTML = '<span class="fu-icon">' + s.icon + '</span><span>' + s.label + '</span>';
    wrap.appendChild(btn);
  });
  ibt(wrap);
}

/**
 * Insert a green "Task complete" banner with action buttons.
 */
export function addDoneBanner() {
  const d = document.createElement('div');
  d.className = 'done-banner';
  let label = '✓ Task complete' + _bannerTime();
  const sess = sessions.find(x => x.id === runningSid || x.id === activeSid);
  const fileCount = _writesThisSession.length;
  const newCount  = _writesThisSession.filter(f => f.isNew).length;
  if (fileCount) label += ' · ' + fileCount + ' file' + (fileCount !== 1 ? 's' : '') + (newCount ? ' (' + newCount + ' new)' : '');
  if (sess?.tools) label += ' · ' + sess.tools + ' tools';
  if (_subtasksTotal > 1) label += ' · ' + _subtasksCompleted + '/' + _subtasksTotal + ' subtasks';
  if (_totalAdded || _totalRemoved) {
    const delta = (_totalAdded ? '+' + _totalAdded : '') + (_totalRemoved ? ' −' + _totalRemoved : '');
    label += ' · ' + delta + ' lines';
  }
  d.innerHTML = '<div class="done-line"></div><span>' + label + '</span><div class="done-line"></div>';
  ibt(d);
  _addBannerActs(_history[0]);
  _addFollowUpSuggestions();
}

/**
 * Insert a red "Stopped" banner with action buttons and a "Continue" suggestion chip.
 */
export function addStopBanner() {
  const d = document.createElement('div');
  d.className = 'stop-banner';
  let label = '✗ Stopped' + _bannerTime();
  const fileCount = _writesThisSession.length;
  if (fileCount) label += ' · ' + fileCount + ' file' + (fileCount !== 1 ? 's' : '');
  if (_totalAdded || _totalRemoved) {
    const delta = (_totalAdded ? '+' + _totalAdded : '') + (_totalRemoved ? ' −' + _totalRemoved : '');
    label += ' · ' + delta + ' lines';
  }
  d.innerHTML = '<div class="stop-line"></div><span>' + label + '</span><div class="stop-line"></div>';
  ibt(d);
  _addBannerActs(_history[0]);
  // "Continue" chip below stop banner
  const cont = document.createElement('div');
  cont.className = 'fu-grid';
  cont.innerHTML =
    '<button class="fu-btn" onclick="fillPrompt(\'Continue where you left off and complete the remaining work\')"><span class="fu-icon">▶</span><span>Continue</span></button>'
    + '<button class="fu-btn" onclick="fillPrompt(\'Fix any errors or issues, then complete the task\')"><span class="fu-icon">🔧</span><span>Fix &amp; finish</span></button>'
    + '<button class="fu-btn" onclick="fillPrompt(\'Review what was done so far and summarise the progress\')"><span class="fu-icon">📋</span><span>Review progress</span></button>';
  ibt(cont);
}

/**
 * Insert an amber error banner with "Try again" and recovery action buttons.
 *
 * @param {string} [lastPrompt] - The prompt that caused the error.
 */
export function addErrorBanner(lastPrompt) {
  const d = document.createElement('div');
  d.className = 'error-banner';
  let label = '⚠ Task failed' + _bannerTime();
  const fileCount = _writesThisSession.length;
  if (fileCount) label += ' · ' + fileCount + ' file' + (fileCount !== 1 ? 's' : '') + ' changed before error';
  d.innerHTML = '<div class="err-line"></div><span>' + label + '</span><div class="err-line"></div>';
  ibt(d);

  if (lastPrompt) {
    const acts = document.createElement('div');
    acts.className = 'banner-acts';
    acts.innerHTML =
      '<button class="bact primary" data-p="' + esc(lastPrompt) + '" onclick="retryPrompt(this)">↺ Try again</button>'
      + '<button class="bact" onclick="fillPrompt(\'Diagnose and fix the error that just occurred, then complete the original task\')">🔧 Fix error</button>'
      + '<button class="bact" onclick="fillPrompt(\'Explain the error that occurred and suggest how to resolve it\')">Explain error</button>';
    ibt(acts);
  }
}

// ── Handoff card ───────────────────────────────────────────────────────────

/**
 * Insert a session handoff card when the browser context threshold is reached
 * and a new AI session is started to continue the task.
 *
 * @param {object} msg - The session_handoff event payload.
 */
export function addHandoffCard(msg) {
  const d = document.createElement('div');
  d.className = 'handoff-card';

  const provLabel = (msg.providerName || 'Browser')
    .replace('copilot365', 'Copilot')
    .replace('deepseek', 'DeepSeek')
    .replace('claude', 'Claude');
  const sessionNum = msg.segmentIndex ?? 1;

  // Capture the ctx% at time of handoff (meter resets after this card is shown)
  const ctxEl  = document.getElementById('ctx-fill');
  const ctxPct = ctxEl ? parseInt(ctxEl.style.width || '0', 10) : null;

  // Subtask progress
  const subtasks     = msg.subtasks || [];
  const currentIdx   = msg.currentSubtaskIndex ?? 0;
  const completedCount = subtasks.filter((_, i) => i < currentIdx).length;
  const totalCount   = subtasks.length;
  const currentTask  = subtasks[currentIdx]?.task || '';
  const modCount     = (msg.allModifiedFiles || []).length;

  // Progress bar HTML
  let progressBar = '';
  if (totalCount > 0) {
    const pct = Math.round((completedCount / totalCount) * 100);
    progressBar = '<div class="hc-progress-wrap">'
      + '<div class="hc-progress-bar"><div class="hc-progress-fill" style="width:' + pct + '%"></div></div>'
      + '<span class="hc-progress-label">' + completedCount + '/' + totalCount + ' subtasks</span>'
      + '</div>';
  }

  // Subtask list (collapsed by default)
  let taskList = '';
  if (subtasks.length > 0) {
    const rows = subtasks.map((s, i) => {
      const marker = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'pending';
      const glyph  = i < currentIdx ? '✓' : i === currentIdx ? '→' : '○';
      const filesNote = s.files?.length > 0
        ? '<span class="hc-task-files">' + esc(s.files.join(', ')) + '</span>'
        : '';
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
    + '<div class="hc-title">Session ' + sessionNum + ' · ' + provLabel
    + (ctxPct != null && ctxPct > 0 ? '<span class="hc-ctx-pct">' + ctxPct + '% ctx</span>' : '')
    + '</div>'
    + '<div class="hc-subtitle">'
    + (currentTask
      ? 'Continuing: <em>' + esc(currentTask.slice(0, 60)) + (currentTask.length > 60 ? '…' : '') + '</em>'
      : 'Context window full — new session started')
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

/**
 * Update the context usage meter in the phase bar.
 *
 * @param {number} messageCount   - Current message count.
 * @param {number|null} threshold - Session rotation threshold.
 * @param {number} [segmentIndex] - Current segment number (1-based).
 */
export function updateCtxMeter(messageCount, threshold, segmentIndex) {
  const ctxMeter = document.getElementById('ctx-meter');
  const ctxFill  = document.getElementById('ctx-fill');
  const ctxLbl   = document.getElementById('ctx-lbl');
  if (!ctxMeter || !ctxFill || !ctxLbl) return;
  if (!threshold) { ctxMeter.classList.remove('show'); return; }

  const pct = Math.min(100, Math.round((messageCount / threshold) * 100));
  ctxFill.style.width = pct + '%';
  ctxFill.classList.toggle('warn', pct >= 60 && pct < 85);
  ctxFill.classList.toggle('crit', pct >= 85);
  ctxMeter.classList.toggle('ctx-warn',   pct >= 60 && pct < 85);
  ctxMeter.classList.toggle('ctx-danger', pct >= 85);
  ctxMeter.title = pct + '% context used · ' + messageCount + '/' + threshold + ' messages';

  // Label: "S2 · 78%" — segment prefix only on non-first segments
  // At >85% show "↺ soon" to signal imminent session rotation
  const segPfx = segmentIndex > 1 ? 'S' + segmentIndex + ' · ' : '';
  const remaining = threshold - messageCount;
  ctxLbl.textContent = pct >= 85 ? segPfx + '↺ soon' : segPfx + pct + '%';
  ctxLbl.title = pct + '% context used · ' + messageCount + '/' + threshold + ' messages · ~' + remaining + ' remaining';
  ctxMeter.classList.add('show');
}

// ── Notes drawer ───────────────────────────────────────────────────────────

/**
 * Clear the notes drawer.
 * Called at the start of each new chat session.
 */
export function clearNotes() {
  setNotesSeq(0);
  if (notesList) { notesList.innerHTML = ''; notesList.appendChild(notesEmpty); }
  notesBadge?.classList.remove('show');
}

/**
 * Add a plan or review note chip to the notes drawer.
 *
 * @param {'plan'|'review'} type - Chip type.
 * @param {string} html          - Pre-rendered HTML content.
 */
export function addNoteChip(type, html) {
  const seq = _notesSeq + 1;
  setNotesSeq(seq);
  notesEmpty?.remove();

  const cfg = {
    plan:   { label: 'Plan',   icon: '≡' },
    review: { label: 'Review', icon: '◎' },
  }[type] || { label: type, icon: '·' };

  const chip = document.createElement('div');
  chip.className = 'note-chip ' + type + ' open';
  chip.dataset.seq = seq;

  const hdr = document.createElement('div');
  hdr.className = 'note-chip-hdr';
  hdr.innerHTML = '<span class="note-chip-icon">' + cfg.icon + '</span>'
    + '<span class="note-chip-label">' + cfg.label + '</span>'
    + '<span class="note-chip-seq">#' + seq + '</span>';

  // "Jump to in feed" button — scrolls to the matching sc-card in the messages pane
  const jumpBtn = document.createElement('button');
  jumpBtn.className = 'note-chip-jump';
  jumpBtn.title = 'Jump to in feed';
  jumpBtn.textContent = '↗';
  jumpBtn.addEventListener('click', e => {
    e.stopPropagation();
    const target = document.querySelector('.sc-card.' + type + '[data-note-seq="' + seq + '"]');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.style.outline = '2px solid var(--acc)';
      setTimeout(() => { target.style.outline = ''; }, 700);
    }
  });
  hdr.appendChild(jumpBtn);

  const caret = document.createElement('span');
  caret.className = 'note-chip-caret';
  caret.textContent = '▾';
  hdr.appendChild(caret);

  hdr.addEventListener('click', () => chip.classList.toggle('open'));

  const body = document.createElement('div');
  body.className = 'note-chip-body mab-md';
  body.innerHTML = html;

  chip.appendChild(hdr);
  chip.appendChild(body);
  notesList?.appendChild(chip);

  if (notesBadge) { notesBadge.textContent = String(seq); notesBadge.classList.add('show'); }
}
