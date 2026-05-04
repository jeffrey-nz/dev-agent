"use strict";

/**
 * LCS-based line diff for two arrays of lines.
 * Returns a flat array of {t, s, o, n} objects where:
 *   t: 'c' (context) | 'r' (remove) | 'a' (add)
 *   s: line text
 *   o: old line number (1-indexed, present on 'c' and 'r')
 *   n: new line number (1-indexed, present on 'c' and 'a')
 *
 * Capped at 250 lines each — falls back to block diff for larger sections.
 */
function lcsDiff(A, B, oldOffset, newOffset) {
  const m = A.length, n = B.length;
  if (m === 0 && n === 0) return [];

  if (m > 250 || n > 250) {
    // Block diff: all removes then all adds
    return [
      ...A.map((s, i) => ({ t: "r", s, o: oldOffset + i + 1 })),
      ...B.map((s, i) => ({ t: "a", s, n: newOffset + i + 1 })),
    ];
  }

  const dp = [];
  for (let i = 0; i <= m; i++) dp.push(new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (A[i - 1] === B[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
    }
  }

  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && A[i - 1] === B[j - 1]) {
      result.unshift({ t: "c", s: A[i - 1], o: oldOffset + i, n: newOffset + j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ t: "a", s: B[j - 1], n: newOffset + j });
      j--;
    } else {
      result.unshift({ t: "r", s: A[i - 1], o: oldOffset + i });
      i--;
    }
  }
  return result;
}

/** Split a flat diff into hunks, each surrounded by up to `ctx` context lines. */
function buildHunks(flat, ctx) {
  if (!flat.length) return [];
  const changedIdx = flat.map((l, i) => l.t !== "c" ? i : -1).filter(i => i >= 0);
  if (!changedIdx.length) return [];

  const ranges = [];
  let from = Math.max(0, changedIdx[0] - ctx);
  let to   = Math.min(flat.length - 1, changedIdx[0] + ctx);

  for (let k = 1; k < changedIdx.length; k++) {
    const next = changedIdx[k];
    if (next - ctx <= to + 1) {
      to = Math.min(flat.length - 1, next + ctx);
    } else {
      ranges.push([from, to]);
      from = Math.max(0, next - ctx);
      to   = Math.min(flat.length - 1, next + ctx);
    }
  }
  ranges.push([from, to]);
  return ranges.map(([f, t]) => flat.slice(f, t + 1));
}

/**
 * Compute a structured diff between oldContent and newContent.
 * Returns { relPath, ext, isNew, added, removed, hunks, filePath }.
 */
function computeFileDiff(oldContent, newContent, filePath, relPath, ext) {
  const isNew = oldContent === null || oldContent === undefined;
  const oldLines = isNew ? [] : oldContent.split("\n");
  const newLines = newContent.split("\n");

  let flat;

  if (isNew) {
    const cap = Math.min(newLines.length, 80);
    flat = newLines.slice(0, cap).map((s, i) => ({ t: "a", s, n: i + 1 }));
    if (newLines.length > cap) {
      flat.push({ t: "c", s: `… ${newLines.length - cap} more lines`, n: null });
    }
  } else {
    // Find common prefix
    let pLen = 0;
    while (pLen < oldLines.length && pLen < newLines.length &&
           oldLines[pLen] === newLines[pLen]) pLen++;

    // Find common suffix (not overlapping prefix)
    let sLen = 0;
    const maxSuf = Math.min(oldLines.length - pLen, newLines.length - pLen);
    while (sLen < maxSuf &&
           oldLines[oldLines.length - 1 - sLen] === newLines[newLines.length - 1 - sLen]) sLen++;

    const oldMid = oldLines.slice(pLen, sLen ? oldLines.length - sLen : oldLines.length);
    const newMid = newLines.slice(pLen, sLen ? newLines.length - sLen : newLines.length);

    const prefix = oldLines.slice(0, pLen).map((s, i) => ({ t: "c", s, o: i + 1, n: i + 1 }));
    const mid    = lcsDiff(oldMid, newMid, pLen, pLen);
    const suffix = sLen > 0
      ? oldLines.slice(oldLines.length - sLen).map((s, i) => ({
          t: "c", s,
          o: oldLines.length - sLen + i + 1,
          n: newLines.length - sLen + i + 1,
        }))
      : [];

    flat = [...prefix, ...mid, ...suffix];
  }

  const hunks   = buildHunks(flat, 3);
  const added   = flat.filter(l => l.t === "a").length;
  const removed = flat.filter(l => l.t === "r").length;

  return { relPath, ext, isNew, added, removed, hunks, filePath };
}

module.exports = { computeFileDiff };
