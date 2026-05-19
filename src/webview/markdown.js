/**
 * markdown.js — Markdown renderer
 *
 * Converts a subset of Markdown to HTML for rendering agent messages.
 * Supports: headings, bold, italic, strikethrough, inline code, fenced code
 * blocks, task lists, unordered lists, ordered lists, blockquotes, tables,
 * horizontal rules, and bare URLs.
 *
 * Code blocks are extracted first (to prevent inline rules from matching
 * inside them), replaced with placeholder tokens, and restored at the end.
 *
 * No external dependencies — runs inside the sandboxed webview.
 */

// ── Sentinels to protect code block placeholders from inline transforms ───
const CB_S = '\x02'; // STX — marks start of code-block placeholder index
const CB_E = '\x03'; // ETX — marks end of code-block placeholder index

/**
 * Escape HTML special characters to prevent XSS in rendered content.
 * @param {string} s - Raw string to escape.
 * @returns {string} HTML-safe string.
 */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Render a fenced code block as a styled <div class="cb"> element.
 * The header includes a language label, a line count, and a "Copy" button.
 *
 * @param {string} code - The code text (un-escaped).
 * @param {string} lang - The language hint (e.g. "javascript", "").
 * @returns {string} HTML string for the code block.
 */
function renderCodeBlock(code, lang) {
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const lineCount = code.split('\n').length;
  const linesStr = lineCount > 1 ? lineCount + ' lines' : '';
  return '<div class="cb"><div class="cb-hdr">'
    + (lang ? '<span class="cb-lang">' + esc(lang) + '</span>' : '<span class="cb-lang"></span>')
    + (linesStr ? '<span class="cb-lines">' + linesStr + '</span>' : '')
    + '<button class="cb-copy" onclick="copyCode(this)">Copy</button>'
    + '</div><pre class="cb-pre"><code>' + escaped + '</code></pre></div>';
}

/**
 * Render a buffered set of pipe-delimited table rows as an HTML table.
 * Requires: first row = headers, second row = separator (---), rest = data.
 *
 * @param {string[]} rows - Trimmed table rows (each starts and ends with |).
 * @returns {string} HTML table string, or plain-text fallback.
 */
function _renderTable(rows) {
  const parsed = rows.map(r => r.slice(1, -1).split('|').map(c => c.trim()));
  if (parsed.length < 2) {
    return parsed.map(r => '<div class="md-p">' + r.join(' | ') + '</div>').join('');
  }
  // Second row must be a separator: cells are only dashes and colons
  const isSep = r => r.length > 0 && r.every(c => /^[-: ]+$/.test(c));
  if (!isSep(parsed[1])) {
    return rows.map(r => '<div class="md-p">' + r + '</div>').join('');
  }
  const headers  = parsed[0];
  const dataRows = parsed.slice(2);
  // Note: headers and cells are already HTML-escaped (step 2 ran before table accumulation)
  let html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
  html += headers.map(h => '<th>' + h + '</th>').join('');
  html += '</tr></thead><tbody>';
  dataRows.forEach(row => {
    const cells = headers.map((_, i) => row[i] ?? '');
    html += '<tr>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

/**
 * Render a Markdown string to HTML.
 *
 * The renderer is intentionally simple — it handles the constructs that
 * agent responses actually use and avoids any third-party parser dependency.
 *
 * @param {string} md - Raw Markdown text.
 * @returns {string} Rendered HTML string.
 */
export function renderMarkdown(md) {
  if (!md) return '';

  // ── Step 1: Extract fenced code blocks ───────────────────────────────
  // Replace ```lang\ncode\n``` with a placeholder token so inline rules
  // can't accidentally match inside code content.
  const blocks = [];
  let text = md.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const key = CB_S + blocks.length + CB_E;
    blocks.push({ lang: lang.trim(), code: code.replace(/\n$/, '') });
    return key;
  });

  // ── Step 2: Escape HTML in remaining text ─────────────────────────────
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ── Step 3: Inline transforms ──────────────────────────────────────────
  text = text
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g,     '<em>$1</em>')
    .replace(/~~([^~\n]+)~~/g,     '<s class="md-s">$1</s>')
    .replace(/`([^`]+)`/g,         '<code class="ic">$1</code>')
    // Bare URLs: only http/https (no arbitrary schemes to prevent injection)
    .replace(/(https?:\/\/[^\s<>"]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="md-a">$1</a>');

  // ── Step 4: Block-level rendering ─────────────────────────────────────
  const lines = text.split('\n');
  const out = [];
  let inList  = null; // 'ul' | 'ol' | 'task' | null
  let inBq    = false;
  let tableRows = []; // accumulated pipe-table rows

  const closeList  = () => {
    if (inList) { out.push('</' + (inList === 'task' ? 'ul' : inList) + '>'); inList = null; }
  };
  const closeBq    = () => {
    if (inBq) { out.push('</blockquote>'); inBq = false; }
  };
  const closeTable = () => {
    if (tableRows.length) { out.push(_renderTable(tableRows)); tableRows = []; }
  };

  for (const line of lines) {
    // Code-block placeholder — pass through unchanged
    if (line.includes(CB_S)) { closeBq(); closeList(); closeTable(); out.push(line); continue; }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      closeBq(); closeList(); closeTable();
      out.push('<hr class="md-hr"/>'); continue;
    }

    // Pipe table row: starts AND ends with | after trim
    const tline = line.trim();
    if (tline.length > 2 && tline.startsWith('|') && tline.endsWith('|')) {
      closeBq(); closeList();
      tableRows.push(tline);
      continue;
    } else if (tableRows.length) {
      closeTable();
    }

    // Heading
    const hm = line.match(/^(#{1,3}) (.+)/);
    // Task list item (must be checked BEFORE regular ul)
    const taskm = line.match(/^[-*] \[([xX ])\] (.+)/);
    // Regular unordered list (only if not a task item)
    const ulm = !taskm && line.match(/^[-*] (.+)/);
    // Ordered list
    const olm = line.match(/^\d+\. (.+)/);
    // Blockquote (escaped > from step 2)
    const bqm = line.match(/^&gt; ?(.*)/);

    if (hm) {
      closeBq(); closeList();
      const lv = hm[1].length;
      out.push('<h' + lv + ' class="md-h">' + hm[2] + '</h' + lv + '>');
    } else if (bqm) {
      closeList();
      if (!inBq) { out.push('<blockquote class="md-bq">'); inBq = true; }
      out.push('<div class="md-p">' + bqm[1] + '</div>');
    } else if (taskm) {
      closeBq();
      if (inList !== 'task') { closeList(); out.push('<ul class="task-list">'); inList = 'task'; }
      const checked = taskm[1].toLowerCase() === 'x';
      out.push('<li class="task-item">'
        + '<span class="md-cb' + (checked ? ' checked' : '') + '">'
        + (checked ? '✓' : '○') + '</span>'
        + taskm[2]
        + '</li>');
    } else if (ulm) {
      closeBq();
      if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
      out.push('<li>' + ulm[1] + '</li>');
    } else if (olm) {
      closeBq();
      if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; }
      out.push('<li>' + olm[1] + '</li>');
    } else if (!line.trim()) {
      closeBq(); closeList(); out.push('<div class="md-br"></div>');
    } else {
      closeBq(); closeList(); out.push('<div class="md-p">' + line + '</div>');
    }
  }

  closeBq(); closeList(); closeTable();
  text = out.join('');

  // ── Step 5: Restore code blocks ────────────────────────────────────────
  blocks.forEach((b, i) => {
    text = text.replace(CB_S + i + CB_E, renderCodeBlock(b.code, b.lang));
  });

  return text;
}

/**
 * Try to extract readable text from a raw agent response that may be JSON.
 *
 * The pipeline occasionally returns JSON objects instead of plain text.
 * This function tries known field names in priority order and falls back
 * to pretty-printed fenced JSON if nothing matches.
 *
 * @param {string} raw - Raw agent response text.
 * @returns {string} Human-readable text.
 */
export function extractAgentText(raw) {
  const s = (raw || '').trim();
  if (!s.startsWith('{') && !s.startsWith('[')) return raw;
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      const strs = parsed.filter(x => typeof x === 'string');
      return strs.length ? strs.join('\n\n') : raw;
    }
    if (typeof parsed !== 'object' || parsed === null) return raw;

    // Priority-ordered fields that typically hold the human-readable content
    const FIELDS = [
      'plan', 'review', 'content', 'text', 'message', 'response',
      'analysis', 'summary', 'result', 'description', 'output',
      'reasoning', 'explanation', 'answer', 'feedback',
    ];
    for (const f of FIELDS) {
      const v = parsed[f];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }

    // Multi-field: goal + steps
    const parts = [];
    if (typeof parsed.goal === 'string') parts.push(parsed.goal);
    if (typeof parsed.objective === 'string') parts.push(parsed.objective);
    if (Array.isArray(parsed.steps)) {
      parts.push(parsed.steps.map((st, i) =>
        (i + 1) + '. ' + (typeof st === 'string' ? st : (st.description || JSON.stringify(st)))
      ).join('\n'));
    }
    if (parts.length) return parts.join('\n\n');

    // Last resort: render as fenced JSON
    return '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
  } catch { return raw; }
}
