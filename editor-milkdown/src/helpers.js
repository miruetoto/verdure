// Pure markdown ⇄ model helpers shared with the app's popup editors.
// Ported verbatim from the CodeMirror bundle (same behavior, same edge cases).

/* GFM pipe table ⇄ {header[], aligns[], rows[][]} */
export function parseTable(src) {
  const lines = src.trim().split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return null;
  const splitRow = (l) => l.trim().replace(/^\|/, "").replace(/\|\s*$/, "")
    .split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
  const header = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map((s) => {
    const L = s.startsWith(":"), R = s.endsWith(":");
    return L && R ? "center" : R ? "right" : L ? "left" : null;
  });
  return { header, aligns, rows: lines.slice(2).map(splitRow) };
}
export function serializeTable(m) {
  const esc = (c) => String(c ?? "").replace(/\n/g, " ").replace(/\|/g, "\\|");
  const cols = Math.max(m.header.length, m.aligns.length, ...m.rows.map((r) => r.length), 1);
  const norm = (r) => { const o = [...r]; while (o.length < cols) o.push(""); return o.slice(0, cols); };
  const header = norm(m.header), rows = m.rows.map(norm);
  const aligns = (() => { const a = [...m.aligns]; while (a.length < cols) a.push(null); return a.slice(0, cols); })();
  const w = header.map((h, i) => Math.max(3, esc(h).length, ...rows.map((r) => esc(r[i]).length)));
  const pad = (s, i) => esc(s) + " ".repeat(Math.max(0, w[i] - esc(s).length));
  const line = (r) => "| " + r.map((c, i) => pad(c, i)).join(" | ") + " |";
  const dash = (a, i) => {
    const n = Math.max(3, w[i]);
    if (a === "center") return ":" + "-".repeat(Math.max(1, n - 2)) + ":";
    if (a === "right") return "-".repeat(Math.max(2, n - 1)) + ":";
    if (a === "left") return ":" + "-".repeat(Math.max(2, n - 1));
    return "-".repeat(n);
  };
  return [line(header), "|" + aligns.map((a, i) => " " + dash(a, i) + " ").join("|") + "|", ...rows.map(line)].join("\n");
}

/* ::: {.callout-*} ⇄ {type, title, body} */
export function parseCallout(src) {
  const lines = src.split("\n");
  const head = lines[0] || "";
  const type = (/\.callout-([A-Za-z]+)/.exec(head) || [])[1] || "note";
  const title = (/title\s*=\s*["']([^"']*)["']/.exec(head) || [])[1] || "";
  let end = lines.length - 1;
  while (end > 0 && !/^:{3,}\s*$/.test(lines[end])) end--;
  const body = lines.slice(1, end).join("\n").replace(/^\n+|\n+$/g, "");
  return { type, title, body };
}
export function serializeCallout(m) {
  const type = m.type || "note";
  const t = (m.title || "").trim();
  const head = "::: {.callout-" + type + (t ? ' title="' + t.replace(/"/g, "'") + '"' : "") + "}";
  const body = (m.body || "").replace(/\s+$/, "");
  return head + "\n" + (body ? body + "\n" : "") + ":::";
}

/* ::: {.panel-tabset} ⇄ {level, tabs:[{title, body}]} */
export function parseTabset(src) {
  const lines = src.split("\n");
  let depth = 0, level = 7;
  for (let i = 1; i < lines.length - 1; i++) {
    const l = lines[i];
    if (/^:{3,}\s*\{.+?\}\s*$/.test(l)) { depth++; continue; }
    if (/^:{3,}\s*$/.test(l)) { if (depth > 0) depth--; continue; }
    if (depth === 0) { const h = l.match(/^(#{1,6})\s+/); if (h) level = Math.min(level, h[1].length); }
  }
  if (level === 7) level = 2;
  const tabs = []; let cur = null; depth = 0;
  for (let i = 1; i < lines.length - 1; i++) {
    const l = lines[i];
    const isOpen = /^:{3,}\s*\{.+?\}\s*$/.test(l), isClose = /^:{3,}\s*$/.test(l);
    if (depth === 0 && !isOpen) {
      const h = l.match(/^(#{1,6})\s+(.*)$/);
      if (h && h[1].length === level) { cur = { title: h[2].trim(), body: [] }; tabs.push(cur); continue; }
    }
    if (cur) cur.body.push(l);
    if (isOpen) depth++; else if (isClose && depth > 0) depth--;
  }
  for (const t of tabs) {
    while (t.body.length && !t.body[0].trim()) t.body.shift();
    while (t.body.length && !t.body[t.body.length - 1].trim()) t.body.pop();
    t.body = t.body.join("\n");
  }
  return { level, tabs };
}
export function serializeTabset(m) {
  const h = "#".repeat(m.level || 2);
  const parts = ["::: {.panel-tabset}"];
  for (const t of (m.tabs.length ? m.tabs : [{ title: "탭 1", body: "" }])) {
    parts.push(h + " " + ((t.title || "탭").trim()));
    parts.push("");
    if (t.body && t.body.trim()) parts.push(t.body.replace(/\s+$/, ""));
    parts.push("");
  }
  parts.push(":::");
  return parts.join("\n").replace(/\n{3,}/g, "\n\n");
}
