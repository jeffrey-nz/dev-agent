/**
 * toast.js — Transient notification toasts
 *
 * showToast(text, type, duration) displays a brief, non-intrusive overlay
 * at the bottom-right of the panel. Slides in, auto-dismisses.
 *
 * Types: 'info' | 'warn' | 'err' | 'ok'
 * Duration: milliseconds before auto-dismiss (default 3500)
 */

let _wrap = null;

function _getWrap() {
  if (!_wrap) {
    _wrap = document.createElement('div');
    _wrap.id = 'toast-wrap';
    document.body.appendChild(_wrap);
  }
  return _wrap;
}

/**
 * Show a toast notification.
 * @param {string} text
 * @param {'info'|'warn'|'err'|'ok'} [type]
 * @param {number} [duration]
 */
export function showToast(text, type = 'info', duration = 3500) {
  const wrap = _getWrap();
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = text;
  wrap.appendChild(t);
  // Double rAF so the transition fires after the element is painted
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, duration);
}

/**
 * Show a rate-limit toast with an optional retry countdown.
 * @param {number} [retryAfterMs] - Milliseconds until retry is available.
 */
export function showRateLimitToast(retryAfterMs) {
  const wrap = _getWrap();
  const t = document.createElement('div');
  t.className = 'toast toast-warn toast-rate';

  if (retryAfterMs && retryAfterMs > 0) {
    const secs = Math.ceil(retryAfterMs / 1000);
    t.textContent = 'Rate limited — retrying in ' + secs + 's';
    const deadline = Date.now() + retryAfterMs;
    const iv = setInterval(() => {
      const remaining = Math.ceil((deadline - Date.now()) / 1000);
      if (remaining <= 0) {
        clearInterval(iv);
        t.classList.remove('show');
        setTimeout(() => t.remove(), 300);
      } else {
        t.textContent = 'Rate limited — retrying in ' + remaining + 's';
      }
    }, 1000);
    wrap.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  } else {
    t.textContent = 'Rate limited — retrying…';
    wrap.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 5000);
  }
}
