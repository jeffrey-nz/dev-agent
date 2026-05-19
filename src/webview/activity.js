/**
 * activity.js — Activity strip and session delta tracking
 *
 * Manages the left-side activity strip (#activity-strip) which shows
 * one chip per changed file during a session. Also updates the session
 * delta summary (total lines +added / -removed).
 *
 * The strip has a maximum chip count (MAX_CHIPS = 7). Any additional files
 * are counted in an overflow indicator ("+N more").
 *
 * Exports:
 *   addActivityChip(data, diffEl) — add/update a file chip in the strip
 *   addChangesSummary()           — insert a session-end changes summary card
 *   updateSessionDelta(added, removed) — accumulate and display line totals
 *   resetSessionTracking()        — reset all activity counters for a new run
 */

import {
  _chipMap, _hiddenChipsCount, _writesThisSession, _runsThisSession,
  setHiddenChipsCount, setWritesThisSession, setRunsThisSession,
  setReadsThisSession, setSubtasksCompleted, setSubtasksTotal,
  setTotalAdded, setTotalRemoved, _totalAdded, _totalRemoved,
} from './state.js';
import { langColor } from './diffs.js';
import { resetProgress } from './phases.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** Maximum number of file chips shown in the activity strip before overflow. */
const MAX_CHIPS = 7;

// ── Element refs ───────────────────────────────────────────────────────────
const activityStrip    = document.getElementById('activity-strip');
const activityChips    = document.getElementById('activity-chips');
const activityOverflow = document.getElementById('activity-overflow');
const sessionDeltaEl   = document.getElementById('session-delta');
const phaseStats       = document.getElementById('phase-stats');
const ctxMeter         = document.getElementById('ctx-meter');
const phasePillsEl     = document.getElementById('phase-pills');

// ── Expand-all toggle ───────────────────────────────────────────────────────
let _diffsExpanded = false;
document.getElementById('btn-as-toggle')?.addEventListener('click', () => {
  _diffsExpanded = !_diffsExpanded;
  document.querySelectorAll('.diff-card').forEach(el =>
    el.classList.toggle('open', _diffsExpanded)
  );
  const btn = document.getElementById('btn-as-toggle');
  if (btn) {
    btn.textContent = _diffsExpanded ? '⊟' : '⊞';
    btn.title = _diffsExpanded ? 'Collapse all diffs' : 'Expand all diffs';
  }
});

/**
 * Escape HTML special characters.
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Insert-before-typing helper (set in index.js via window). */
function ibt(el) { window._ibt?.(el); }

// ── Activity strip ─────────────────────────────────────────────────────────

/**
 * Add a new file chip to the activity strip, or update an existing one
 * if the same path has been written more than once.
 *
 * Also wires up a click handler that scrolls to and briefly highlights
 * the corresponding diff card in the messages column.
 *
 * @param {object}      data    - Data from the file_diff event.
 * @param {string}      data.relPath - Relative file path.
 * @param {string}      [data.ext]   - File extension without dot.
 * @param {boolean}     [data.isNew] - True for newly created files.
 * @param {number}      [data.added]   - Lines added.
 * @param {number}      [data.removed] - Lines removed.
 * @param {HTMLElement|null} diffEl - The `.diff-card` element to scroll to.
 */
export function addActivityChip(data, diffEl) {
  if (!activityStrip) return;
  activityStrip.classList.remove('hidden');

  const { relPath = '', ext = '', isNew, added = 0, removed = 0 } = data;
  const slash = relPath.lastIndexOf('/');
  const fname = slash >= 0 ? relPath.slice(slash + 1) : relPath;

  // Update existing chip if this file was already tracked
  if (_chipMap.has(relPath)) {
    const entry = _chipMap.get(relPath);
    entry.added   += added;
    entry.removed += removed;
    const st = entry.chip.querySelector('.ac-stats');
    if (st) st.innerHTML = _chipStatsHtml(entry.added, entry.removed, isNew);
    return;
  }

  // Create a new chip
  const chip = document.createElement('div');
  chip.className = 'ac-chip';
  chip.title = relPath;
  chip.innerHTML = '<span class="ac-dot" style="background:' + langColor(ext) + '"></span>'
    + '<span class="ac-name">' + esc(fname) + '</span>'
    + '<span class="ac-stats">' + _chipStatsHtml(added, removed, isNew) + '</span>';

  // Click: scroll to the diff card and briefly flash it
  if (diffEl) {
    chip.addEventListener('click', e => {
      e.stopPropagation();
      diffEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      diffEl.classList.add('diff-flash');
      setTimeout(() => diffEl.classList.remove('diff-flash'), 750);
    });
  }

  _placeChip(chip);
  _chipMap.set(relPath, { chip, added, removed });
}

/**
 * Place a chip in the strip, or increment the overflow counter if full.
 *
 * @param {HTMLElement} chip
 */
function _placeChip(chip) {
  const visible = activityChips.querySelectorAll('.ac-chip').length;
  if (visible < MAX_CHIPS) {
    activityChips.appendChild(chip);
  } else {
    const next = _hiddenChipsCount + 1;
    setHiddenChipsCount(next);
    if (activityOverflow) {
      activityOverflow.textContent = '+' + next + ' more';
      activityOverflow.classList.remove('hidden');
    }
  }
}

/**
 * Build the inner HTML for the chip's stats column.
 *
 * @param {number}  added
 * @param {number}  removed
 * @param {boolean} isNew
 * @returns {string}
 */
function _chipStatsHtml(added, removed, isNew) {
  if (isNew) return '<span class="ac-new">new</span>';
  let s = '';
  if (added)   s += '<span class="ac-add">+' + added + '</span>';
  if (removed) s += '<span class="ac-rem">-' + removed + '</span>';
  return s;
}

// ── Session delta ──────────────────────────────────────────────────────────

/**
 * Accumulate line counts and update the session delta display in the phase bar.
 *
 * @param {number} added   - Lines added in this diff.
 * @param {number} removed - Lines removed in this diff.
 */
export function updateSessionDelta(added, removed) {
  setTotalAdded(_totalAdded + added);
  setTotalRemoved(_totalRemoved + removed);
  if (!sessionDeltaEl) return;
  if (!_totalAdded && !_totalRemoved) { sessionDeltaEl.classList.add('hidden'); return; }
  sessionDeltaEl.classList.remove('hidden');
  let html = '';
  if (_totalAdded)   html += '<span class="sd-add">+' + _totalAdded + '</span>';
  if (_totalRemoved) html += '<span class="sd-rem"> −' + _totalRemoved + '</span>';
  sessionDeltaEl.innerHTML = html;
}

// ── Phase stats ────────────────────────────────────────────────────────────

/**
 * Rebuild the phase bar stats display (reads / writes / runs counts).
 * Called from the events handler on each tool_call_start.
 */
export function updatePhaseStats() {
  // _readsThisSession is a Set exposed via window by index.js
  const reads  = window._readsThisSession?.size || 0;
  const writes = _writesThisSession.length;
  const runs   = _runsThisSession;
  const parts  = [];
  if (reads)  parts.push('<span class="pstat" title="files read"><span class="pstat-val">' + reads  + '</span>r</span>');
  if (writes) parts.push('<span class="pstat" title="files written"><span class="pstat-val">' + writes + '</span>w</span>');
  if (runs)   parts.push('<span class="pstat" title="commands run"><span class="pstat-val">' + runs   + '</span>!</span>');
  if (phaseStats) phaseStats.innerHTML = parts.join('');
}

// ── Session tracking reset ─────────────────────────────────────────────────

/**
 * Reset all per-session activity counters and clear the activity strip UI.
 * Called at the start of each new task run.
 */
export function resetSessionTracking() {
  setWritesThisSession([]);
  setReadsThisSession(new Set());
  setRunsThisSession(0);
  setSubtasksCompleted(0);
  setSubtasksTotal(0);
  setTotalAdded(0);
  setTotalRemoved(0);
  _chipMap.clear();
  setHiddenChipsCount(0);
  _diffsExpanded = false;
  const toggleBtn = document.getElementById('btn-as-toggle');
  if (toggleBtn) { toggleBtn.textContent = '⊞'; toggleBtn.title = 'Expand all diffs'; }

  if (activityChips) activityChips.innerHTML = '';
  activityOverflow?.classList.add('hidden');
  activityStrip?.classList.add('hidden');
  sessionDeltaEl?.classList.add('hidden');
  phasePillsEl?.classList.add('hidden');
  ctxMeter?.classList.remove('show');
  if (phaseStats) phaseStats.innerHTML = '';
  resetProgress();
}

// ── Changes summary card ───────────────────────────────────────────────────

/**
 * Escape HTML special characters (local copy to avoid importing circular deps).
 * @param {string} s
 * @returns {string}
 */
function escLocal(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Insert a "files changed" summary card into the message feed at session end.
 * Only shown when at least one file was written or command was run.
 */
export function addChangesSummary() {
  if (!_writesThisSession.length && !_runsThisSession) return;

  const fileCount = _writesThisSession.length;
  const newCount  = _writesThisSession.filter(f => f.isNew).length;
  const wLabel = fileCount
    ? fileCount + ' file' + (fileCount > 1 ? 's' : '') + (newCount ? ' (' + newCount + ' new)' : '')
    : '';
  const rLabel = _runsThisSession
    ? _runsThisSession + ' command' + (_runsThisSession > 1 ? 's' : '') + ' run'
    : '';
  const deltaLabel = (_totalAdded || _totalRemoved)
    ? (_totalAdded ? '+' + _totalAdded : '') + (_totalRemoved ? ' −' + _totalRemoved : '')
    : '';
  const title = [wLabel, rLabel, deltaLabel].filter(Boolean).join(' · ');

  const items = _writesThisSession.map(f => {
    const sym   = f.isNew ? 'new' : 'mod';
    const glyph = f.isNew ? '+' : '✎';
    const tag   = f.isNew ? '<span class="change-tag">new</span>' : '';
    // Show at most 2 path segments (parent/file.ext) — full path stays in tooltip + data-fp
    const parts = f.path.replace(/\\/g, '/').split('/').filter(Boolean);
    const displayPath = parts.length > 2 ? parts.slice(-2).join('/') : f.path;
    return '<div class="change-item clickable" data-fp="' + escLocal(f.path) + '" title="' + escLocal(f.path) + '">'
      + '<span class="change-sym ' + sym + '">' + glyph + '</span>'
      + '<span class="change-path">' + escLocal(displayPath) + '</span>'
      + tag
      + '</div>';
  });

  if (_runsThisSession) {
    items.push('<div class="change-item">'
      + '<span class="change-sym run">⚡</span>'
      + '<span class="change-path">' + _runsThisSession + ' shell command'
      + (_runsThisSession > 1 ? 's ran' : ' ran') + '</span>'
      + '</div>');
  }

  const d = document.createElement('div');
  d.className = 'changes-card open';
  d.innerHTML = '<div class="changes-hdr" onclick="this.parentElement.classList.toggle(\'open\')">'
    + '<span class="changes-title">' + title + '</span>'
    + '<span class="changes-caret">▾</span>'
    + '</div>'
    + '<div class="changes-list">' + items.join('') + '</div>';

  // Wire up "open in editor" clicks on file rows
  d.querySelectorAll('.change-item.clickable').forEach(el => {
    el.addEventListener('click', () => {
      const fp = el.dataset.fp;
      if (fp) window.openFile?.(fp);
    });
  });

  ibt(d);
}
