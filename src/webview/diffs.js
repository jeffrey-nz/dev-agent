/**
 * diffs.js — File diff rendering
 *
 * Handles the `file_diff` event by creating a collapsible diff card
 * (`.diff-card`) and inserting it into the message feed.
 *
 * Exports:
 *   langColor(ext)    — returns a hex colour for a file extension
 *   addFileDiff(data) — creates + returns a diff card element
 *
 * The card is returned so callers (activity.js, events.js) can pass it
 * to addActivityChip() to wire up the scroll-to-card behaviour.
 */

/**
 * Map of file extension → language colour (hex).
 * Used for the coloured dot in diff card headers and activity strip chips.
 *
 * @param {string} ext - File extension without the leading dot.
 * @returns {string} Hex colour string, or '#888' for unknown extensions.
 */
export function langColor(ext) {
  const m = {
    js: '#f7c948', ts: '#3178c6', tsx: '#61dafb', jsx: '#61dafb',
    py: '#3776ab', json: '#f97316', css: '#264de4', scss: '#cf649a',
    html: '#e34f26', md: '#888', sh: '#89e051', go: '#00add8',
    rs: '#dea584', java: '#f89820', cpp: '#f34b7d', c: '#aaa',
  };
  return m[(ext || '').toLowerCase()] || '#888';
}

/**
 * Escape HTML special characters.
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build and return a `.diff-card` element for the given file diff data.
 *
 * The card is initially open if there are actual line changes, closed if
 * the file was touched but no lines changed.
 *
 * @param {object} data - Diff data from the `file_diff` event.
 * @param {string}  data.relPath   - Relative file path (e.g. "src/foo.ts").
 * @param {string}  [data.ext]     - File extension without dot.
 * @param {string}  [data.filePath] - Absolute path for the "open in editor" button.
 * @param {boolean} [data.isNew]   - True if this is a new file.
 * @param {number}  [data.added]   - Lines added.
 * @param {number}  [data.removed] - Lines removed.
 * @param {Array}   [data.hunks]   - Array of diff hunks (arrays of line objects).
 * @returns {HTMLElement} The `.diff-card` div.
 */
export function addFileDiff(data) {
  const isNew = data.isNew;
  const ext   = data.ext || '';
  const rel   = data.relPath || '';

  // Split rel path into directory + filename
  const slash = rel.lastIndexOf('/');
  const fname = slash >= 0 ? rel.slice(slash + 1) : rel;
  const fdir  = slash >= 0 ? rel.slice(0, slash + 1) : '';

  const addTxt = data.added   ? `<span class="ds-add">+${data.added}</span>` : '';
  const remTxt = data.removed ? `<span class="ds-rem">-${data.removed}</span>` : '';
  const badge  = isNew ? `<span class="diff-badge new">new</span>` : '';

  // ── Build diff body HTML ───────────────────────────────────────────────
  let bodyHtml = '';
  (data.hunks || []).forEach((hunk, hi) => {
    if (hi > 0) bodyHtml += `<div class="diff-hunk-sep">···</div>`;
    for (const line of hunk) {
      const cls   = line.t === 'a' ? 'add' : line.t === 'r' ? 'rem' : 'ctx';
      const sym   = line.t === 'a' ? '+'  : line.t === 'r' ? '−'  : ' ';
      // Old line number shown for removals/context; new line number for additions/context
      const oldLn = (line.t === 'r' || line.t === 'c') ? (line.o || '') : '';
      const newLn = (line.t === 'a' || line.t === 'c') ? (line.n || '') : '';
      bodyHtml += `<div class="dl ${cls}">`
        + `<span class="dl-lo">${oldLn}</span>`
        + `<span class="dl-ln">${newLn}</span>`
        + `<span class="dl-sym">${sym}</span>`
        + `<span class="dl-code">${esc(line.s ?? '')}</span>`
        + `</div>`;
    }
  });

  // Fallback when no hunk data is provided
  if (!bodyHtml) {
    bodyHtml = `<div class="dl ctx">`
      + `<span class="dl-lo"></span><span class="dl-ln"></span><span class="dl-sym"> </span>`
      + `<span class="dl-code" style="font-style:italic;opacity:.5">no changes detected</span>`
      + `</div>`;
  }

  // "↗ Open in editor" button — only shown if we have an absolute path
  const openBtn = data.filePath
    ? `<button class="diff-open" title="Open in editor" onclick="event.stopPropagation();openFile(this.dataset.fp)" data-fp="${esc(data.filePath)}">↗</button>`
    : '';

  // Auto-open (expand) only when there are actual line changes
  const hasChanges = (data.added || 0) + (data.removed || 0) > 0 || data.isNew;

  // ── Assemble card DOM ─────────────────────────────────────────────────
  const d = document.createElement('div');
  d.className = 'diff-card' + (hasChanges ? ' open' : '');
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

  // Toggle open/closed on header click
  d.querySelector('.diff-hdr').addEventListener('click', () => d.classList.toggle('open'));

  return d;
}
