/**
 * tools.js — Tool card rendering and read-group batching
 *
 * Handles the inline tool activity shown in the message feed during a run.
 *
 * Design:
 *   - Write/run tools each get their own card immediately.
 *   - Read tools are buffered into `readBuf` and flushed as a group
 *     when the next non-read tool arrives (or at session end).
 *   - A single read becomes a plain `.tcrd` row.
 *   - Multiple reads collapse into a `.rg-card` group.
 *
 * Exports:
 *   toolStyle(name)          — classify a tool name, returns {icon, color, label}
 *   addToolCard(name, summary) — add a pending tool card
 *   resolveCard(isErr, elapsed) — resolve the last pending card (✓ or ✗)
 *   flushReads()              — flush the read buffer to the message feed
 */

/**
 * Escape HTML special characters.
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Insert-before-typing helper (defined in index.js via window). */
function ibt(el) { window._ibt?.(el); }

// ── Tool classification ────────────────────────────────────────────────────

/**
 * Classify a tool name into a visual style category (read / write / run).
 *
 * @param {string} name - Tool function name (e.g. "readFile", "bash").
 * @returns {{ icon: string, color: string, label: 'read'|'write'|'run'|'tool' }}
 */
export function toolStyle(name) {
  const t = (name || '').toLowerCase();
  if (/read|list|search|glob|get|find|cat|view|ls/.test(t))
    return { icon: '📖', color: 'var(--cr)', label: 'read' };
  if (/write|creat|patch|edit|updat|delet|remov|modif|apply|put/.test(t))
    return { icon: '✏️', color: 'var(--ce)', label: 'write' };
  if (/run|exec|bash|shell|command|cmd|spawn|npm|test/.test(t))
    return { icon: '⚡', color: 'var(--cv)', label: 'run' };
  return { icon: '🔧', color: '#888', label: 'tool' };
}

// ── Read buffer ────────────────────────────────────────────────────────────

/** Buffered read-tool calls, flushed as a group when a non-read tool arrives. */
export let readBuf = [];

/** The most-recently-created pending tool card (null if none). */
export let pendingCard = null;

/**
 * Flush the current read buffer to the message feed.
 * One read → single .tcrd row.
 * Multiple reads → collapsible .rg-card group.
 */
export function flushReads() {
  if (!readBuf.length) return;

  if (readBuf.length === 1) {
    const c = document.createElement('div');
    c.className = 'tcrd done';
    c.innerHTML = '<span class="tc-pfx">↳</span><span class="tc-name">read</span>'
      + '<span class="tc-file">' + esc((readBuf[0].s || readBuf[0].n).slice(0, 80)) + '</span>'
      + '<span class="tc-st">✓</span>';
    ibt(c);
  } else {
    const g = document.createElement('div');
    g.className = 'rg-card';
    const items = readBuf
      .map(r => '<div class="rg-item">' + esc((r.s || r.n).slice(0, 70)) + '</div>')
      .join('');
    g.innerHTML = '<div class="rg-hdr" onclick="this.parentElement.classList.toggle(\'open\')">'
      + '<span class="tc-pfx">↳</span><span class="tc-name">read</span>'
      + '<span class="tc-file">' + readBuf.length + ' files</span>'
      + '<span class="rg-caret">▾</span></div>'
      + '<div class="rg-list">' + items + '</div>';
    ibt(g);
  }
  readBuf = [];
}

/**
 * Add a pending tool card to the message feed (write / run / generic tool).
 * Flushes any buffered reads first.
 *
 * @param {string} name    - Tool function name.
 * @param {string} summary - Short description of what the tool is doing.
 */
export function addToolCard(name, summary) {
  flushReads();
  const s = toolStyle(name);
  const c = document.createElement('div');
  c.className = 'tcrd pending ' + s.label;
  c.innerHTML = '<span class="tc-pfx">↳</span><span class="tc-name">' + s.label + '</span>'
    + '<span class="tc-file">' + esc(summary ? summary.slice(0, 80) : name) + '</span>'
    + '<span class="tc-st">—</span>';
  ibt(c);
  pendingCard = c;
}

/**
 * Resolve the last pending tool card as success or failure.
 * Optionally appends an elapsed time when the tool was slow (> 800ms).
 *
 * @param {boolean} isErr    - True if the tool call resulted in an error.
 * @param {number}  elapsed  - Tool execution time in milliseconds.
 */
export function resolveCard(isErr, elapsed) {
  if (!pendingCard) return;
  pendingCard.classList.remove('pending');
  if (isErr) pendingCard.classList.add('error');

  const stEl = pendingCard.querySelector('.tc-st');
  const mark = isErr ? '✗' : '✓';
  // Show elapsed time for slow tools (> 800ms) to help identify bottlenecks
  const elapsedStr = (!isErr && elapsed > 800)
    ? (' ' + (elapsed >= 1000 ? (elapsed / 1000).toFixed(1) + 's' : elapsed + 'ms'))
    : '';
  if (stEl) stEl.textContent = mark + elapsedStr;
  pendingCard = null;
}
