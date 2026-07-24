// Quarto Viewer — CodeMirror 6 live-preview editor (Obsidian-style).
//
// Markdown stays the source of truth; decorations hide syntax markers and
// render elements inline, revealing raw source on the active line/selection.
// Bundled to a single IIFE (global `QVEditor`) so the app stays offline.

import { EditorState, EditorSelection, StateField, StateEffect, Transaction } from "@codemirror/state";
import {
  EditorView, Decoration, WidgetType, keymap, drawSelection,
} from "@codemirror/view";
import {
  syntaxTree, ensureSyntaxTree, HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching,
} from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { GFM } from "@lezer/markdown";
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { tags as t } from "@lezer/highlight";

/* Callbacks are stashed per-view so widgets can reach the host app. */
let HOST = {
  renderBlock: (src) => "<pre>" + src.replace(/[&<]/g, (c) => (c === "&" ? "&amp;" : "&lt;")) + "</pre>",
  resolveAsset: async () => null,
  typeset: async () => {},
  resolveImages: async () => {},
  editTable: null,   // host-provided spreadsheet modal (src, replace) — see index.html
  editTabset: null,  // host-provided tabset popup editor
  editCallout: null, // host-provided callout popup editor (type/title/body)
  editFrontmatter: null, // host-provided front-matter fields popup
  editImage: null,   // host-provided image popup editor (align/size/delete)
  settleCaret: null, // host-provided caret settling across modal focus handoffs
  flash: null,       // host-provided toast (used by the ⧉ copy badge)
};

// Set by create() to a debounced reflow. Inline-math widgets call it after an
// ASYNC MathJax render (first formula, before the library is loaded): the math
// grows past the placeholder height CM measured, but CM won't re-read the line
// height on its own, so the selection/caret for that line would be too short
// and the taller formula pokes out of the selection. A reflow re-reads heights.
let mathReflowHook = null;

/* ------------------------------ widgets ------------------------------ */
// Locate an object's exact source in the document. Prefer the widget's live DOM
// position (disambiguates identical duplicate blocks); fall back to a unique
// whole-document match, which survives the widget being re-rendered/disconnected
// during a popup's focus handoff (WKWebView). Shared by every fixed object.
function findObjRange(view, dom, src) {
  const doc = view.state.doc;
  if (dom && dom.isConnected) {
    const base = view.posAtDOM(dom);
    for (const from of [base, base - 1, base + 1, base - 2, base + 2, base - 3, base + 3]) {
      const to = from + src.length;
      if (from >= 0 && to <= doc.length && doc.sliceString(from, to) === src) return { from, to };
    }
  }
  const text = doc.toString(), idx = text.indexOf(src);
  if (idx >= 0 && text.indexOf(src, idx + 1) === -1) return { from: idx, to: idx + src.length };
  return null;
}
// Delete an object's range, swallowing one trailing blank line so no gap remains.
function removeObjRange(view, dom, src) {
  const rg = findObjRange(view, dom, src); if (!rg) return;
  let to = rg.to, doc = view.state.doc;
  if (doc.sliceString(to, to + 1) === "\n" && doc.sliceString(to + 1, to + 2) === "\n") to += 1;
  else if (doc.sliceString(to, to + 1) === "\n") to += 1;
  view.dispatch({ changes: { from: rg.from, to, insert: "" }, selection: { anchor: rg.from } });
  if (HOST.settleCaret) HOST.settleCaret(rg.from);
}

// Ops for a single image token (![alt](src){width=… fig-align=…}), `raw` = its
// exact source. apply patches attrs, rewrite swaps the whole token (annotated
// copy), remove deletes it — all via the shared robust range finder.
function imageDocOps(view, dom, raw) {
  const m = /^!\[([^\]]*)\]\(([^)]*)\)(?:\{([^}]*)\})?/.exec(raw) || [];
  const alt0 = m[1] || "", src0 = m[2] || "", attrs = m[3] || "";
  const w0 = (/(?:^|\s)width=(\d+%?)/.exec(attrs) || [])[1] || null;
  const a0 = (/fig-align="?(left|center|right)"?/.exec(attrs) || [])[1] || null;
  let used = false;
  // The alt text IS the Quarto figure caption (![Caption](src) renders <figcaption>).
  const build = ({ alt = alt0, src = src0, width, align }) => {
    let t = "![" + alt + "](" + src + ")";
    const parts = [];
    if (width) parts.push("width=" + width);
    if (align) parts.push('fig-align="' + align + '"');
    return parts.length ? t + "{" + parts.join(" ") + "}" : t;
  };
  const write = (tok) => {
    if (used) return;
    const rg = findObjRange(view, dom, raw); if (!rg) return; used = true;
    view.dispatch({ changes: { from: rg.from, to: rg.to, insert: tok } });
    if (HOST.settleCaret) HOST.settleCaret(rg.from + tok.length);
  };
  return {
    apply: (patch) => write(build({
      alt: "caption" in patch ? patch.caption : alt0,
      width: "width" in patch ? patch.width : w0,
      align: "align" in patch ? patch.align : a0,
    })),
    rewrite: ({ src, width, align, caption }) => write(build({ alt: caption != null ? caption : alt0, src, width, align })),
    remove: () => { if (!used) { used = true; removeObjRange(view, dom, raw); } },
  };
}

// Every fixed object (image, table, tabset, …) gets the same hover affordance:
// a little TAB jutting out of the outline's top-right corner (사용자 시안 —
// 파일 폴더 탭처럼) holding copy (⧉, markdown → clipboard) and delete (×).
// The object-specific popup is what differs — copying/deletion are uniform.
function addDeleteBadge(el, onDelete, src) {
  el.classList.add("qv-obj");
  const tray = document.createElement("span");
  tray.className = "qv-badges";
  const btn = (cls, txt, title, fn) => {
    const b = document.createElement("button");
    b.className = cls; b.type = "button"; b.title = title; b.textContent = txt;
    b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    tray.appendChild(b);
  };
  if (src != null) btn("qv-copyx", "⧉", "복사", () => {
    const text = String(src);
    try { navigator.clipboard.writeText(text); } catch (_) {
      const t = document.createElement("textarea");
      t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } catch (_) {}
      t.remove();
    }
    if (HOST.flash) HOST.flash("오브젝트 복사됨 — ⌘V로 붙여넣기");
  });
  btn("qv-delx", "×", "삭제", onDelete);
  el.appendChild(tray);
  // The hover outline WITH its top-right tab is ONE continuous SVG stroke
  // (사용자 시안) — CSS outlines can't grow a bump, and gluing separate boxes
  // always showed seams. And because the tab is attached, the pointer never
  // crosses a dead zone on its way to the buttons (the pill "ran away").
  const svgNS = "http://www.w3.org/2000/svg";
  const ring = document.createElementNS(svgNS, "svg");
  ring.setAttribute("class", "qv-ring");
  const ringPath = document.createElementNS(svgNS, "path");
  ringPath.setAttribute("fill", "none");
  ringPath.setAttribute("stroke", "#ffc9c0");
  ringPath.setAttribute("stroke-width", "2");
  ring.appendChild(ringPath);
  el.appendChild(ring);
  const positionRing = () => {
    const target = (el.classList.contains("qv-math-block") && el.querySelector("mjx-math"))
      || el.querySelector("table, .tabset, .callout, .frontmatter, pre") || el;
    const er = el.getBoundingClientRect(), tr = target.getBoundingClientRect();
    if (!tr.width) return;
    const off = 5, tabH = 26, r = 10, r2 = 8, pad = 2;
    // Rects come back multiplied by the document zoom, but styles we set are
    // in pre-zoom CSS px — divide the measurements or the ring drifts/stretches
    // at any zoom other than 100%.
    const z = parseFloat(getComputedStyle(document.querySelector(".cm-scroller") || el).zoom) || 1;
    const bx = (tr.left - er.left) / z - off, by = (tr.top - er.top) / z - off;
    const bw = tr.width / z + off * 2, bh = tr.height / z + off * 2;
    const trayW = tray.offsetWidth || 48, tabW = trayW + 18;
    ring.style.left = Math.round(bx - pad) + "px";
    ring.style.top = Math.round(by - tabH - pad) + "px";
    ring.setAttribute("width", Math.round(bw + pad * 2));
    ring.setAttribute("height", Math.round(bh + tabH + pad * 2));
    const x0 = pad, y0 = pad, x1 = pad + bw, yT = pad + tabH, y1 = pad + tabH + bh;
    const xb = Math.max(x0 + r + tabW, x1 - 10), xa = xb - tabW;
    ringPath.setAttribute("d",
      `M ${x0 + r} ${yT} L ${xa} ${yT} L ${xa} ${y0 + r2} Q ${xa} ${y0} ${xa + r2} ${y0} `
      + `L ${xb - r2} ${y0} Q ${xb} ${y0} ${xb} ${y0 + r2} L ${xb} ${yT} L ${x1 - r} ${yT} `
      + `Q ${x1} ${yT} ${x1} ${yT + r} L ${x1} ${y1 - r} Q ${x1} ${y1} ${x1 - r} ${y1} `
      + `L ${x0 + r} ${y1} Q ${x0} ${y1} ${x0} ${y1 - r} L ${x0} ${yT + r} Q ${x0} ${yT} ${x0 + r} ${yT}`);
    tray.style.left = Math.round(bx - pad + xa + (tabW - trayW) / 2) + "px";
    tray.style.top = Math.round(by - tabH + (tabH - 20) / 2 + 1) + "px";
  };
  el.addEventListener("mouseenter", positionRing);
  el.addEventListener("toggle", positionRing, true);  // callout fold/unfold resizes the box
}

class ImageWidget extends WidgetType {
  constructor(src, alt, width, align, raw) {
    super(); this.src = src; this.alt = alt; this.width = width || null; this.align = align || null; this.raw = raw || "";
  }
  eq(o) { return o.src === this.src && o.alt === this.alt && o.width === this.width && o.align === this.align; }
  toDOM(view) {
    // The widget's root must stay stable: replacing it (img.replaceWith) mutates
    // the editable DOM outside a transaction, and CM's observer syncs the
    // placeholder text back into the document. So keep a wrapper and only swap
    // an inner box's children on failure.
    const wrap = document.createElement("span");
    wrap.className = "qv-imgwrap" + (this.align ? " qv-align-" + this.align : "");
    const box = document.createElement("span");
    box.className = "qv-imgbox";
    wrap.appendChild(box);
    const img = document.createElement("img");
    img.className = "qv-img";
    img.alt = this.alt || "";
    if (this.width) img.style.width = /%$/.test(this.width) ? this.width : this.width + "px";
    box.appendChild(img);
    const fail = () => { box.textContent = ""; box.appendChild(missing(this.src, this.alt)); };
    if (/^(https?:|data:)/.test(this.src)) img.src = this.src;
    else HOST.resolveAsset(this.src).then((uri) => { if (uri) img.src = uri; else fail(); }).catch(fail);
    img.addEventListener("error", fail);
    const raw = this.raw;
    // Clicking the image opens the popup editor (align / caption / delete).
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault(); e.stopPropagation();
      placeCursor(view, wrap);
      if (!HOST.editImage) return;
      const ops = imageDocOps(view, wrap, raw);
      HOST.editImage(
        { src: this.src, alt: this.alt, width: this.width, align: this.align, preview: img.currentSrc || img.src },
        ops.apply, ops.remove, ops.rewrite);
    });
    // Corner grip: drag to resize live, persisted as a Quarto {width=N} attribute.
    const grip = document.createElement("span");
    grip.className = "qv-img-grip";
    grip.title = "드래그해서 크기 조절";
    box.appendChild(grip);
    grip.addEventListener("mousedown", (e) => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX, startW = img.getBoundingClientRect().width;
      const move = (ev) => { img.style.width = Math.max(40, Math.round(startW + ev.clientX - startX)) + "px"; };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        imageDocOps(view, wrap, raw).apply({ width: Math.round(img.getBoundingClientRect().width) });
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    // The alt text is the Quarto figure caption — show it directly under the image.
    if (this.alt) {
      const cap = document.createElement("span");
      cap.className = "qv-imgcap";
      cap.textContent = this.alt;
      wrap.appendChild(cap);
    }
    addDeleteBadge(box, () => removeObjRange(view, wrap, raw), raw);  // box = image-sized, so × sits on its corner
    return wrap;
  }
  ignoreEvent() { return true; }
}

// Compact stand-in for an inline data: URI (embedded image) on the active
// line — the raw base64 stays in the document, only its display is folded.
class DataUriToken extends WidgetType {
  constructor(len) { super(); this.len = len; }
  eq(o) { return o.len === this.len; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-datauri";
    el.textContent = "🖼 포함된 이미지 · " + Math.max(1, Math.round(this.len * 3 / 4 / 1024)) + "KB";
    return el;
  }
  ignoreEvent() { return false; }
}

class MathWidget extends WidgetType {
  // raw = the exact $$…$$ source (block math only) so the × badge can remove it.
  constructor(tex, display, raw) { super(); this.tex = tex; this.display = display; this.raw = raw || ""; }
  eq(o) { return o.tex === this.tex && o.display === this.display && o.raw === this.raw; }
  toDOM(view) {
    const el = document.createElement(this.display ? "div" : "span");
    // Same classes pandoc emits on the blog, so the blog's math CSS applies.
    el.className = "qv-math " + (this.display ? "math display qv-math-block" : "math inline");
    // Prefer a SYNCHRONOUS render: the widget then has its final width when
    // CodeMirror measures the caret, so the caret sits right after the formula
    // instead of at the wider placeholder position (the "big gap after inline
    // math" bug). Falls back to async (+re-measure) only until MathJax loads.
    // Prefer a synchronous render so the widget has its final width immediately
    // (see typesetSync). The stale-caret-after-doc-change problem is handled
    // globally by the caret-redraw update listener below, not here.
    const sync = HOST.typesetSync && HOST.typesetSync(el, this.tex, this.display);
    if (sync) {
      // Even a synchronous render can settle at a different width than CM's
      // measurement pass sampled (fonts, CHTML stylesheet application). One
      // remeasure on the next frame keeps posAtCoords honest — clicks right
      // of the formula used to land at the END of the line.
      requestAnimationFrame(() => { try { view.requestMeasure(); } catch (_) {} });
    }
    if (!sync) {
      el.textContent = this.display ? `\\[${this.tex}\\]` : `\\(${this.tex}\\)`;
      const remeasure = () => { try { view.requestMeasure(); } catch (_) {} };
      const done = HOST.typeset(el);
      if (done && done.then) done.then(() => {
        remeasure(); requestAnimationFrame(remeasure);
        // The formula just grew past its placeholder height; re-read line
        // heights so the selection/caret cover it (requestMeasure alone won't).
        if (mathReflowHook) mathReflowHook();
      });
    }
    el.addEventListener("mousedown", (e) => { e.preventDefault(); placeCursor(view, el); });
    // Block math: same hover outline + × as the other objects — but NO popup;
    // clicking still reveals the $$…$$ source for in-place editing.
    if (this.display && this.raw) addDeleteBadge(el, () => removeObjRange(view, el, this.raw), this.raw);
    return el;
  }
  ignoreEvent() { return true; }
}

/* ---------------------- in-place table editing ----------------------- */
// GFM pipe-table model: {header[], aligns[], rows[][]} ⇄ markdown text.
function parseTable(src) {
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
function serializeTable(m) {
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
function placeCaretEnd(node) {
  try {
    const r = document.createRange(); r.selectNodeContents(node); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  } catch (_) {}
}

// Make a rendered pipe table editable in place (HWP/Typora-style): cells are
// contenteditable, Tab/Enter move between cells, and a hover toolbar adds or
// removes rows/columns and sets column alignment. Every operation rewrites the
// markdown source, so the document stays plain GFM.
// Tables edit through the host's spreadsheet modal (HOST.editTable): any
// click on the fixed table widget opens it prefilled; "적용" rewrites the
// markdown (preserving an alignment-wrapper div via prefix/suffix lines).
// No in-place cell inputs — a modal never fights CodeMirror or WKWebView
// for focus/selection, which is what made in-place editing so fragile.
function enhanceTableWidget(el, view, widget) {
  const table = el.querySelector("table");
  if (!table || !HOST.editTable) return;
  el.classList.add("qv-hastable");
  const srcLines = widget.src.split("\n");
  let firstPipe = srcLines.findIndex((l) => l.trim().startsWith("|"));
  let lastPipe = srcLines.length - 1;
  while (lastPipe >= 0 && !srcLines[lastPipe].trim().startsWith("|")) lastPipe--;
  if (firstPipe < 0 || lastPipe < firstPipe) return;
  const pipeText = srcLines.slice(firstPipe, lastPipe + 1).join("\n");
  const centered = /^\s*:{3,}\s*\{[^}]*\.center/.test(widget.src);
  if (centered) el.classList.add("qv-tbl-center");
  else if (/^\s*:{3,}\s*\{[^}]*\.right/.test(widget.src)) el.classList.add("qv-tbl-right");
  // Pandoc table caption (": Caption") anywhere outside the pipe rows.
  let caption = "";
  for (const l of srcLines) { const m = /^\s*:\s+(\S.*)$/.exec(l); if (m) { caption = m[1].trim(); break; } }
  const ops = widgetDocOps(view, el, widget.src);
  // We only ever emit: [optional .center wrap] table [optional ": caption"].
  const replace = (tableText, center, cap) => {
    let text = center ? "::: {.center}\n" + tableText + "\n:::" : tableText;
    if (cap && cap.trim()) text += "\n\n: " + cap.trim();
    ops.replace(text);
  };
  el.addEventListener("mousedown", (e) => {
    if (e.target.closest("a")) return;
    e.preventDefault(); e.stopPropagation();
    HOST.editTable(pipeText, centered, caption, replace, ops.remove);
  });
  addDeleteBadge(el, () => removeObjRange(view, el, widget.src), widget.src);
}

/* ------------------------- callout editing -------------------------- */
const isCalloutSrc = (src) => /^:{3,}\s*\{[^}]*\.callout-/.test(src.trim());
// ::: {.callout-note title="…"} … ::: ⇄ { type, title, body }
function parseCallout(src) {
  const lines = src.split("\n");
  const head = lines[0] || "";
  const type = (/\.callout-([A-Za-z]+)/.exec(head) || [])[1] || "note";
  const title = (/title\s*=\s*["']([^"']*)["']/.exec(head) || [])[1] || "";
  const collapse = /collapse\s*=\s*["']?true/i.test(head);
  let end = lines.length - 1;
  while (end > 0 && !/^:{3,}\s*$/.test(lines[end])) end--;
  const body = lines.slice(1, end).join("\n").replace(/^\n+|\n+$/g, "");
  return { type, title, body, collapse };
}
function serializeCallout(m) {
  const type = m.type || "note";
  const t = (m.title || "").trim();
  const head = "::: {.callout-" + type
    + (t ? ' title="' + t.replace(/"/g, "'") + '"' : "")
    + (m.collapse ? ' collapse="true"' : "") + "}";
  const body = (m.body || "").replace(/\s+$/, "");
  return head + "\n" + (body ? body + "\n" : "") + ":::";
}
function enhanceCalloutWidget(el, view, widget) {
  if (!HOST.editCallout) return;
  el.classList.add("qv-hascallout");
  const ops = widgetDocOps(view, el, widget.src);
  el.addEventListener("mousedown", (e) => {
    if (e.target.closest("a")) return;
    // Collapsible callout: the header's NATIVE <details> toggle handles the
    // fold — only keep the event away from CodeMirror and skip the popup.
    // (Manually flipping .open here double-toggled against the native click.)
    if (e.target.closest("summary")) { e.stopPropagation(); return; }
    e.preventDefault(); e.stopPropagation();
    HOST.editCallout(widget.src, ops.replace, ops.remove);
  });
  // Fold/unfold changes the widget's height — re-measure or clicks below drift.
  el.querySelectorAll("details").forEach((d) =>
    d.addEventListener("toggle", () => { try { view.requestMeasure(); } catch (_) {} }));
  addDeleteBadge(el, () => widgetDocOps(view, el, widget.src).remove(), widget.src);
}

/* ---------------------- front-matter editing ------------------------ */
function enhanceFrontmatterWidget(el, view, widget) {
  if (!HOST.editFrontmatter) return;
  el.classList.add("qv-hasfm");
  const ops = widgetDocOps(view, el, widget.src);
  el.addEventListener("mousedown", (e) => {
    if (e.target.closest("a")) return;
    e.preventDefault(); e.stopPropagation();
    HOST.editFrontmatter(widget.src, ops.replace, ops.remove);
  });
  addDeleteBadge(el, () => widgetDocOps(view, el, widget.src).remove(), widget.src);
}

/* ------------------------- tabset editing --------------------------- */
const isTabsetSrc = (src) => /^:{3,}\s*\{[^}]*\.panel-tabset/.test(src.trim());
// ::: {.panel-tabset} … ## Tab … ::: ⇄ { level, tabs:[{title, body}] }
function parseTabset(src) {
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
function serializeTabset(m) {
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
// Replace/remove ops shared by block objects (tables, tabsets, callouts), built
// on the robust range finder so they survive the popup's focus-handoff re-render.
function widgetDocOps(view, el, src) {
  let used = false;
  return {
    replace: (text) => {
      if (used) return;
      const rg = findObjRange(view, el, src); if (!rg) return; used = true;
      view.dispatch({ changes: { from: rg.from, to: rg.to, insert: text } });
      const anchor = Math.min(view.state.doc.length, rg.from + text.length + 1);
      if (HOST.settleCaret) HOST.settleCaret(anchor); else view.dispatch({ selection: { anchor } });
    },
    remove: () => { if (!used) { used = true; removeObjRange(view, el, src); } },
  };
}
function enhanceTabsetWidget(el, view, widget) {
  if (!HOST.editTabset) return;
  el.classList.add("qv-hastabset");
  const ops = widgetDocOps(view, el, widget.src);
  el.addEventListener("mousedown", (e) => {
    // Tab buttons still switch the previewed panel in place.
    const btn = e.target.closest(".tab-btn");
    if (btn) {
      e.preventDefault(); e.stopPropagation();
      const ts = btn.dataset.ts, idx = btn.dataset.idx;
      el.querySelectorAll(`.tab-btn[data-ts="${ts}"]`).forEach((b) => b.classList.toggle("active", b.dataset.idx === idx));
      el.querySelectorAll(`.tab-panel[data-ts="${ts}"]`).forEach((p) => p.classList.toggle("active", p.dataset.idx === idx));
      return;
    }
    if (e.target.closest("a")) return;
    // Anywhere else → open the popup editor.
    e.preventDefault(); e.stopPropagation();
    HOST.editTabset(widget.src, ops.replace, ops.remove);
  });
  addDeleteBadge(el, () => widgetDocOps(view, el, widget.src).remove(), widget.src);
}

class BlockWidget extends WidgetType {
  constructor(src, kind = "renderBlock") { super(); this.src = src; this.kind = kind; }
  eq(o) { return o.src === this.src && o.kind === this.kind; }
  toDOM(view) {
    const el = document.createElement("div");
    el.className = "qv-block";
    el.setAttribute("contenteditable", "false");
    // flow-root fences the children's margins inside the widget box. Without
    // it CM measures the widget shorter than it PAINTS (offsetHeight excludes
    // escaping margins), the height map drifts for everything below, and
    // posAtCoords clamps to the doc end — drag-select died under any block
    // widget (every doc starts with the front-matter block…).
    el.style.display = "flow-root";
    el.innerHTML = (HOST[this.kind] || HOST.renderBlock)(this.src);
    HOST.resolveImages(el);
    HOST.typeset(el);
    // Front matter / callouts / tabsets → popup editor (fixed widget).
    if (this.kind === "renderFrontmatter") { enhanceFrontmatterWidget(el, view, this); return el; }
    if (isCalloutSrc(this.src)) { enhanceCalloutWidget(el, view, this); return el; }
    if (isTabsetSrc(this.src)) { enhanceTabsetWidget(el, view, this); return el; }
    // Any widget that rendered exactly one table (bare pipe table, or one
    // wrapped in an alignment div) gets in-place cell editing + the toolbar.
    if (el.querySelectorAll("table").length === 1 && /(^|\n)\s*\|/.test(this.src)) {
      enhanceTableWidget(el, view, this);
    }
    // Code blocks: hover outline + × like every object — no popup, clicking
    // still reveals the fenced source for in-place editing.
    else if (/^\s*(```|~~~)/.test(this.src)) {
      el.classList.add("qv-hascode");
      addDeleteBadge(el, () => removeObjRange(view, el, this.src), this.src);
    }
    el.addEventListener("mousedown", (e) => {
      // Tab switching inside a rendered tabset.
      const btn = e.target.closest(".tab-btn");
      if (btn) {
        e.preventDefault();
        const ts = btn.dataset.ts, idx = btn.dataset.idx;
        el.querySelectorAll(`.tab-btn[data-ts="${ts}"]`).forEach((b) => b.classList.toggle("active", b.dataset.idx === idx));
        el.querySelectorAll(`.tab-panel[data-ts="${ts}"]`).forEach((p) => p.classList.toggle("active", p.dataset.idx === idx));
        return;
      }
      // Links inside rendered blocks keep working.
      if (e.target.closest("a")) return;
      // Click-to-edit: move the cursor into the block so its source reveals.
      e.preventDefault();
      placeCursor(view, el);
    });
    return el;
  }
  ignoreEvent() { return true; }
}

// Place the selection at a widget's document position, revealing its source.
function placeCursor(view, el) {
  try {
    const from = view.posAtDOM(el);
    // Land the caret just AFTER the atomic widget, not before it, so a plain
    // Backspace right after a click removes the object the user just clicked.
    let anchor = from;
    const v = view.state.field(livePreview, false);
    if (v) v.atomic.between(from, from + 1, (f, t) => { if (f === from && t > anchor) anchor = t; });
    view.dispatch({ selection: { anchor } });
    view.focus();
  } catch (_) { /* widget may be detached mid-update */ }
}

function missing(src, alt) {
  const s = document.createElement("span");
  s.className = "img-missing";
  s.textContent = "🖼️ 이미지를 찾을 수 없음: " + (alt ? alt + " — " : "") + src;
  return s;
}

class HRWidget extends WidgetType {
  eq() { return true; }
  toDOM(view) {
    const el = document.createElement("span");
    el.className = "qv-hr";
    el.addEventListener("mousedown", (e) => { e.preventDefault(); placeCursor(view, el); });
    return el;
  }
  ignoreEvent() { return true; }
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "qv-bullet";
    el.textContent = "•";
    return el;
  }
  ignoreEvent() { return false; }
}

/* ------------------------- decoration builder ------------------------- */
const HIDE = Decoration.replace({});

function lineNums(doc, from, to) { return [doc.lineAt(from).number, doc.lineAt(to).number]; }

// Temporary "source mode" for one table (the toolbar's MD button): while the
// caret stays inside the range the table renders as raw pipes; leaving the
// range clears the override and the fixed widget returns.
const setRawOverride = StateEffect.define({
  map: (v, ch) => v && { from: ch.mapPos(v.from), to: ch.mapPos(v.to, 1) },
});
const rawOverride = StateField.define({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setRawOverride)) v = e.value;
    if (!v) return null;
    if (tr.docChanged) v = { from: tr.changes.mapPos(v.from), to: tr.changes.mapPos(v.to, 1) };
    if (tr.selection) {
      const h = tr.selection.main.head;
      if (h < v.from || h > v.to) return null;
    }
    return v;
  },
});

// Whole-document source mode: when on, the editor shows plain markdown with no
// widgets/decorations at all (a "developer view"). Toggled from the toolbar.
const setSourceMode = StateEffect.define();
const sourceMode = StateField.define({
  create: () => false,
  update(v, tr) { for (const e of tr.effects) if (e.is(setSourceMode)) v = e.value; return v; },
});

function buildDecorations(state) {
  if (state.field(sourceMode, false)) return { all: Decoration.none, atomic: Decoration.none };
  const doc = state.doc;
  const sel = state.selection;
  const decos = [];

  const spanActive = (from, to) => sel.ranges.some((r) => r.from <= to && r.to >= from);
  const linesActive = (from, to) => {
    const [a, b] = lineNums(doc, from, to);
    return sel.ranges.some((r) => {
      const [x, y] = lineNums(doc, r.from, r.to);
      return !(y < a || x > b);
    });
  };

  const replaced = [];
  const divRanges = [];   // every ::: fenced div, whether or not it's rendered
  const text = doc.toString();

  // 0) YAML front matter at the very start → rendered title block, edited via a
  //    fields popup (fixed object). Source mode reveals the raw YAML.
  const fmMatch = text.match(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/);
  if (fmMatch) {
    const from = 0, to = fmMatch[0].length;
    decos.push({ from, to, deco: Decoration.replace({ widget: new BlockWidget(fmMatch[0], "renderFrontmatter"), block: true, fixed: true }) });
    replaced.push({ from, to });
  }

  // 1) Quarto fenced divs (callouts / tabsets): find top-level ::: blocks.
  // Skip ::: lines inside ``` code fences so code samples don't trigger it.
  {
    const lines = text.split("\n");
    // Precompute line start offsets.
    const starts = [];
    let off = 0;
    for (const ln of lines) { starts.push(off); off += ln.length + 1; }
    let inFence = false;
    const fenced = lines.map((ln) => {
      if (/^\s*(```|~~~)/.test(ln)) { inFence = !inFence; return true; }
      return inFence;
    });
    let i = 0;
    while (i < lines.length) {
      if (!fenced[i] && /^:{3,}\s*\{.+?\}\s*$/.test(lines[i])) {
        let depth = 1, j = i + 1;
        for (; j < lines.length; j++) {
          if (fenced[j]) continue;
          if (/^:{3,}\s*\{.+?\}\s*$/.test(lines[j])) depth++;
          else if (/^:{3,}\s*$/.test(lines[j])) { if (--depth === 0) break; }
        }
        const from = starts[i];
        const to = j < lines.length ? starts[j] + lines[j].length : doc.length;
        divRanges.push({ from, to });
        // A ::: {.center}/{.right} wrapper whose content is just a pipe table is
        // part of the table's FIXED presentation (written by the table toolbar's
        // alignment toggle): always a widget, never revealed by the cursor —
        // except under the MD raw override.
        const ro = state.field(rawOverride, false);
        const inRaw = ro && from < ro.to && to > ro.from;
        const alignDiv = /\{[^}]*\.(center|right)[^}]*\}/.test(lines[i]);
        const innerLines = lines.slice(i + 1, j);
        const tableOnly = alignDiv && innerLines.length > 0
          && innerLines.every((l) => l.trim() === "" || l.trim().startsWith("|"));
        // Tabsets and callouts are FIXED widgets too: clicking opens the popup
        // editor rather than revealing raw ::: source (the caret can't sit inside).
        const isTabset = /\{[^}]*\.panel-tabset/.test(lines[i]);
        const isCallout = /\{[^}]*\.callout-/.test(lines[i]);
        if ((tableOnly || isTabset || isCallout) && !inRaw) {
          const src = doc.sliceString(from, to);
          decos.push({ from, to, deco: Decoration.replace({ widget: new BlockWidget(src), block: true, fixed: true }) });
          replaced.push({ from, to });
        } else if (!tableOnly && !linesActive(from, to)) {
          const src = doc.sliceString(from, to);
          decos.push({ from, to, deco: Decoration.replace({ widget: new BlockWidget(src), block: true }) });
          replaced.push({ from, to });
        }
        i = j + 1;
      } else i++;
    }
  }
  // A ## inside a ::: div (e.g. tabset tab titles) is markup, not a real heading —
  // while editing the raw source, show it plain instead of a big styled heading.
  const inDiv = (pos) => divRanges.some((r) => pos >= r.from && pos < r.to);
  const inReplaced = (from, to) => replaced.some((r) => from < r.to && to > r.from);
  // A node fully inside a replaced block is hidden by that block's widget; a node
  // that merely *contains* a block (Document, a wrapping list) must still descend.
  const fullyInReplaced = (from, to) => replaced.some((r) => from >= r.from && to <= r.to);

  // 2) Syntax-tree driven inline decorations. In a StateField the tree may not
  // be parsed yet, so force it (bounded) and fall back to whatever exists.
  const tree = ensureSyntaxTree(state, doc.length, 150) || syntaxTree(state);
  const seenLine = new Set();
  const addLine = (pos, cls) => {
    const line = doc.lineAt(pos);
    const key = line.from + "|" + cls;
    if (seenLine.has(key)) return;
    seenLine.add(key);
    decos.push({ from: line.from, to: line.from, deco: Decoration.line({ class: cls }), line: true });
  };

  tree.iterate({
    from: 0, to: doc.length,
    enter: (node) => {
      const name = node.name;
      const from = node.from, to = node.to;
      if (fullyInReplaced(from, to)) return false;

      if (/^ATXHeading([1-6])$/.test(name)) {
        // Inside a ::: div (tabset/callout source) → leave as plain text.
        if (inDiv(from)) return true;
        const level = +name.slice(-1);
        addLine(from, `cm-hd cm-h${level}`);
        if (!linesActive(from, to)) {
          const line = doc.lineAt(from);
          const m = /^#{1,6}\s+/.exec(line.text);
          if (m) decos.push({ from: line.from, to: line.from + m[0].length, deco: HIDE });
        }
        return true;
      }
      if (name === "StrongEmphasis" || name === "Emphasis") {
        const cls = name === "StrongEmphasis" ? "cm-strong" : "cm-em";
        decos.push({ from, to, deco: Decoration.mark({ class: cls }) });
        if (!spanActive(from, to)) {
          for (const mk of node.node.getChildren("EmphasisMark")) decos.push({ from: mk.from, to: mk.to, deco: HIDE });
        }
        return true;
      }
      if (name === "InlineCode") {
        decos.push({ from, to, deco: Decoration.mark({ class: "cm-code" }) });
        if (!spanActive(from, to)) for (const mk of node.node.getChildren("CodeMark")) decos.push({ from: mk.from, to: mk.to, deco: HIDE });
        return true;
      }
      if (name === "Strikethrough") {
        decos.push({ from, to, deco: Decoration.mark({ class: "cm-strike" }) });
        if (!spanActive(from, to)) for (const mk of node.node.getChildren("StrikethroughMark")) decos.push({ from: mk.from, to: mk.to, deco: HIDE });
        return true;
      }
      if (name === "Image") {
        const raw = doc.sliceString(from, to);
        const m = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(raw);
        // Quarto image attributes right after the node:
        // ![alt](src){width=300 fig-align="center"}
        const lineEnd = doc.lineAt(to).to;
        const am = /^\{([^}\n]*)\}/.exec(doc.sliceString(to, Math.min(to + 80, lineEnd)));
        let width = null, align = null, end = to;
        if (am) {
          width = (/(?:^|\s)width=(\d+%?)(?:\s|$)/.exec(am[1]) || [])[1] || null;
          align = (/fig-align="?(left|center|right)"?/.exec(am[1]) || [])[1] || null;
          if (width || align) end = to + am[0].length;   // only swallow attrs we understand
        }
        // FIXED widget (Obsidian-style): images never flip to raw source — the
        // caret can't enter them (atomic). Clicking opens the popup editor;
        // deletion is the × badge or Backspace over the widget.
        if (m) {
          const rawTok = doc.sliceString(from, end);
          decos.push({ from, to: end, deco: Decoration.replace({ widget: new ImageWidget(m[2].trim(), m[1], width, align, rawTok), fixed: true }) });
          return false;
        }
        return true;
      }
      if (name === "Link") {
        const marks = node.node.getChildren("LinkMark");
        decos.push({ from, to, deco: Decoration.mark({ class: "cm-link" }) });
        if (!spanActive(from, to) && marks.length >= 2) {
          decos.push({ from, to: marks[0].to, deco: HIDE });       // hide "["
          decos.push({ from: marks[1].from, to, deco: HIDE });     // hide "](url)"
        }
        return true;
      }
      if (name === "Table") {
        // FIXED widget (Obsidian-style): the table never flips to raw source
        // from cursor proximity or clicks — editing happens in-place through
        // cell inputs and the hover toolbar. The only way to see the pipes is
        // the toolbar's MD button, which sets a temporary raw override that
        // clears when the caret leaves the table again.
        const ro = state.field(rawOverride, false);
        if (ro && from < ro.to && to > ro.from) return true;   // source mode for this table
        // Absorb a following pandoc caption line (": Caption", after ≤1 blank
        // line) into the widget so the caption is part of the table object.
        let end = to;
        const endLine = doc.lineAt(to);
        let capNo = endLine.number + 1;
        if (capNo <= doc.lines && doc.line(capNo).text.trim() === "") capNo++;
        if (capNo <= doc.lines && /^\s*:\s+\S/.test(doc.line(capNo).text)) end = doc.line(capNo).to;
        const src = doc.sliceString(from, end);
        decos.push({ from, to: end, deco: Decoration.replace({ widget: new BlockWidget(src), block: true, fixed: true }) });
        replaced.push({ from, to: end });
        return false;
      }
      if (name === "HorizontalRule") {
        if (!linesActive(from, to)) decos.push({ from, to, deco: Decoration.replace({ widget: new HRWidget() }) });
        return false;
      }
      if (name === "ListMark") {
        // Match Quarto cosmo exactly: list text sits 2em in per nesting level
        // (measured from a real `quarto render`). The bullet is in-flow here
        // (the blog's marker hangs) and the source's leading spaces add ~0.6em
        // per level, so the padding that lands the text at depth·2em works out
        // to depth·1.4 − 0.66em.
        let depth = 0;
        for (let n = node.node.parent; n; n = n.parent) if (/(?:Bullet|Ordered)List$/.test(n.name)) depth++;
        const padEm = Math.max(0, depth * 1.4 - 0.66).toFixed(2);
        const ln = doc.lineAt(from), key = ln.from + "|cm-li";
        if (!seenLine.has(key)) {
          seenLine.add(key);
          decos.push({ from: ln.from, to: ln.from, line: true,
            deco: Decoration.line({ class: "cm-li", attributes: { style: `padding-left:${padEm}em` } }) });
        }
        // Bullet list markers render as • (ordered numbers stay visible).
        if (/^[-*+]$/.test(doc.sliceString(from, to)) && !linesActive(from, to)) {
          decos.push({ from, to, deco: Decoration.replace({ widget: new BulletWidget() }) });
        }
        return false;
      }
      if (name === "Blockquote") {
        addLine(from, "cm-quote");
        return true;
      }
      if (name === "QuoteMark") {
        addLine(from, "cm-quote");
        if (!linesActive(from, to)) {
          const line = doc.lineAt(from);
          const m = /^\s*>\s?/.exec(line.text);
          if (m) decos.push({ from: line.from, to: line.from + m[0].length, deco: HIDE });
        }
        return true;
      }
      if (name === "FencedCode") {
        // Reveal-on-cursor (NOT a fixed object): a highlighted hljs panel when
        // the caret is outside, and the raw fenced lines — with CodeMirror's own
        // per-language syntax highlighting — when the caret is inside, so you
        // edit code directly, in place.
        if (!linesActive(from, to)) {
          const src = doc.sliceString(from, to);
          decos.push({ from, to, deco: Decoration.replace({ widget: new BlockWidget(src), block: true }) });
          return false;
        }
        const [a, b] = lineNums(doc, from, to);
        for (let ln = a; ln <= b; ln++) addLine(doc.line(ln).from, "cm-codeblock");
        return true;
      }
      return true;
    },
  });

  // 3) Math ($...$ and $$...$$), not part of the markdown tree.
  const inCode = (pos) => {
    let n = tree.resolveInner(pos, 1);
    while (n) { if (/Code|FencedCode|InlineCode/.test(n.name)) return true; n = n.parent; }
    return false;
  };
  // Block math first.
  const blockRe = /\$\$([\s\S]+?)\$\$/g;
  let bm;
  const mathRanges = [];
  while ((bm = blockRe.exec(text))) {
    const from = bm.index, to = from + bm[0].length;
    if (inReplaced(from, to) || inCode(from)) continue;
    mathRanges.push([from, to]);
    if (!spanActive(from, to)) decos.push({ from, to, deco: Decoration.replace({ widget: new MathWidget(bm[1].trim(), true, bm[0]), block: bm[0].includes("\n") }) });
  }
  const inMath = (from, to) => mathRanges.some((r) => from < r[1] && to > r[0]);
  const inlineRe = /(?<!\$)\$(?!\s)([^\$\n]+?)(?<!\s)\$(?!\$)/g;
  let im;
  while ((im = inlineRe.exec(text))) {
    const from = im.index, to = from + im[0].length;
    if (inReplaced(from, to) || inMath(from, to) || inCode(from)) continue;
    if (!spanActive(from, to)) decos.push({ from, to, deco: Decoration.replace({ widget: new MathWidget(im[1].trim(), false) }) });
  }

  // Decoration.set sorts by from + startSide, which correctly orders the mix of
  // line / inline-mark / inline-replace / block-widget decorations we produce.
  const all = Decoration.set(decos.map((d) => d.deco.range(d.from, d.to)), true);
  // Atomic ranges for cursor motion. Hard-won rules:
  //  - INLINE replaced ranges (hidden syntax markers, inline math/images) are
  //    atomic; line/mark styling must not be (ArrowUp skipped to doc top);
  //  - reveal-on-cursor block widgets (callouts, code, front matter) must NOT
  //    be atomic — arrowing in reveals the source for keyboard editing;
  //  - FIXED widgets (tables, images) ARE atomic even as blocks: the caret can
  //    never enter them, so it skips over and delete removes them whole.
  const atomic = Decoration.set(
    decos
      .filter((d) => {
        const spec = d.deco.spec || {};
        if (spec.fixed) return true;
        return !d.line && !spec.class && !spec.block;
      })
      .map((d) => d.deco.range(d.from, d.to)),
    true
  );
  return { all, atomic };
}

// Block widgets (callouts, tabsets, block math) are only allowed from a
// StateField, not a ViewPlugin — so all live-preview decorations live here.
const livePreview = StateField.define({
  create: (state) => buildDecorations(state),
  update(value, tr) {
    if (tr.docChanged || tr.selection
        || tr.effects.some((e) => e.is(setRawOverride) || e.is(setSourceMode))) {
      return buildDecorations(tr.state);
    }
    return value;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.all),
    EditorView.atomicRanges.of((view) => {
      const v = view.state.field(f, false);
      return v ? v.atomic : Decoration.none;
    }),
  ],
});

/* ------------------------------ theme -------------------------------- */
const codeHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#cf222e" },
  { tag: [t.string, t.special(t.string)], color: "#0a3069" },
  { tag: [t.comment], color: "#6e7781", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null], color: "#0550ae" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#8250df" },
  { tag: [t.definition(t.variableName), t.propertyName], color: "#0550ae" },
  { tag: [t.typeName, t.className], color: "#953800" },
  { tag: [t.operator], color: "#0550ae" },
]);

// Values mirror the real 신록예찬 blog (Quarto cosmo + styles.css), measured
// from its rendered pages: coral #ff6f61 headings, GitHub system-sans body
// (weight 600), purple #7d12ba inline code on rgba(233,236,239,.65), gray
// bootstrap-bordered quotes.
const MONO = "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "#fcfcf7", color: "#555" },
  ".cm-scroller": {
    fontFamily: "'Noto Serif','NanumMyeongjo','Nanum Myeongjo',serif",
    fontSize: "16px", lineHeight: "1.5", overflow: "auto",
    backgroundColor: "#f3f0e4",   // desk behind the paper card
    // Desk gutter around the sheet. MUST be padding here, not margin on
    // .cm-content: CM's selection layer shares the scroller origin, so a
    // content margin shifts text but not the highlight rects — ⌘A painted
    // outside the paper.
    // Top/bottom kept close (20/24) — the old 48px bottom made the desk feel
    // bottom-heavy ("아래쪽만 여백이 많은 느낌").
    padding: "20px 24px 24px 20px",
  },
  // Left-aligned column (was centered — the floating middle block felt wrong
  // when the sidebar is hidden). maxWidth keeps lines readable; a fixed left
  // pad gives the text a stable start line.
  // "종이 카드" boundary (design pick B): the document column is a sheet of
  // paper — slightly lighter than the desk behind it, lifted by a soft shadow.
  // A real sheet of paper: rounded on ALL sides, floating on the desk with a
  // gutter around it (the half-rounded right-edge-only card read as unfinished).
  // NOTE: no minHeight/boxSizing — CM6's coordinate math assumes content-box
  // (border-box collapsed posAtCoords to the doc end and killed drag-select).
  // Content stays TRANSPARENT: drawSelection paints its highlight layer at
  // z-index -2 (behind the content), so any background here would hide every
  // selection — ⌘A looked dead. The paper sheet is a separate underlay div
  // at z-index -3 (created in create()), sized to match this element.
  ".cm-content": {
    // Bottom pad is breathing room after the last line; 120px read as a huge
    // empty tail on short docs, 64px still keeps the end off the paper edge.
    padding: "44px 28px 64px 48px", maxWidth: "868px",
    caretColor: "#ff6f61",
  },
  // CM's default 6px left padding on lines pushes plain text 6px right of block
  // widgets (front matter, callouts, tables), making left edges look misaligned.
  // Zero it so every element shares the same left margin.
  ".cm-line": { paddingLeft: "0" },
  // List indent is applied per line inline (depth·1.4−0.66em); see ListMark.
  // Kill CM's default focus ring (an ugly 1px dotted outline around the editor).
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "#ff6f61" },
  // Selection color. CM's drawSelection baseTheme paints the (lavender) default
  // with a high-specificity selector — "&light.cm-focused > .cm-scroller >
  // .cm-selectionLayer .cm-selectionBackground" (0,5,0). A plain
  // ".cm-selectionBackground" override (0,1,0) loses to it, so we MUST match the
  // same selector depth for our peach to win.
  // Clip the highlight to the TEXT column: drawSelection's full-line rects
  // span the whole content box including the horizontal padding, which put
  // peach outside the text boundaries (독자가 그은 선 밖). The inset values
  // mirror .cm-content's left/right padding.
  // NO layer slab at all. drawSelection's merged rectangles read as one huge
  // pink wall on real documents (blank lines, widget rows, padding included).
  // The look the user approved is the NATIVE per-glyph selection hugging the
  // text — so the layer is hidden and ::selection paints everything.

  ".cm-content ::selection": { backgroundColor: "rgba(255,111,97,.22)" },
  ".cm-content::selection": { backgroundColor: "rgba(255,111,97,.22)" },
  // Widgets (front-matter title block, tables, callouts…) are non-editable
  // islands where the BROWSER paints its own ::selection (the title showed
  // system blue). Tint it the SAME translucent coral as the layer wash so
  // every selected thing — text, table cells, title — reads as one system.
  ".cm-content .qv-block ::selection, .cm-content .qv-block::selection": { backgroundColor: "rgba(255,111,97,.22)" },
  ".cm-content .qv-math ::selection, .cm-content .qv-math::selection": { backgroundColor: "rgba(255,111,97,.22)" },
  ".cm-content .qv-imgwrap ::selection": { backgroundColor: "rgba(255,111,97,.22)" },
  // Translucent wash, not an opaque slab: a full-document ⌘A paints one big
  // merged rectangle (blank lines + widget rows included), and solid peach
  // read as a heavy pink wall on real documents.
  "& > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "rgba(255,111,97,.14)", borderRadius: "3px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "rgba(255,111,97,.22)", borderRadius: "3px" },
  "::selection": { backgroundColor: "#ffe1dc" },

  // live-preview element styling (matches .qdoc in doc.css)
  ".cm-hd": { fontWeight: "600", color: "#ff6f61", lineHeight: "1.25" },
  ".cm-h1, .cm-h2": { fontSize: "2em" },
  ".cm-h3": { fontSize: "1.45em" },
  ".cm-h4": { fontSize: "1.15em" },
  ".cm-h5, .cm-h6": { fontSize: "1em" },
  ".cm-strong": { fontWeight: "700", color: "#333" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-strike": { textDecoration: "line-through", color: "#999" },
  ".qv-imgwrap": { display: "inline-block", maxWidth: "100%", cursor: "pointer" },
  // fig-align variants: the wrap becomes a full-width block and the inner box
  // (the image) is positioned inside it with text-align.
  ".qv-imgwrap.qv-align-left": { display: "block", textAlign: "left" },
  ".qv-imgwrap.qv-align-center": { display: "block", textAlign: "center" },
  ".qv-imgwrap.qv-align-right": { display: "block", textAlign: "right" },
  ".qv-imgbox": { position: "relative", display: "inline-block", maxWidth: "100%" },
  ".qv-imgwrap:hover .qv-img": { outline: "2px solid #ffd5ce", outlineOffset: "2px", borderRadius: "2px" },
  // Caption sits directly beneath the image (block right under the box).
  ".qv-imgcap": { display: "block", textAlign: "center", color: "#6c757d", fontSize: "0.9em", marginTop: "0.25em", lineHeight: "1.35" },
  ".qv-img-grip": {
    position: "absolute", right: "-6px", bottom: "-6px", width: "13px", height: "13px",
    borderRadius: "3px", background: "#fff", border: "1.5px solid #ff6f61",
    cursor: "nwse-resize", opacity: "0", transition: "opacity .15s",
  },
  ".qv-imgbox:hover .qv-img-grip": { opacity: "1" },
  ".cm-datauri": {
    display: "inline-block", padding: "0 7px", margin: "0 1px",
    background: "#f0eee2", border: "1px solid #ddd9c3", borderRadius: "6px",
    color: "#8a8578", fontSize: "0.78em", lineHeight: "1.7", verticalAlign: "baseline",
    whiteSpace: "nowrap",
  },
  ".cm-code": {
    fontFamily: MONO, fontSize: "0.875em", color: "#7d12ba",
    background: "rgba(233,236,239,0.65)", padding: "0.15em 0.2em",
  },
  ".cm-link": { color: "#ff6f61" },
  ".cm-quote": {
    color: "hsl(210,10.3%,47.7%)", borderLeft: "0.25em solid #e9ecef",
    paddingLeft: "1.25em",
  },
  ".cm-codeblock": {
    background: "rgba(233,236,239,0.65)", fontFamily: MONO,
    fontSize: "0.875em", color: "#24292e",
  },

  ".qv-img": { maxWidth: "100%", display: "block", margin: "4px 0" },
  ".qv-hr": {
    display: "inline-block", width: "100%", height: "1px",
    background: "#dee2e6", verticalAlign: "middle",
  },
  // Blog-style bullet: body-toned disc with a comfortable gap before the text
  // (not the cramped pale dot it was).
  ".qv-bullet": { color: "#555", paddingRight: "0.45em", fontSize: "0.9em" },
  ".qv-math": { color: "#333" },
  ".qv-math-block": { textAlign: "center", margin: "2px 0", display: "flex", justifyContent: "center" },
  ".qv-block": { margin: "0", position: "relative" },
  // A table block shrinks to the table's width so its × badge lands on the
  // table's own top-right corner, not far out at the full-line right edge.
  // That shrink-wrap also means the ::: {.center}/{.right} wrapper INSIDE the
  // widget has no room to move the table — so alignment is applied to the
  // widget box itself (classes set by enhanceTableWidget from the src).
  ".qv-block.qv-hastable": { width: "fit-content", maxWidth: "100%" },
  ".qv-block.qv-hastable.qv-tbl-center": { marginLeft: "auto", marginRight: "auto" },
  ".qv-block.qv-hastable.qv-tbl-right": { marginLeft: "auto" },
  // Empty cells must stay clickable: give them real size and an invisible
  // filler so a fresh table isn't a stack of hairlines.
  // Hover affordance for all objects is the SVG ring drawn by addDeleteBadge
  // (outline + badge tab as one stroke) — no CSS outlines here anymore.
  ".qv-hastable, .qv-hastabset, .qv-hascallout, .qv-hasfm": { cursor: "pointer" },
  // Display math: the flex centering keeps the formula centered while the
  // formula box (mjx-math) shrinks to content — MathJax pins it to 100%
  // otherwise — so the hover ring hugs the math itself.
  ".qv-math-block mjx-container": { maxWidth: "100%" },
  ".qv-math-block mjx-math": { width: "auto !important" },
  ".qv-hastable td, .qv-hastable th": { minWidth: "3.5em", height: "1.7em" },
  ".qv-hastable td:empty::before, .qv-hastable th:empty::before": { content: '"\\00a0"' },
  // The toolbar is ALWAYS present above the table (in flow, no hover games —
  // it kept "hiding" mid-interaction). Dimmed when idle, full when the table
  // is hovered or a cell is being edited.
}, { dark: false });

/* --------------------- vertical cursor movement ----------------------- */
// view.moveVertically can overstep by a whole line with our serif font
// metrics (observed: ArrowDown skipping blank lines, ArrowUp chaining to the
// top). Clamp vertical motion to the adjacent document line while preserving
// in-line wrap navigation and the goal column.
function moveByLine(view, forward) {
  const { state } = view;
  const sel = state.selection.main;
  const target = view.moveVertically(sel, forward);
  const curLine = state.doc.lineAt(sel.head).number;
  const tLine = state.doc.lineAt(target.head).number;
  const want = forward ? Math.min(curLine + 1, state.doc.lines) : Math.max(curLine - 1, 1);
  let dest = target;
  if (forward ? tLine > want : tLine < want) {
    const line = state.doc.line(want);
    const goal = target.goalColumn ?? (sel.head - state.doc.lineAt(sel.head).from);
    const col = Math.min(line.length, goal);
    dest = EditorSelection.cursor(line.from + col, -1, undefined, target.goalColumn);
  }
  // Fixed widgets (tables, images) are atomic: the caret must never land
  // INSIDE their replaced range (it would be invisible and typing would edit
  // hidden markdown). If the computed destination falls inside one, hop to the
  // line just past the widget in the direction of travel.
  {
    const lp = state.field(livePreview, false);
    if (lp) {
      let hit = null;
      lp.atomic.between(dest.head, dest.head, (f, t) => {
        if (f < dest.head && t > dest.head) { hit = { f, t }; return false; }
      });
      if (hit) {
        const doc = state.doc;
        const goal = dest.goalColumn ?? 0;
        let ln = forward
          ? Math.min(doc.lineAt(hit.t).number + 1, doc.lines)
          : Math.max(doc.lineAt(hit.f).number - 1, 1);
        const line = doc.line(ln);
        const col = Math.min(line.length, goal);
        dest = EditorSelection.cursor(line.from + col, -1, undefined, goal);
      }
    }
  }
  view.dispatch(state.update({
    selection: EditorSelection.create([dest]),
    scrollIntoView: true,
    userEvent: "select",
  }));
  return true;
}

/* ------------------------------- API --------------------------------- */
function create(parent, opts = {}) {
  HOST = {
    renderBlock: opts.renderBlock || HOST.renderBlock,
    renderFrontmatter: opts.renderFrontmatter || opts.renderBlock || HOST.renderBlock,
    resolveAsset: opts.resolveAsset || HOST.resolveAsset,
    typeset: opts.typeset || HOST.typeset,
    // THE missing line behind the long-lived "big gap after inline math" bug:
    // without it MathWidget's synchronous render path never ran — every formula
    // took the async fallback, CM measured the wide \(..\) placeholder, and the
    // caret stayed at that stale width after the late render narrowed the widget.
    typesetSync: opts.typesetSync || HOST.typesetSync,
    editTable: opts.editTable || HOST.editTable,
    editTabset: opts.editTabset || HOST.editTabset,
    editCallout: opts.editCallout || HOST.editCallout,
    editFrontmatter: opts.editFrontmatter || HOST.editFrontmatter,
    editImage: opts.editImage || HOST.editImage,
    settleCaret: opts.settleCaret || HOST.settleCaret,
    resolveImages: opts.resolveImages || HOST.resolveImages,
    flash: opts.flash || HOST.flash,
  };

  const saveKey = {
    key: "Mod-s",
    run: () => { opts.onSave && opts.onSave(); return true; },
    preventDefault: true,
  };
  const openKey = {
    key: "Mod-o",
    run: () => { opts.onOpen && opts.onOpen(); return true; },
    preventDefault: true,
  };
  const newKey = {
    key: "Mod-n",
    run: () => { opts.onNew && opts.onNew(); return true; },
    preventDefault: true,
  };
  // ⌘-arrow navigation on DOCUMENT lines. CM's default line-boundary commands
  // work on *visual* lines measured from the DOM; with replaced widgets
  // (tables, math, callouts) that measurement goes wrong and the caret jumps
  // to arbitrary neighboring lines. Document-line semantics are predictable.
  const jumpTo = (v, pos, extend) => {
    const sel = v.state.selection.main;
    v.dispatch(v.state.update({
      selection: extend
        ? EditorSelection.create([EditorSelection.range(sel.anchor, pos)])
        : { anchor: pos },
      scrollIntoView: true,
      userEvent: "select",
    }));
    return true;
  };
  const lineEdge = (v, toEnd, extend) => {
    const line = v.state.doc.lineAt(v.state.selection.main.head);
    return jumpTo(v, toEnd ? line.to : line.from, extend);
  };
  // Backspace/Delete over a fixed object (image, table, tabset, math, hr):
  // when the caret sits right after (Backspace) or right before (Delete) an
  // atomic widget, remove the whole object in one stroke — "click it, delete
  // it." Returns false when no object is adjacent, so normal editing is intact.
  const deleteAtomicAt = (view, forward) => {
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const v = view.state.field(livePreview, false);
    if (!v) return false;
    const p = sel.from, doc = view.state.doc;
    let target = null;
    v.atomic.between(Math.max(0, p - 1), Math.min(doc.length, p + 1), (f, t) => {
      if (forward ? f === p : t === p) target = { from: f, to: t };
    });
    if (!target) return false;
    let { from, to } = target;
    // Swallow one adjacent blank line so a block object leaves no empty gap.
    if (doc.sliceString(to, to + 1) === "\n" && doc.sliceString(to + 1, to + 2) === "\n") to += 1;
    else if (from > 0 && doc.sliceString(from - 1, from) === "\n" && doc.sliceString(from - 2, from - 1) === "\n") from -= 1;
    view.dispatch({ changes: { from, to, insert: "" }, selection: { anchor: from } });
    return true;
  };
  const arrowKeys = [
    { key: "Backspace", run: (v) => deleteAtomicAt(v, false) },
    { key: "Delete", run: (v) => deleteAtomicAt(v, true) },
    { key: "ArrowDown", run: (v) => moveByLine(v, true) },
    { key: "ArrowUp", run: (v) => moveByLine(v, false) },
    { key: "Mod-ArrowLeft", run: (v) => lineEdge(v, false, false), shift: (v) => lineEdge(v, false, true) },
    { key: "Mod-ArrowRight", run: (v) => lineEdge(v, true, false), shift: (v) => lineEdge(v, true, true) },
    { key: "Mod-ArrowUp", run: (v) => jumpTo(v, 0, false), shift: (v) => jumpTo(v, 0, true) },
    { key: "Mod-ArrowDown", run: (v) => jumpTo(v, v.state.doc.length, false), shift: (v) => jumpTo(v, v.state.doc.length, true) },
  ];

  // A document's whole editor state (doc + history + cursor) is built here, so
  // each open tab can carry its own independent EditorState and swap in via
  // setState — keeping per-tab undo history and cursor position intact.
  const makeState = (doc) => EditorState.create({
    doc: doc || "",
    extensions: [
      history(),
      // NO drawSelection: its base theme forces native ::selection transparent
      // (!important) and paints merged slab rectangles instead. The approved
      // look is the native per-glyph selection. (Its removal was tried before
      // and wrongly blamed for dead clicks near widgets — that was the
      // flow-root height-map bug, fixed today.)
      indentOnInput(),
      bracketMatching(),
      markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [GFM] }),
      syntaxHighlighting(codeHighlight),
      sourceMode,
      rawOverride,
      livePreview,
      theme,
      EditorView.lineWrapping,
      keymap.of([saveKey, openKey, newKey, ...arrowKeys, indentWithTab, ...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((u) => { if (u.docChanged && opts.onChange) opts.onChange(view.state.doc.toString()); }),
      // Caret-redraw fix. On a doc change, a `$..$` source can become a
      // replace-widget of a different width. CodeMirror updates coordsAtPos
      // correctly, but the drawSelection caret layer does NOT redraw — it stays
      // at the old (wider) source position, so the caret visibly jumps right
      // after typing e.g. a space past inline math. requestMeasure doesn't move
      // it; re-asserting the selection does. Do that on the next frame (skipping
      // active IME composition so Korean input isn't disrupted).
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        requestAnimationFrame(() => {
          if (view.composing) return;  // don't disrupt IME (Korean) composition
          try {
            const m = view.state.selection.main;
            view.dispatch({
              selection: { anchor: m.anchor, head: m.head },
              annotations: Transaction.addToHistory.of(false),
              scrollIntoView: false,
            });
          } catch (_) {}
        });
      }),
    ],
  });

  const view = new EditorView({ state: makeState(opts.doc), parent });
  // Paper-sheet underlay: lives BEHIND the selection layer (z -3 < -2) so the
  // peach highlight stays visible on top of the paper. Absolutely positioned
  // inside the scroller (scrolls with content); size tracks the content box.
  {
    const paper = document.createElement("div");
    paper.className = "qv-paper";
    Object.assign(paper.style, {
      position: "absolute", top: "20px", left: "20px", zIndex: "-3",
      background: "#fdfdf9", borderRadius: "12px", pointerEvents: "none",
      boxShadow: "0 1px 3px rgba(90,80,60,.10), 0 8px 26px rgba(90,80,60,.09)",
    });
    view.scrollDOM.appendChild(paper);
    const sync = () => {
      const c = view.contentDOM;
      paper.style.left = c.offsetLeft + "px";
      paper.style.top = c.offsetTop + "px";
      paper.style.width = c.offsetWidth + "px";
      paper.style.height = c.offsetHeight + "px";
    };
    try { new ResizeObserver(sync).observe(view.contentDOM); } catch (_) { setInterval(sync, 500); }
    sync();
  }
  // Web fonts (base64 serif) apply after first layout and grow every line —
  // especially the tall front-matter title block. CM's height map does NOT
  // refresh via requestMeasure (measured empirically), so coordinates below
  // the growth point clamp to the doc end: drag-select died on later lines.
  // A full setState is the only call that re-reads every line height; state
  // identity is preserved so selection/history are untouched.
  const reflow = () => {
    try {
      const st = view.scrollDOM.scrollTop;
      view.setState(view.state);
      view.scrollDOM.scrollTop = st;
    } catch (_) {}
  };
  try { document.fonts.ready.then(() => setTimeout(reflow, 50)); } catch (_) {}

  // Selection/caret reflow after OUT-OF-BAND height changes. drawSelection
  // positions its rectangles from CM's cached line-height map, which only
  // re-reads the DOM on doc edits. When content height changes WITHOUT a doc
  // edit — CSS document-zoom (font-size), image drag-resize, or an async
  // MathJax render that resizes a formula — those cached heights go stale and
  // the selection visibly drifts off the text (e.g. the highlight ends ~1 line
  // short after zooming). Empirically only a full view.setState re-reads every
  // line height; requestMeasure() and no-op dispatches do NOT. `reflow()` is
  // exposed so the host can call it right after such a change (applyZoom does).
  // scrollTop is saved/restored because setState resets the viewport.
  let reflowing = false;
  const reflowNow = () => {
    if (view.composing || reflowing) return;  // never disrupt IME (Korean) composition
    reflowing = true;
    const st = view.scrollDOM.scrollTop;
    try { view.setState(view.state); } catch (_) {}
    view.scrollDOM.scrollTop = st;
    requestAnimationFrame(() => { reflowing = false; });
  };
  // Debounced reflow for async math renders: a doc-load with N formulas fires N
  // async completions as MathJax comes up, but we only need one reflow once they
  // settle. Point the module-level hook at it so MathWidget can call it.
  let mathReflowTimer = 0;
  mathReflowHook = () => { clearTimeout(mathReflowTimer); mathReflowTimer = setTimeout(reflowNow, 80); };

  return {
    view,
    reflow: reflowNow,
    getValue: () => view.state.doc.toString(),
    setValue: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    // Per-tab state handling.
    freshState: (text) => makeState(text),
    getState: () => view.state,
    setState: (s) => view.setState(s),
    focus: () => view.focus(),
    isSource: () => view.state.field(sourceMode, false),
    setSource: (on) => { view.dispatch({ effects: setSourceMode.of(!!on) }); view.focus(); },
    destroy: () => view.destroy(),
  };
}

export { create, parseTable, serializeTable, parseTabset, serializeTabset, parseCallout, serializeCallout };
