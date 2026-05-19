/**
 * export.js — Session export, debug snapshot, clipboard helpers
 *
 * Exports:
 *   exportSession()    — copy the current session as Markdown to the clipboard
 *   debugSnapshot()    — send DOM + state to the extension for diagnostics
 *   copyMsg(btn)       — copy an agent message's text (called from HTML onclick)
 *   copyCode(btn)      — copy a code block's text (called from HTML onclick)
 *   clipboardWrite(text) — write to clipboard, falling back to execCommand
 */

import { _debugLog } from './state.js';
import { showToast } from './toast.js';

// ── Element refs ───────────────────────────────────────────────────────────
const messages  = document.getElementById('messages');
const typingEl  = document.getElementById('typing');
const welcomeEl = document.getElementById('welcome');

// vscode API (acquired in index.js)
const vscode = window._vscode;

// ── Clipboard helpers ──────────────────────────────────────────────────────

/**
 * Write text to the clipboard.
 * Uses the Clipboard API if available; falls back to a hidden textarea +
 * execCommand('copy') for environments without clipboard API access.
 *
 * @param {string} text - The text to copy.
 * @returns {Promise<void>}
 */
export function clipboardWrite(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = Object.assign(document.createElement('textarea'), {
    value: text, style: 'position:fixed;opacity:0',
  });
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}

/**
 * Copy the text of an agent message to the clipboard.
 * Shows a brief "✓" confirmation on the button.
 *
 * Called directly from HTML: `onclick="copyMsg(this)"`
 *
 * @param {HTMLElement} btn - The clicked copy button inside a `.msg-a` element.
 */
export function copyMsg(btn) {
  const text = btn.closest('.msg-a').querySelector('.mab-md').innerText;
  clipboardWrite(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

/**
 * Copy the content of a code block to the clipboard.
 * Shows a brief "✓ Copied" confirmation on the button.
 *
 * Called directly from HTML: `onclick="copyCode(this)"`
 *
 * @param {HTMLElement} btn - The clicked Copy button inside a `.cb` element.
 */
export function copyCode(btn) {
  const code = btn.closest('.cb').querySelector('pre code').textContent;
  clipboardWrite(code).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = orig; }, 1500);
    showToast('Code copied', 'ok', 1800);
  });
}

// ── Session export ─────────────────────────────────────────────────────────

/**
 * Export the current session as a Markdown string and copy it to the clipboard.
 * Walks the message feed and formats each node type appropriately.
 * Shows a brief "✓ Copied" confirmation on the Export button.
 */
export function exportSession() {
  window._closeDropdowns?.();

  const lines = [];
  for (const node of messages.children) {
    if (node === typingEl || node === welcomeEl) continue;

    if (node.classList.contains('msg-u')) {
      lines.push('**You**\n' + (node.querySelector('.msg-body')?.textContent || '').trim());
    } else if (node.classList.contains('msg-a')) {
      lines.push('**Dev Agent**\n' + (node.querySelector('.mab-md')?.innerText || '').trim());
    } else if (node.classList.contains('diff-card')) {
      const dir   = node.querySelector('.diff-fdir')?.textContent || '';
      const fname = node.querySelector('.diff-fname')?.textContent || '';
      const st    = node.querySelector('.diff-stats')?.textContent || '';
      lines.push('`' + dir + fname + '`' + (st ? '  ' + st : ''));
    } else if (node.classList.contains('sc-card')) {
      const label = node.querySelector('.sc-label')?.textContent || 'Plan';
      const body  = node.querySelector('.sc-body')?.innerText || '';
      if (body.trim()) lines.push('**' + label + '**\n' + body.trim());
    } else if (node.classList.contains('run-output') || node.classList.contains('run-output-wrap')) {
      const t = (node.classList.contains('run-output-wrap')
        ? node.querySelector('.run-output')?.textContent
        : node.textContent)?.trim();
      if (t) lines.push('```\n' + t + '\n```');
    } else if (node.classList.contains('subtask-chip')) {
      const num = node.querySelector('.stc-num')?.textContent || '';
      const lbl = node.querySelector('.stc-label')?.textContent || '';
      if (lbl) lines.push('**Subtask ' + num + ':** ' + lbl);
    } else if (node.classList.contains('retry-notice')) {
      const t = node.textContent?.trim().replace(/\s+/g, ' ');
      if (t) lines.push('> ↺ ' + t);
    } else if (node.classList.contains('msg-ok') || node.classList.contains('msg-sys')) {
      const t = node.textContent?.trim();
      if (t) lines.push('> ' + t);
    } else if (node.classList.contains('msg-warn')) {
      const t = node.textContent?.trim();
      if (t) lines.push('> ⚠ ' + t);
    } else if (node.classList.contains('done-banner') || node.classList.contains('stop-banner')) {
      lines.push('---\n' + (node.querySelector('span')?.textContent || '').trim());
    } else if (node.classList.contains('changes-card')) {
      const items = Array.from(node.querySelectorAll('.change-item .change-path'))
        .map(e => e.textContent.trim());
      if (items.length) lines.push('**Files changed:** ' + items.join(', '));
    }
  }

  const text = lines.join('\n\n');
  clipboardWrite(text).then(() => {
    const btn = document.getElementById('btn-export');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Copied';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }
    showToast('Session transcript copied (' + lines.length + ' entries)', 'ok', 2500);
  });
}

// ── Debug snapshot ─────────────────────────────────────────────────────────

/**
 * Capture the current UI state and send it to the extension for diagnostics.
 * The extension can save the snapshot to a file or display it in the output panel.
 */
export function debugSnapshot() {
  const scrChat     = document.getElementById('scr-chat');
  const scrConnect  = document.getElementById('scr-connect');
  const scrProvider = document.getElementById('scr-provider');
  const scrConfirm  = document.getElementById('scr-confirm');
  const scrProject  = document.getElementById('scr-project');

  const state = {
    ts: new Date().toISOString(),
    screen: (() => {
      if (scrChat     && !scrChat.classList.contains('hidden'))     return 'chat';
      if (scrConnect  && !scrConnect.classList.contains('hidden'))  return 'connect';
      if (scrProvider && !scrProvider.classList.contains('hidden')) return 'provider';
      if (scrConfirm  && !scrConfirm.classList.contains('hidden'))  return 'confirm';
      if (scrProject  && !scrProject.classList.contains('hidden'))  return 'project';
      return 'unknown';
    })(),
    // Pull live state from window-bound accessors set by index.js
    ...window._snapshotState?.(),
    recentLog: _debugLog.slice(-50),
  };

  const html = document.documentElement.outerHTML;
  vscode?.postMessage({ type: 'debug_snapshot', html, state });
  _dlog('debug_snapshot sent');
}

// ── Internal helpers ───────────────────────────────────────────────────────

function _dlog(msg) {
  const ts = new Date().toISOString().slice(11, 23);
  _debugLog.push(`[${ts}] ${msg}`);
  if (_debugLog.length > 120) _debugLog.shift();
}
