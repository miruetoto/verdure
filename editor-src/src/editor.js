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
// The fixed context slot has one owner at a time; only the owner may clear it,
// so a table's deferred cleanup can't wipe controls an image just docked.
let ctxOwner = null;
function dockCtx(node, label, owner) { ctxOwner = owner; HOST.ctxMount(node, label); }
function undockCtx(owner) { if (ctxOwner === owner) { ctxOwner = null; HOST.ctxClear(); } }

let HOST = {
  renderBlock: (src) => "<pre>" + src.replace(/[&<]/g, (c) => (c === "&" ? "&amp;" : "&lt;")) + "</pre>",
  resolveAsset: async () => null,
  typeset: async () => {},
  resolveImages: async () => {},
  ctxMount: () => {},
  ctxClear: () => {},
  editTable: null,   // host-provided spreadsheet modal (src, replace) — see index.html
  settleCaret: null, // host-provided caret settling across modal focus handoffs
};

/* ------------------------------ widgets ------------------------------ */
// Merge a patch ({width} and/or {align}) into the Quarto attribute block after
// the image markdown that starts at this widget's document position, e.g.
// ![alt](src){width=300 fig-align="center"} — standard syntax, so a real
// `quarto render` honors it too.
function applyImageAttr(view, dom, patch) {
  try {
    const pos = view.posAtDOM(dom);
    const line = view.state.doc.lineAt(pos);
    const text = view.state.doc.sliceString(pos, line.to);
    const m = /^!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/.exec(text);
    if (!m) return;
    const attrTo = pos + m[0].length;
    const attrFrom = attrTo - (m[1] ? m[1].length : 0);
    const cur = m[1] ? m[1].slice(1, -1) : "";
    let width = (/(?:^|\s)width=(\d+%?)/.exec(cur) || [])[1] || null;
    let align = (/fig-align="?(left|center|right)"?/.exec(cur) || [])[1] || null;
    if ("width" in patch) width = patch.width;
    if ("align" in patch) align = patch.align;
    const parts = [];
    if (width) parts.push("width=" + width);
    if (align) parts.push('fig-align="' + align + '"');
    view.dispatch({ changes: { from: attrFrom, to: attrTo, insert: parts.length ? "{" + parts.join(" ") + "}" : "" } });
  } catch (_) { /* widget detached mid-drag */ }
}

class ImageWidget extends WidgetType {
  constructor(src, alt, width, align) {
    super(); this.src = src; this.alt = alt; this.width = width || null; this.align = align || null;
  }
  eq(o) { return o.src === this.src && o.alt === this.alt && o.width === this.width && o.align === this.align; }
  toDOM(view) {
    // The widget's root must stay stable: replacing it (img.replaceWith) mutates
    // the editable DOM outside a transaction, and CM's observer syncs the
    // placeholder text back into the document. So keep a wrapper and only swap
    // an inner box's children on failure.
    const wrap = document.createElement("span");
    wrap.className = "qv-imgwrap" + (this.align ? " qv-align-" + this.align : "");
    const box = document.createElement("span");      // relative anchor for grip/toolbar
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
    // Clicking selects the image: its controls stay pinned (visible regardless
    // of hover) until a click lands anywhere outside the image.
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      wrap.classList.add("qv-selected");
      dockCtx(bar, "이미지", bar);            // controls dock in the fixed slot
      const off = (ev) => {
        if (wrap.contains(ev.target)) return;
        wrap.classList.remove("qv-selected");
        undockCtx(bar);
        document.removeEventListener("mousedown", off, true);
      };
      document.addEventListener("mousedown", off, true);
      placeCursor(view, wrap);
    });
    // Drag the corner grip to resize: live via style.width, then persisted as a
    // Quarto {width=N} attribute so real `quarto render` honors it too.
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
        applyImageAttr(view, wrap, { width: Math.round(img.getBoundingClientRect().width) });
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    // Hover toolbar: left / center / right alignment → fig-align attribute.
    // Clicking the active one clears the alignment.
    const bar = document.createElement("span");
    bar.className = "qv-img-alignbar";
    for (const [key, glyph, tip] of [["left", "⇤", "왼쪽 정렬"], ["center", "↔", "가운데 정렬"], ["right", "⇥", "오른쪽 정렬"]]) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = glyph; b.title = tip;
      if (this.align === key) b.className = "on";
      b.addEventListener("mousedown", (e) => {
        e.preventDefault(); e.stopPropagation();
        applyImageAttr(view, wrap, { align: this.align === key ? null : key });
      });
      bar.appendChild(b);
    }
    // (docked into the app's context slot on selection — never floats here)
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
  constructor(tex, display) { super(); this.tex = tex; this.display = display; }
  eq(o) { return o.tex === this.tex && o.display === this.display; }
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
    if (!sync) {
      el.textContent = this.display ? `\\[${this.tex}\\]` : `\\(${this.tex}\\)`;
      const remeasure = () => { try { view.requestMeasure(); } catch (_) {} };
      const done = HOST.typeset(el);
      if (done && done.then) done.then(() => { remeasure(); requestAnimationFrame(remeasure); });
    }
    el.addEventListener("mousedown", (e) => { e.preventDefault(); placeCursor(view, el); });
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
  const prefix = srcLines.slice(0, firstPipe), suffix = srcLines.slice(lastPipe + 1);
  const pipeText = srcLines.slice(firstPipe, lastPipe + 1).join("\n");
  const centered = /^\s*:{3,}\s*\{[^}]*\.center/.test(widget.src);
  let used = false;   // a widget instance may rewrite the doc at most once
  const replace = (tableText, center) => {
    if (used || !el.isConnected) return;
    const base = view.posAtDOM(el);
    const doc = view.state.doc;
    let rg = null;
    for (const from of [base, base - 1, base + 1, base - 2, base + 2, base - 3, base + 3]) {
      const to = from + widget.src.length;
      if (from >= 0 && to <= doc.length && doc.sliceString(from, to) === widget.src) { rg = { from, to }; break; }
    }
    if (!rg) return;
    used = true;
    let text;
    if (center && !centered) text = "::: {.center}\n" + tableText + "\n:::";
    else if (!center && centered) text = tableText;
    else text = [...prefix, tableText, ...suffix].join("\n");
    view.dispatch({ changes: { from: rg.from, to: rg.to, insert: text } });
    // Land the caret on the line after the table; the host settles it across
    // the modal's focus handoff (WKWebView can drag it to the widget's edge).
    const anchor = Math.min(view.state.doc.length, rg.from + text.length + 1);
    if (HOST.settleCaret) HOST.settleCaret(anchor);
    else view.dispatch({ selection: { anchor }, scrollIntoView: true });
  };
  const remove = () => {
    if (used || !el.isConnected) return;
    const base = view.posAtDOM(el);
    const doc = view.state.doc;
    let rg = null;
    for (const from of [base, base - 1, base + 1, base - 2, base + 2, base - 3, base + 3]) {
      const to = from + widget.src.length;
      if (from >= 0 && to <= doc.length && doc.sliceString(from, to) === widget.src) { rg = { from, to }; break; }
    }
    if (!rg) return;
    used = true;
    // Also swallow one trailing blank line so no double gap is left behind.
    let to = rg.to;
    if (doc.sliceString(to, to + 1) === "\n" && doc.sliceString(to + 1, to + 2) === "\n") to += 1;
    view.dispatch({ changes: { from: rg.from, to, insert: "" }, selection: { anchor: rg.from } });
    if (HOST.settleCaret) HOST.settleCaret(rg.from);
  };
  el.addEventListener("mousedown", (e) => {
    if (e.target.closest("a")) return;
    e.preventDefault(); e.stopPropagation();
    HOST.editTable(pipeText, centered, replace, remove);
  });
}

class BlockWidget extends WidgetType {
  constructor(src, kind = "renderBlock") { super(); this.src = src; this.kind = kind; }
  eq(o) { return o.src === this.src && o.kind === this.kind; }
  toDOM(view) {
    const el = document.createElement("div");
    el.className = "qv-block";
    el.setAttribute("contenteditable", "false");
    el.innerHTML = (HOST[this.kind] || HOST.renderBlock)(this.src);
    HOST.resolveImages(el);
    HOST.typeset(el);
    // Any widget that rendered exactly one table (bare pipe table, or one
    // wrapped in an alignment div) gets in-place cell editing + the toolbar.
    if (el.querySelectorAll("table").length === 1 && /(^|\n)\s*\|/.test(this.src)) {
      enhanceTableWidget(el, view, this);
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
    const pos = view.posAtDOM(el);
    view.dispatch({ selection: { anchor: pos } });
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

  // 0) YAML front matter at the very start → rendered title block.
  const fmMatch = text.match(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/);
  if (fmMatch) {
    const from = 0, to = fmMatch[0].length;
    if (!linesActive(from, to)) {
      decos.push({ from, to, deco: Decoration.replace({ widget: new BlockWidget(fmMatch[0], "renderFrontmatter"), block: true }) });
      replaced.push({ from, to });
    }
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
        if (tableOnly && !inRaw) {
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
        // caret can't enter them (atomic), and editing happens through the
        // resize grip / alignment toolbar. Delete = backspace over the widget.
        if (m) {
          decos.push({ from, to: end, deco: Decoration.replace({ widget: new ImageWidget(m[2].trim(), m[1], width, align), fixed: true }) });
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
        const src = doc.sliceString(from, to);
        decos.push({ from, to, deco: Decoration.replace({ widget: new BlockWidget(src), block: true, fixed: true }) });
        return false;
      }
      if (name === "HorizontalRule") {
        if (!linesActive(from, to)) decos.push({ from, to, deco: Decoration.replace({ widget: new HRWidget() }) });
        return false;
      }
      if (name === "ListMark") {
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
        // Rendered code panel (border + padding + hljs) when the cursor is
        // outside — like the blog; raw fenced lines while editing inside.
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
    if (!spanActive(from, to)) decos.push({ from, to, deco: Decoration.replace({ widget: new MathWidget(bm[1].trim(), true), block: bm[0].includes("\n") }) });
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
    fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans','Apple SD Gothic Neo','Malgun Gothic',Helvetica,Arial,sans-serif",
    fontSize: "16px", lineHeight: "1.5", overflow: "auto",
  },
  ".cm-content": { padding: "44px 8px 200px", maxWidth: "820px", margin: "0 auto", caretColor: "#ff6f61" },
  // CM's default 6px left padding on lines pushes plain text 6px right of block
  // widgets (front matter, callouts, tables), making left edges look misaligned.
  // Zero it so every element shares the same left margin.
  ".cm-line": { paddingLeft: "0" },
  // Kill CM's default focus ring (an ugly 1px dotted outline around the editor).
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "#ff6f61" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "#ffe1dc" },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: "#ffd5ce" },

  // live-preview element styling (matches .qdoc in doc.css)
  ".cm-hd": { fontWeight: "600", color: "#ff6f61", lineHeight: "1.25" },
  ".cm-h1, .cm-h2": { fontSize: "2em" },
  ".cm-h3": { fontSize: "1.45em" },
  ".cm-h4": { fontSize: "1.15em" },
  ".cm-h5, .cm-h6": { fontSize: "1em" },
  ".cm-strong": { fontWeight: "700", color: "#333" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-strike": { textDecoration: "line-through", color: "#999" },
  ".qv-imgwrap": { display: "inline-block", maxWidth: "100%" },
  // fig-align variants: the wrap becomes a full-width block and the inner box
  // (image + controls) is positioned inside it with text-align.
  ".qv-imgwrap.qv-align-left": { display: "block", textAlign: "left" },
  ".qv-imgwrap.qv-align-center": { display: "block", textAlign: "center" },
  ".qv-imgwrap.qv-align-right": { display: "block", textAlign: "right" },
  ".qv-imgbox": { position: "relative", display: "inline-block", maxWidth: "100%" },
  ".qv-img-grip": {
    position: "absolute", right: "-7px", bottom: "-7px", width: "14px", height: "14px",
    borderRadius: "4px", background: "#fff", border: "1.5px solid #ff6f61",
    cursor: "nwse-resize", opacity: "0", transition: "opacity .15s",
  },
  ".qv-imgbox:hover .qv-img-grip": { opacity: "1" },
  ".qv-imgwrap.qv-selected .qv-img-grip": { opacity: "1" },
  ".qv-imgwrap.qv-selected .qv-img-alignbar": { opacity: "1", pointerEvents: "auto" },
  ".qv-imgwrap.qv-selected .qv-img": { outline: "2px solid #ff6f61", outlineOffset: "2px", borderRadius: "2px" },
  ".qv-img-alignbar": {
    position: "absolute", top: "-26px", left: "50%", transform: "translateX(-50%)",
    display: "flex", gap: "2px", padding: "2px", borderRadius: "7px",
    background: "#fff", border: "1px solid #ddd9c3", boxShadow: "0 2px 8px rgba(0,0,0,.08)",
    opacity: "0", transition: "opacity .15s", pointerEvents: "none", whiteSpace: "nowrap",
  },
  ".qv-imgbox:hover .qv-img-alignbar": { opacity: "1", pointerEvents: "auto" },
  ".qv-img-alignbar button": {
    border: "none", background: "transparent", borderRadius: "5px", cursor: "pointer",
    font: "13px/1 -apple-system, system-ui, sans-serif", padding: "3px 7px", color: "#6b675c",
  },
  ".qv-img-alignbar button:hover": { background: "#f0eee2" },
  ".qv-img-alignbar button.on": { background: "#ff6f61", color: "#fff" },
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
  ".qv-bullet": { color: "#8a8a80" },
  ".qv-math": { color: "#333" },
  ".qv-math-block": { textAlign: "center", margin: "2px 0" },
  ".qv-block": { margin: "0", position: "relative" },
  // In-place table editing chrome.
  // Empty cells must stay clickable: give them real size and an invisible
  // filler so a fresh table isn't a stack of hairlines.
  ".qv-hastable": { cursor: "pointer" },
  ".qv-hastable:hover table": { outline: "2px solid #ffd5ce", outlineOffset: "3px", borderRadius: "4px" },
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
    ctxMount: opts.ctxMount || HOST.ctxMount,
    ctxClear: opts.ctxClear || HOST.ctxClear,
    editTable: opts.editTable || HOST.editTable,
    settleCaret: opts.settleCaret || HOST.settleCaret,
    resolveImages: opts.resolveImages || HOST.resolveImages,
  };

  const saveKey = {
    key: "Mod-s",
    run: () => { opts.onSave && opts.onSave(); return true; },
    preventDefault: true,
  };
  const pdfKey = {
    key: "Mod-p",
    run: () => { opts.onPdf && opts.onPdf(); return true; },
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
  const arrowKeys = [
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
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [GFM] }),
      syntaxHighlighting(codeHighlight),
      sourceMode,
      rawOverride,
      livePreview,
      theme,
      EditorView.lineWrapping,
      keymap.of([saveKey, pdfKey, openKey, newKey, ...arrowKeys, indentWithTab, ...defaultKeymap, ...historyKeymap]),
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
  return {
    view,
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

export { create, parseTable, serializeTable };
