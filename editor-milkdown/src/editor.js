// Pururum — Milkdown(ProseMirror) live-preview editor.
//
// Replaces the CodeMirror decoration engine. Rationale (docs/REQUIREMENTS.md):
// CM drew the caret/selection from cached source-text coordinates that drifted
// from the rendered widgets in the real WKWebView (caret jump after inline
// math, zoom selection drift, dead clicks). In ProseMirror the caret moves in
// the rendered DOM itself, so that entire failure class disappears.
//
// Front matter is NOT part of the ProseMirror document. A document whose first
// block is an atom breeds a whole family of WKWebView problems (boot-time
// NodeSelection flooding the block peach, invisible caret, gap-cursor chips on
// Space, dead clicks). Instead the leading `--- yaml ---` is split off and
// rendered as a fixed title bar ABOVE the editor; getValue()/setValue() splice
// it back, so the app and the saved file never notice the difference.
//
// Bundled as a single IIFE (global `QVEditor`) so the app stays offline, with
// a create() surface compatible with the previous CodeMirror bundle.

import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx, parserCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { trailing } from "@milkdown/kit/plugin/trailing";
import { TextSelection } from "@milkdown/kit/prose/state";
import { Slice } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { keymap as proseKeymap } from "@milkdown/kit/prose/keymap";
import { sinkListItem } from "@milkdown/kit/prose/schema-list";
import { mathPlugins, setMathRenderer } from "./math.js";
import { quartoPlugins, QHOST, addDeleteBadge } from "./quarto.js";
import { imagePlugins, IHOST } from "./image.js";
import { tablePlugin, THOST } from "./table.js";
export { parseTable, serializeTable, parseCallout, serializeCallout, parseTabset, serializeTabset } from "./helpers.js";

/* Host callbacks (same shape the CM bundle used). */
let HOST = {
  resolveAsset: async () => null,
  typeset: async () => {},
  editTable: null,
  editTabset: null,
  editCallout: null,
  editFrontmatter: null,
  editImage: null,
};

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
function splitFm(text) {
  const m = FM_RE.exec(text || "");
  if (!m) return { fm: null, body: text || "" };
  return { fm: m[1], body: (text || "").slice(m[0].length).replace(/^\r?\n/, "") };
}
function joinFm(fm, body) {
  if (fm == null) return body;
  return "---\n" + fm + "\n---\n\n" + body;
}

function create(parent, opts = {}) {
  Object.assign(HOST, opts);
  // Quarto node hooks (fenced divs).
  if (opts.renderBlock) QHOST.renderBlock = opts.renderBlock;
  if (opts.renderFrontmatter) QHOST.renderFrontmatter = opts.renderFrontmatter;
  if (opts.editFrontmatter) QHOST.editFrontmatter = opts.editFrontmatter;
  if (opts.editCallout) QHOST.editCallout = opts.editCallout;
  if (opts.editTabset) QHOST.editTabset = opts.editTabset;
  if (opts.enhance) QHOST.enhance = opts.enhance;
  else if (opts.resolveImages) QHOST.enhance = opts.resolveImages; // app passes its enhance() as resolveImages
  if (opts.resolveAsset) IHOST.resolveAsset = opts.resolveAsset;
  if (opts.editImage) IHOST.editImage = opts.editImage;
  if (opts.editTable) THOST.editTable = opts.editTable;

  let editor = null;
  let wantFocus = false;   // focus() arrived before the async boot finished
  const init = splitFm(opts.doc || "");
  let fmText = init.fm;          // yaml between the ---, or null when absent
  let currentBody = init.body;   // markdown body (front matter excluded)
  let onChange = opts.onChange || null;

  // holder = scroller. Inside: the front-matter title bar, then the editor.
  const holder = document.createElement("div");
  holder.className = "qv-milkdown qdoc";
  const fmBar = document.createElement("div");
  fmBar.className = "qv-fmbar";
  const edRoot = document.createElement("div");
  edRoot.className = "qv-edroot";
  holder.appendChild(fmBar);
  holder.appendChild(edRoot);
  parent.appendChild(holder);

  const fireChange = () => { if (onChange) onChange(getValue()); };

  const fmReplaceFromPopup = (yamlSrc) => {
    // The popup hands back the full `--- … ---` block or bare yaml; normalize.
    const m = FM_RE.exec(yamlSrc);
    fmText = m ? m[1] : yamlSrc;
    paintFm(); fireChange();
  };
  const fmRemoveFromPopup = () => { fmText = null; paintFm(); fireChange(); };
  function paintFm() {
    holder.classList.toggle("has-fm", fmText != null);
    if (fmText == null) { fmBar.style.display = "none"; fmBar.innerHTML = ""; return; }
    fmBar.style.display = "";
    fmBar.innerHTML = QHOST.renderFrontmatter
      ? QHOST.renderFrontmatter(fmText)
      : "<pre>" + fmText.replace(/[&<]/g, (c) => (c === "&" ? "&amp;" : "&lt;")) + "</pre>";
    addDeleteBadge(fmBar, fmRemoveFromPopup);
  }
  fmBar.addEventListener("mousedown", (e) => {
    if (e.target.closest(".qv-delx")) return;
    e.preventDefault(); e.stopPropagation();
    if (QHOST.editFrontmatter) QHOST.editFrontmatter(fmText || "", fmReplaceFromPopup, fmRemoveFromPopup);
  });
  paintFm();

  if (opts.typesetSync || opts.typeset) {
    // Adapt the host's MathJax helpers to the math node views. Prefer the
    // synchronous path (final width immediately); fall back to async typeset.
    setMathRenderer((el, tex, display) => {
      if (opts.typesetSync && opts.typesetSync(el, tex, display)) return true;
      el.textContent = display ? `\\[${tex}\\]` : `\\(${tex}\\)`;
      return opts.typeset ? opts.typeset(el) : false;
    });
  }

  // App-level shortcuts that must also fire while the editor has focus.
  const appKeys = $prose(() => proseKeymap({
    // Typing "- " at the start of a list item nests it one level (the bullet
    // already exists — leaving a literal "- " inside the item, like the old
    // behavior, read as a bug). Space is only intercepted for that exact case.
    "Space": (state, dispatch, view) => {
      const { $from, empty } = state.selection;
      if (!empty) return false;
      if ($from.parent.type.name !== "paragraph" || $from.parentOffset !== 1) return false;
      if ($from.parent.textContent[0] !== "-") return false;
      const li = state.schema.nodes.list_item;
      if (!li || $from.node(-1).type !== li) return false;
      if (dispatch) {
        dispatch(state.tr.delete($from.pos - 1, $from.pos));
        sinkListItem(li)(view.state, view.dispatch);
      }
      return true;
    },
    "Mod-s": () => { opts.onSave && opts.onSave(); return true; },
    "Mod-p": () => { opts.onPdf && opts.onPdf(); return true; },
    "Mod-o": () => { opts.onOpen && opts.onOpen(); return true; },
    "Mod-n": () => { opts.onNew && opts.onNew(); return true; },
  }));

  async function boot(bodyMarkdown) {
    editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, edRoot);
        ctx.set(defaultValueCtx, bodyMarkdown);
        // Serialize the way the previous editor (and Quarto docs) write
        // markdown: "-" bullets, minimal list indent, no forced blank lines.
        ctx.update(remarkStringifyOptionsCtx, (o) => ({
          ...o, bullet: "-", listItemIndent: "one", rule: "-", tightDefinitions: true,
          // Milkdown's list schemas carry `spread` as the STRING "false"/"true",
          // and mdast-util-to-markdown treats any truthy value as loose — so
          // every list serialized loose (blank lines between items). Restore
          // real tight/loose behavior by joining on the string value.
          join: [
            (left, right, parent) => {
              if (parent.type === "list" || parent.type === "listItem") {
                const s = parent.spread;
                if (s === false || s === "false") return 0;
              }
              return undefined;
            },
          ],
        }));
        ctx.get(listenerCtx).markdownUpdated((_ctx, md) => {
          currentBody = md;
          fireChange();
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(mathPlugins)
      .use(quartoPlugins)
      .use(imagePlugins)
      .use(history)
      .use(listener)
      .use(clipboard)
      .use(cursor)
      .use(trailing)   // always keep a trailing paragraph to type into
      .use(tablePlugin(() => (editor ? editor.ctx : null)))  // dblclick → table popup
      .use(appKeys)
      .create();
    // The app may setValue/setState/focus before the async boot finishes
    // (the first tab is added right after create()). Catch up.
    if (currentBody !== bodyMarkdown) setBody(currentBody);
    if (wantFocus) { wantFocus = false; focusEditor(); }
    return editor;
  }

  const ready = boot(currentBody);

  const getBody = () => {
    if (!editor) return currentBody;
    try {
      return editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const serializer = ctx.get(serializerCtx);
        return serializer(view.state.doc);
      });
    } catch (_) { return currentBody; }
  };
  const setBody = (text) => {
    currentBody = text;
    if (!editor) return;
    try {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const parser = ctx.get(parserCtx);
        const doc = parser(text);
        if (!doc) return;
        const state = view.state;
        view.dispatch(state.tr.replace(0, state.doc.content.size, new Slice(doc.content, 0, 0)));
      });
    } catch (e) { console.error("setBody failed", e); }
  };

  const pmView = () => {
    try { return editor ? editor.action((c) => c.get(editorViewCtx)) : null; } catch (_) { return null; }
  };

  // Source mode: swap the rendered editor for a plain textarea over the FULL
  // markdown (front matter included); toggling back re-splits. (⌘E in the app.)
  const srcTa = document.createElement("textarea");
  srcTa.className = "qv-source";
  srcTa.setAttribute("spellcheck", "false");
  srcTa.style.display = "none";
  parent.appendChild(srcTa);
  let sourceOn = false;

  const getValue = () => (sourceOn ? srcTa.value : joinFm(fmText, getBody()));
  const setValue = (text) => {
    if (sourceOn) { srcTa.value = text; return; }
    const { fm, body } = splitFm(text);
    fmText = fm; paintFm();
    setBody(body);
  };

  const setSource = (on) => {
    on = !!on;
    if (on === sourceOn) return;
    if (on) {
      srcTa.value = joinFm(fmText, getBody());
      sourceOn = true;
      holder.style.display = "none";
      srcTa.style.display = "";
      srcTa.focus();
    } else {
      sourceOn = false;
      holder.style.display = "";
      srcTa.style.display = "none";
      setValue(srcTa.value);
      focusEditor();
    }
  };
  srcTa.addEventListener("input", () => { if (onChange) onChange(srcTa.value); });

  const caretToEnd = () => {
    const v = pmView(); if (!v) return;
    try {
      const end = v.state.doc.content.size;
      v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(end), -1)));
    } catch (_) {}
  };

  const focusEditor = () => {
    if (sourceOn) { srcTa.focus(); return; }
    const v = pmView();
    if (!v) { wantFocus = true; return; }   // boot not done yet — defer
    if (!(v.state.selection instanceof TextSelection)) caretToEnd();
    v.focus();
  };

  // Clicking the empty area below the content lands the caret at the end,
  // like CodeMirror's scroller did.
  holder.addEventListener("mousedown", (e) => {
    if (sourceOn) return;
    const v = pmView(); if (!v) return;
    if (e.target !== holder && e.target !== edRoot && !e.target.classList?.contains("milkdown")) return;
    e.preventDefault();
    caretToEnd();
    v.focus();
  });

  // Insert markdown block(s) at the caret. Blank-line isolation (REQ §2.2) is
  // automatic: ProseMirror inserts real block nodes and the serializer emits
  // them with surrounding blank lines.
  const insertBlock = (md) => {
    if (sourceOn) { srcTa.setRangeText("\n\n" + md + "\n\n", srcTa.selectionStart, srcTa.selectionEnd, "end"); return; }
    try {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const parser = ctx.get(parserCtx);
        const doc = parser(md);
        if (!doc) return;
        const tr = view.state.tr.replaceSelection(new Slice(doc.content, 0, 0));
        view.dispatch(tr.scrollIntoView());
        view.focus();
      });
    } catch (e) { console.error("insertBlock failed", e); }
  };

  // CM-compat facade over the ProseMirror view (the app touches these).
  const viewFacade = {
    get hasFocus() { const v = pmView(); return sourceOn ? document.activeElement === srcTa : !!(v && v.hasFocus()); },
    get contentDOM() { const v = pmView(); return v ? v.dom : holder; },
    get scrollDOM() { return holder; },
  };

  return {
    ready,
    view: viewFacade,
    getValue,
    setValue,
    focus: focusEditor,
    insertBlock,
    setSource,
    isSource: () => sourceOn,
    // Tab-state emulation: plain snapshots of markdown + scroll position.
    freshState: (text) => ({ qvText: text, qvScroll: 0 }),
    getState: () => ({ qvText: getValue(), qvScroll: holder.scrollTop || 0 }),
    setState: (s) => { if (s && typeof s.qvText === "string") { if (sourceOn) setSource(false); setValue(s.qvText); } },
    destroy: () => { try { editor && editor.destroy(); } catch (_) {} holder.remove(); srcTa.remove(); },
  };
}

export { create };
