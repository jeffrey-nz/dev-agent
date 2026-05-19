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
  // Browser/visual tools
  if (/screenshot|inspect_page|start_dev|stop_dev|list_dev|get_dev_server|evaluate_js|click_element|wait_for_selector/.test(t))
    return { icon: '🌐', color: 'var(--cp)', label: 'browser' };
  // Git tools
  if (/^git_/.test(t))
    return { icon: '⑂', color: '#6a737d', label: 'git' };
  // HTTP request
  if (/http_request/.test(t))
    return { icon: '🔗', color: 'var(--cr)', label: 'http' };
  // Memory tools
  if (/memory_/.test(t))
    return { icon: '💾', color: '#888', label: 'memory' };
  // Read operations
  if (/read|list|search|glob|get|find|cat|view|ls|grep|outline/.test(t))
    return { icon: '📖', color: 'var(--cr)', label: 'read' };
  // Write operations
  if (/write|creat|patch|edit|updat|delet|remov|modif|apply|put|revert|move/.test(t))
    return { icon: '✏️', color: 'var(--ce)', label: 'write' };
  // Shell / run
  if (/run|exec|bash|shell|command|cmd|spawn|npm|test|composer|phpunit|lint/.test(t))
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
    const raw = (readBuf[0].s || readBuf[0].n);
    const fp  = raw.split('\n')[0].trim();
    const fname = fp.includes('/') ? fp.split('/').pop().slice(0, 60) : fp.slice(0, 80);
    const c = document.createElement('div');
    c.className = 'tcrd done';
    c.innerHTML = '<span class="tc-pfx">↳</span><span class="tc-name">read</span>'
      + '<span class="tc-file" title="' + esc(fp) + '">' + esc(fname) + '</span>'
      + '<span class="tc-st">✓</span>';
    if (fp) {
      c.style.cursor = 'pointer';
      c.addEventListener('click', () => window.openFile?.(fp));
    }
    ibt(c);
  } else {
    // Multi-read: show just the filenames; each item is clickable
    const g = document.createElement('div');
    g.className = 'rg-card';
    const hdr = document.createElement('div');
    hdr.className = 'rg-hdr';
    hdr.innerHTML = '<span class="tc-pfx">↳</span><span class="tc-name">read</span>'
      + '<span class="tc-file">' + readBuf.length + ' files</span>'
      + '<span class="rg-caret">▾</span>';
    hdr.addEventListener('click', () => g.classList.toggle('open'));
    const list = document.createElement('div');
    list.className = 'rg-list';
    readBuf.forEach(r => {
      const raw   = (r.s || r.n).split('\n')[0];
      const fname = raw.includes('/') ? raw.split('/').pop() : raw;
      const item  = document.createElement('div');
      item.className = 'rg-item';
      item.title = raw;
      item.textContent = fname.slice(0, 60);
      if (raw) { item.style.cursor = 'pointer'; item.addEventListener('click', e => { e.stopPropagation(); window.openFile?.(raw); }); }
      list.appendChild(item);
    });
    g.appendChild(hdr);
    g.appendChild(list);
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

  // Show just the filename part of the summary for better readability
  const rawSummary = summary || name;
  const displaySummary = rawSummary.includes('/')
    ? rawSummary.split('/').pop().split('\n')[0].slice(0, 60) || rawSummary.slice(0, 80)
    : rawSummary.slice(0, 80);

  c.innerHTML = '<span class="tc-pfx">↳</span><span class="tc-name">' + s.label + '</span>'
    + '<span class="tc-file" title="' + esc(rawSummary.split('\n')[0].slice(0, 120)) + '">'
    + esc(displaySummary)
    + '</span>'
    + '<span class="tc-st">—</span>';

  // Write tool cards are clickable to open the file in the editor
  if (s.label === 'write' && summary) {
    const fp = summary.split('\n')[0].trim();
    if (fp) {
      c.style.cursor = 'pointer';
      c.title = 'Open ' + fp;
      c.addEventListener('click', () => window.openFile?.(fp));
    }
  }

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
export function resolveCard(isErr, elapsed, errorMsg) {
  if (!pendingCard) return;
  pendingCard.classList.remove('pending');
  if (isErr) {
    pendingCard.classList.add('error');
    if (errorMsg) pendingCard.title = errorMsg.slice(0, 200);
  }

  const stEl = pendingCard.querySelector('.tc-st');
  const mark = isErr ? '✗' : '✓';
  // Show elapsed time for slow tools (> 800ms) to help identify bottlenecks
  const elapsedStr = (!isErr && elapsed > 800)
    ? (' ' + (elapsed >= 1000 ? (elapsed / 1000).toFixed(1) + 's' : elapsed + 'ms'))
    : '';
  if (stEl) stEl.textContent = mark + elapsedStr;
  pendingCard = null;
}
