/**
 * phases.js — Phase bar, progress bar, phase timeline, and dividers
 *
 * Manages all visual representations of the agent's current phase:
 *
 *   - Phase bar label and colour (--phase-color CSS var)
 *   - Elapsed timer that appends "· 4s" / "· 1m 12s" to the label
 *   - Progress bar fill percentage
 *   - Phase timeline pills (Planning › Researching › Executing …)
 *   - Phase section dividers inserted between messages
 *
 * Exports:
 *   setStep(idx, isDbg)    — update the active step in the stepper
 *   setProgress(pct, color) — set the progress fill percentage
 *   addPhaseDivider(phase)  — insert a phase divider in the message feed
 *   startPhaseTimer(label)  — start the elapsed-time ticker
 *   stopPhaseTimer()        — stop the elapsed-time ticker
 *   resetProgress()         — reset progress bar to 0 without animation
 *   enterStep(idx)          — record step start time + render pills
 *   renderPhasePills()      — rebuild the phase timeline pill row
 *
 * Phase constants:
 *   STEPS       — ordered step descriptors used in the timeline
 *   PHASE_COLORS — maps phase name → CSS colour variable
 *   PHASE_PROGRESS — maps phase name → default progress %
 *   PM           — phase → {icon, label, color} for dividers
 */

import { currentStepIdx, setCurrentStepIdx, _stepTimes, setStepTimes } from './state.js';

// ── Element refs ───────────────────────────────────────────────────────────
const phaseLbl    = document.getElementById('phase-lbl');
const phaseBar    = document.getElementById('phase-bar');
const progressFill = document.getElementById('progress-fill');
const phasePillsEl = document.getElementById('phase-pills');
const messages    = document.getElementById('messages');
const typingEl    = document.getElementById('typing');

// ── Phase step definitions ─────────────────────────────────────────────────
// Each step groups related phase names and provides a label + accent colour.

export const STEPS = [
  { label: 'Planning',   phases: ['PLANNING', 'ORCHESTRATING'],          color: 'var(--cp)' },
  { label: 'Researching', phases: ['RESEARCHING', 'SCOPING'],             color: 'var(--cr)' },
  { label: 'Executing',  phases: ['EXECUTION', 'WRITING'],                color: 'var(--ce)' },
  { label: 'Verifying',  phases: ['VERIFYING', 'REVIEWING', 'DEBUGGING'], color: 'var(--cv)' },
  { label: 'Done',       phases: [],                                      color: 'var(--ck)' },
];

// ── Phase colour map ───────────────────────────────────────────────────────
// JS-side mirror of the --cp / --cr / etc. CSS variables.

export const PHASE_COLORS = {
  PLANNING:      'var(--cp)', ORCHESTRATING: 'var(--cp)',
  RESEARCHING:   'var(--cr)', SCOPING:       'var(--cr)',
  EXECUTION:     'var(--ce)', WRITING:       'var(--ce)',
  VERIFYING:     'var(--cv)', REVIEWING:     'var(--cv)',
  DEBUGGING:     'var(--cd)',
};

// ── Default progress percentages per phase ─────────────────────────────────
// Used to jump the progress bar as phases advance.

export const PHASE_PROGRESS = {
  PLANNING: 12, ORCHESTRATING: 18,
  RESEARCHING: 28, SCOPING: 35,
  EXECUTION: 55, WRITING: 60,
  VERIFYING: 78, REVIEWING: 84,
  DEBUGGING: 70,
};

// ── Phase divider metadata ─────────────────────────────────────────────────

export const PM = {
  PLANNING:      { icon: '○', label: 'PLANNING',      color: 'var(--cp)' },
  ORCHESTRATING: { icon: '○', label: 'ORCHESTRATING', color: 'var(--cp)' },
  RESEARCHING:   { icon: '◎', label: 'RESEARCHING',   color: 'var(--cr)' },
  SCOPING:       { icon: '◎', label: 'SCOPING',       color: 'var(--cr)' },
  EXECUTION:     { icon: '▷', label: 'EXECUTING',     color: 'var(--ce)' },
  WRITING:       { icon: '▷', label: 'WRITING',       color: 'var(--ce)' },
  VERIFYING:     { icon: '◇', label: 'VERIFYING',     color: 'var(--cv)' },
  REVIEWING:     { icon: '◇', label: 'REVIEWING',     color: 'var(--cv)' },
  DEBUGGING:     { icon: '△', label: 'DEBUGGING',     color: 'var(--cd)' },
};

// ── Phase elapsed timer ────────────────────────────────────────────────────

let _phaseStartTs = null;
let _phaseTimer   = null;
let _phaseBaseLabel = '';

/**
 * Start the phase elapsed-time ticker.
 * Updates the phase label every second with "· Xs" / "· Xm Xs".
 * Also ticks the live duration on the active phase pill.
 *
 * @param {string} label - The base phase label text (e.g. "Executing…").
 */
export function startPhaseTimer(label) {
  _phaseBaseLabel = label;
  _phaseStartTs   = Date.now();
  clearInterval(_phaseTimer);
  _phaseTimer = setInterval(() => {
    const s = Math.round((Date.now() - _phaseStartTs) / 1000);
    phaseLbl.textContent = _phaseBaseLabel;
    const el = phaseLbl.querySelector('.phase-elapsed') || (() => {
      const e = document.createElement('span');
      e.className = 'phase-elapsed';
      phaseLbl.appendChild(e);
      return e;
    })();
    el.textContent = ' · ' + (s >= 60 ? Math.floor(s / 60) + 'm ' + s % 60 + 's' : s + 's');

    // Tick the live duration on the active phase pill
    const liveDur = phasePillsEl?.querySelector('.pp-live');
    if (liveDur && _stepTimes[currentStepIdx]) {
      liveDur.textContent = _fmtDur(Date.now() - _stepTimes[currentStepIdx].start);
    }
  }, 1000);
}

/**
 * Stop the phase elapsed-time ticker and clear its state.
 */
export function stopPhaseTimer() {
  clearInterval(_phaseTimer);
  _phaseTimer   = null;
  _phaseStartTs = null;
}

// ── Progress bar ───────────────────────────────────────────────────────────

/**
 * Set the progress bar fill to a percentage with an optional colour override.
 *
 * @param {number} pct   - Fill percentage (0–100).
 * @param {string} [color] - CSS colour to override the phase colour.
 */
export function setProgress(pct, color) {
  progressFill.style.width = pct + '%';
  if (color) progressFill.style.background = color;
}

/**
 * Reset the progress bar to 0 immediately (no CSS transition).
 */
export function resetProgress() {
  progressFill.style.transition = 'none';
  progressFill.style.width = '0';
  progressFill.style.background = '';
  requestAnimationFrame(() => { progressFill.style.transition = ''; });
}

// ── Phase stepper ──────────────────────────────────────────────────────────

/**
 * Initialise the hidden #phase-steps stepper DOM nodes.
 * Called once at startup.
 */
(function initPhaseSteps() {
  const c = document.getElementById('phase-steps');
  if (!c) return;
  STEPS.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'phase-step';
    d.id = 'st' + i;
    d.innerHTML = '<div class="sdot" id="sd' + i + '">' + (i + 1) + '</div>'
      + '<div class="slabel">' + s.label + '</div>';
    c.appendChild(d);
    if (i < STEPS.length - 1) {
      const l = document.createElement('div');
      l.className = 'sline';
      l.id = 'sl' + i;
      c.appendChild(l);
    }
  });
})();

/**
 * Map a phase name to its STEPS index.
 *
 * @param {string} p - Phase name (e.g. 'EXECUTION').
 * @returns {number} STEPS index, or -1 if not found.
 */
export function phaseToStep(p) {
  for (let i = 0; i < STEPS.length; i++) {
    if (STEPS[i].phases.includes(p)) return i;
  }
  return -1;
}

/**
 * Apply the active step visual state to the stepper.
 *
 * @param {number} idx   - STEPS index to activate.
 * @param {boolean} [isDbg] - True when in DEBUGGING phase (uses debug colour).
 */
export function setStep(idx, isDbg) {
  if (idx === currentStepIdx && !isDbg) return;
  setCurrentStepIdx(idx);
  STEPS.forEach((_, i) => {
    const se = document.getElementById('st' + i);
    const de = document.getElementById('sd' + i);
    const le = document.getElementById('sl' + i);
    if (i < idx) {
      se.className = 'phase-step done';
      de.textContent = '✓';
      if (le) le.className = 'sline done';
    } else if (i === idx) {
      const c = isDbg ? 'var(--cd)' : STEPS[i].color;
      se.className = 'phase-step active';
      se.style.setProperty('--sc', c);
      de.textContent = i + 1;
      if (le) le.className = 'sline';
    } else {
      se.className = 'phase-step';
      se.style.removeProperty('--sc');
      de.textContent = i + 1;
      if (le) le.className = 'sline';
    }
  });
}

// ── Phase timeline pills ───────────────────────────────────────────────────

/**
 * Format a duration in milliseconds as a short string ("12s", "1m 3s").
 *
 * @param {number} ms
 * @returns {string}
 */
function _fmtDur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm' + (s % 60 ? (s % 60) + 's' : '');
}

/**
 * Record the start time for a step and close any open predecessor steps.
 * Then re-renders the pills row.
 *
 * @param {number} idx - STEPS index to enter.
 */
export function enterStep(idx) {
  if (idx < 0) return;
  const now = Date.now();
  const times = [..._stepTimes];
  if (!times[idx]) times[idx] = { start: now, end: null };
  // Close any predecessor steps that weren't explicitly ended
  for (let i = 0; i < idx; i++) {
    if (times[i] && times[i].end === null) times[i].end = now;
  }
  setStepTimes(times);
  renderPhasePills();
}

/**
 * Rebuild the phase pills row from current step timing data.
 * Each pill shows: pending → number, active → pulse+label+live-duration,
 * done → checkmark+label+duration.
 */
export function renderPhasePills() {
  if (!phasePillsEl) return;
  phasePillsEl.innerHTML = '';
  phasePillsEl.classList.remove('hidden');

  STEPS.forEach((step, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'pp-sep';
      sep.textContent = '›';
      phasePillsEl.appendChild(sep);
    }
    const t = _stepTimes[i];
    const isActive = i === currentStepIdx;
    const isDone   = t && t.end !== null;

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
      item.innerHTML = '<span class="pp-num">' + (i + 1) + '</span>'
        + '<span class="pp-label">' + step.label + '</span>';
    }
    phasePillsEl.appendChild(item);
  });
}

// ── Phase dividers ─────────────────────────────────────────────────────────

let lastDividerPhase = '';
const seenPhases = new Map(); // phase → count (capped at 3 to reduce noise)

/**
 * Reset divider tracking (called on newChat).
 */
export function resetDividers() {
  lastDividerPhase = '';
  seenPhases.clear();
}

/**
 * Insert a phase section divider into the message feed if the phase has
 * changed and we haven't already inserted too many (max 3 per phase).
 *
 * @param {string} phase - Phase name (e.g. 'EXECUTION').
 */
export function addPhaseDivider(phase) {
  if (phase === lastDividerPhase) return;
  lastDividerPhase = phase;
  const m = PM[phase];
  if (!m) return;

  const n = (seenPhases.get(phase) || 0) + 1;
  seenPhases.set(phase, n);
  if (n > 3) return; // Suppress repeated dividers after 3 occurrences

  const isRepeat = n > 1;
  const d = document.createElement('div');
  d.className = 'pdiv' + (isRepeat ? ' repeat' : '');
  const labelTxt = isRepeat ? m.icon + ' ' + m.label + ' ×' + n : m.icon + ' ' + m.label;
  d.innerHTML = '<div class="pdline"></div>'
    + '<div class="pdlabel" style="color:' + m.color + ';border-color:' + m.color + '33;'
    + 'background:color-mix(in srgb,' + m.color + ' 8%,transparent)">' + labelTxt + '</div>'
    + '<div class="pdline"></div>';

  // Insert before the typing indicator
  messages.insertBefore(d, typingEl);
  if (!window._userScrolled) messages.scrollTop = messages.scrollHeight;
}
