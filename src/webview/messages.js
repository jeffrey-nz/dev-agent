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
 *   addHandoffCard(msg)        — browser session rotation card
 *   addNoteChip(type, html)    — plan/review entry in the notes drawer
 *   clearNotes()               — clear the notes drawer
 */

import { renderMarkdown, extractAgentText } from './markdown.js';
import {
  sessions, runningSid, activeSid, _sessionStartTs,
  _writesThisSession, _subtasksCompleted, _subtasksTotal,
  _notesSeq, setNotesSeq,
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

/**
 * Insert a node before the typing indicator, then scroll to bottom.
 * Exposed on window as _ibt so other modules can call it without circular deps.
 *
 * @param {HTMLElement} el - Element to insert.
 */
export function ibt(el) {
  if (el) messages.insertBefore(el, typingEl);
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
  const d = document.createElement('div');
  d.className = 'msg-u';
  d.innerHTML = '<div class="msg-sender">You</div>'
    + '<div class="msg-body">' + esc(text) + '</div>';
  ibt(d);
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
  const provLabel = provider ? (_PROV_LABELS[provider] || provider) : null;
  const provBadge = provLabel
    ? '<span class="msg-via-prov" data-prov="' + provider + '">' + provLabel + '</span>'
    : '';
  const d = document.createElement('div');
  d.className = 'msg-a';
  if (provider) d.dataset.prov = provider;
  d.innerHTML = '<div class="msg-sender agent">Dev Agent' + (provBadge ? ' ' + provBadge : '') + '</div>'
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

  // Prepend context-specific suggestions
  if (exts.has('ts') || exts.has('tsx')) {
    pool.unshift({ icon: '⌨', label: 'Fix TS types', prompt: 'Fix all TypeScript type errors and add precise type annotations to every new function and interface' });
  }
  if (exts.has('py')) {
    pool.unshift({ icon: '📎', label: 'Type hints', prompt: 'Add comprehensive type hints and Google-style docstrings to all Python functions and classes' });
  }
  if (exts.has('jsx') || exts.has('tsx')) {
    pool.unshift({ icon: '⚛', label: 'Add stories', prompt: 'Create Storybook stories for all React components created or modified, with realistic mock data' });
  }
  if (writes.some(f => f.isNew)) {
    pool.unshift({ icon: '🐳', label: 'Dockerise',  prompt: 'Create a production-ready Dockerfile, docker-compose.yml, and .dockerignore for this project' });
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
  if (sess?.tools) label += ' · ' + sess.tools + ' tools';
  if (_subtasksTotal > 1) label += ' · ' + _subtasksCompleted + '/' + _subtasksTotal + ' subtasks';
  d.innerHTML = '<div class="done-line"></div><span>' + label + '</span><div class="done-line"></div>';
  ibt(d);
  _addBannerActs(_history[0]);
  _addFollowUpSuggestions();
}

/**
 * Insert a red "Stopped" banner with action buttons.
 */
export function addStopBanner() {
  const d = document.createElement('div');
  d.className = 'stop-banner';
  d.innerHTML = '<div class="stop-line"></div><span>✗ Stopped' + _bannerTime() + '</span><div class="stop-line"></div>';
  ibt(d);
  _addBannerActs(_history[0]);
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
    + '<div class="hc-title">Session ' + sessionNum + ' · ' + provLabel + '</div>'
    + '<div class="hc-subtitle">'
    + (currentTask
      ? 'Continuing: <em>' + esc(currentTask.slice(0, 60)) + (currentTask.length > 60 ? '…' : '') + '</em>'
      : 'Context handed off to new session')
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
  // Show segment prefix ("S2 · 45/60") when on a non-first segment
  const segPfx = segmentIndex > 1 ? 'S' + segmentIndex + ' · ' : '';
  ctxLbl.textContent = segPfx + messageCount + '/' + threshold;
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
  chip.innerHTML = '<div class="note-chip-hdr" onclick="this.parentElement.classList.toggle(\'open\')">'
    + '<span class="note-chip-icon">' + cfg.icon + '</span>'
    + '<span class="note-chip-label">' + cfg.label + '</span>'
    + '<span class="note-chip-seq">#' + seq + '</span>'
    + '<span class="note-chip-caret">▾</span>'
    + '</div>'
    + '<div class="note-chip-body mab-md">' + html + '</div>';
  notesList?.appendChild(chip);

  if (notesBadge) { notesBadge.textContent = String(seq); notesBadge.classList.add('show'); }
}
