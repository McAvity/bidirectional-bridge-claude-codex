// Minimal line diff for showing a planned change before it is written.

function splitLines(text) {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function unifiedDiff(before, after, path, context = 3) {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if (n === 0 && m === 0) return "";
  if (n * m > 4_000_000) return `--- ${path}\n+++ ${path}\n@@ ${n} lines replaced by ${m} lines @@\n`;

  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = a.slice(0, start).map((text) => ({ type: " ", text }));
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      ops.push({ type: " ", text: midA[i] });
      i += 1;
      j += 1;
    } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      ops.push({ type: "+", text: midB[j] });
      j += 1;
    } else {
      ops.push({ type: "-", text: midA[i] });
      i += 1;
    }
  }
  for (const text of a.slice(endA)) ops.push({ type: " ", text });

  let lineA = 1;
  let lineB = 1;
  for (const op of ops) {
    op.a = lineA;
    op.b = lineB;
    if (op.type !== "+") lineA += 1;
    if (op.type !== "-") lineB += 1;
  }
  const ranges = [];
  ops.forEach((op, index) => {
    if (op.type === " ") return;
    const from = Math.max(0, index - context);
    const to = Math.min(ops.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else ranges.push({ from, to });
  });
  const out = [`--- ${path}`, `+++ ${path}`];
  for (const { from, to } of ranges) {
    const hunk = ops.slice(from, to + 1);
    const lenA = hunk.filter((op) => op.type !== "+").length;
    const lenB = hunk.filter((op) => op.type !== "-").length;
    const startA = lenA === 0 ? hunk[0].a - 1 : hunk[0].a;
    const startB = lenB === 0 ? hunk[0].b - 1 : hunk[0].b;
    out.push(`@@ -${startA},${lenA} +${startB},${lenB} @@`);
    for (const op of hunk) out.push(`${op.type}${op.text}`);
  }
  return `${out.join("\n")}\n`;
}
