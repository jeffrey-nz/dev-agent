/**
 * state.js — Shared webview state
 *
 * All module-level mutable state lives here. Modules import what they need.
 * This avoids circular dependencies and makes state flow easy to trace.
 *
 * Ownership rules:
 *   - Sessions array + running/active IDs → sessions.js
 *   - Phase/step tracking → phases.js
 *   - Activity strip chip map → activity.js
 *   - Bridge port + poll state → connection.js
 *   - Streaming element → events.js (message_chunk handler)
 */

// ── Parsed init data from the <script id="init-data"> tag ─────────────────
export const _INIT = JSON.parse(document.getElementById('init-data').textContent || '{}');

// ── Session management ─────────────────────────────────────────────────────

/** @type {Array<{id:number, prompt:string, ts:Date, status:string, html:string, notes:Array, tools:number}>} */
export const sessions = [];

/** ID of the session currently displayed in the messages pane. */
export let activeSid = null;

/** ID of the session currently executing (null when idle). */
export let runningSid = null;

/** True while a session is running — prevents switching or starting a new one. */
export let sessionLocked = false;

/** Auto-incrementing session ID counter. */
export let sidSeq = 0;

/** Wall-clock start of the current task run (ms). */
export let _sessionStartTs = null;

/** Set to true when the user clicked Stop — suppresses the done banner on session_end. */
export let _stoppedByUser = false;

/** True when a session ended with an error (prevents false "done" banner). */
export let _hadError = false;

/** Task ID tag from the extension — used to drop stale session_end events. */
export let _activeTaskId = null;

// Setters (used by sessions.js and events.js to mutate state from other modules)

/** @param {number|null} id */
export function setActiveSid(id)       { activeSid = id; }

/** @param {number|null} id */
export function setRunningSid(id)      { runningSid = id; }

/** @param {boolean} v */
export function setSessionLocked(v)    { sessionLocked = v; }

/** @param {number} v */
export function setSidSeq(v)           { sidSeq = v; }

/** @param {number|null} ts */
export function setSessionStartTs(ts)  { _sessionStartTs = ts; }

/** @param {boolean} v */
export function setStoppedByUser(v)    { _stoppedByUser = v; }

/** @param {boolean} v */
export function setHadError(v)         { _hadError = v; }

/** @param {string|null} id */
export function setActiveTaskId(id)    { _activeTaskId = id; }

// ── Phase / step tracking ──────────────────────────────────────────────────

/** Index into STEPS[] for the currently active phase step (-1 = none). */
export let currentStepIdx = -1;

/** Name of the last phase_change event received (e.g. 'EXECUTION'). */
export let lastPhase = '';

/** Current phase name (same as lastPhase; kept separate for clarity). */
export let currentPhase = '';

/** Per-step timing: [{start: ms, end: ms|null}] indexed by STEPS index. */
export let _stepTimes = [];

/** @param {number} v */
export function setCurrentStepIdx(v)  { currentStepIdx = v; }

/** @param {string} v */
export function setLastPhase(v)        { lastPhase = v; }

/** @param {string} v */
export function setCurrentPhase(v)     { currentPhase = v; }

/** @param {Array} v */
export function setStepTimes(v)        { _stepTimes = v; }

// ── Session activity counters ──────────────────────────────────────────────
// Tracked per session run; reset in resetSessionTracking()

/** @type {Array<{path:string, isNew:boolean}>} */
export let _writesThisSession = [];

/** @type {Set<string>} */
export let _readsThisSession = new Set();

/** Number of run-tool calls in the current session. */
export let _runsThisSession = 0;

/** Subtask completion counters. */
export let _subtasksCompleted = 0;

/** Total subtask count for the current session. */
export let _subtasksTotal = 0;

/** Total lines added across all diffs in the current session. */
export let _totalAdded = 0;

/** Total lines removed across all diffs in the current session. */
export let _totalRemoved = 0;

// Setters for session activity
export function setWritesThisSession(v)     { _writesThisSession = v; }
export function setReadsThisSession(v)      { _readsThisSession = v; }
export function setRunsThisSession(v)       { _runsThisSession = v; }
export function setSubtasksCompleted(v)     { _subtasksCompleted = v; }
export function setSubtasksTotal(v)         { _subtasksTotal = v; }
export function setTotalAdded(v)            { _totalAdded = v; }
export function setTotalRemoved(v)          { _totalRemoved = v; }

// ── Activity strip ─────────────────────────────────────────────────────────

/** Maps relPath → {chip: HTMLElement, added: number, removed: number}. */
export const _chipMap = new Map();

/** Count of file chips that didn't fit in the strip (shown as "+N more"). */
export let _hiddenChipsCount = 0;

/** Counter for note chips in the notes drawer. */
export let _notesSeq = 0;

/** @param {number} v */
export function setHiddenChipsCount(v) { _hiddenChipsCount = v; }

/** @param {number} v */
export function setNotesSeq(v)         { _notesSeq = v; }

// ── Connection / bridge ────────────────────────────────────────────────────

/** Bridge HTTP port (default 3333, overridden by bridge_port message). */
export let _bridgePort = (_INIT && _INIT.bridgePort) || 3333;

/** Currently selected provider ID (e.g. 'deepseek'). */
export let _selectedProvider = null;

/** True while the bridge is in the waiting_provider_selection phase. */
export let _inSetupMode = false;

/** List of providers the bridge reports it can set up. */
export let _availableProviders = [];

/** @param {number} v */
export function setBridgePort(v)           { _bridgePort = v; }

/** @param {string|null} v */
export function setSelectedProvider(v)     { _selectedProvider = v; }

/** @param {boolean} v */
export function setInSetupMode(v)          { _inSetupMode = v; }

/** @param {Array} v */
export function setAvailableProviders(v)   { _availableProviders = v; }

// ── Input history ──────────────────────────────────────────────────────────

/** Ring buffer of submitted prompts (most recent first). */
export const _history = [];

/** Current navigation index (-1 = not browsing history). */
export let _histIdx = -1;

/** Saved current input text when entering history browse mode. */
export let _histSaved = '';

/** @param {number} v */
export function setHistIdx(v)     { _histIdx = v; }

/** @param {string} v */
export function setHistSaved(v)   { _histSaved = v; }

// ── Streaming state ────────────────────────────────────────────────────────

/** The in-progress .msg-a element being built from message_chunk events. */
export let _streamingEl = null;

/** Accumulated text chunks for the current streaming response. */
export let _streamingBuf = '';

/** @param {HTMLElement|null} v */
export function setStreamingEl(v)  { _streamingEl = v; }

/** @param {string} v */
export function setStreamingBuf(v) { _streamingBuf = v; }

// ── Pending images (attachments) ──────────────────────────────────────────

/** @type {Array<{data:string, mimeType:string, name:string}>} */
export let _pendingImages = [];

/** @param {Array} v */
export function setPendingImages(v) { _pendingImages = v; }

// ── Scroll state ──────────────────────────────────────────────────────────

/** True when the user has manually scrolled up (suppresses auto-scroll). */
export let _userScrolled = false;

/** @param {boolean} v */
export function setUserScrolled(v) { _userScrolled = v; }

// ── Debug log ─────────────────────────────────────────────────────────────

/** Ring buffer of debug log entries (max MAX_DEBUG_LOG entries). */
export const _debugLog = [];

/** Maximum size of the debug ring buffer. */
export const MAX_DEBUG_LOG = 120;
