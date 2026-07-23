// Pururum — Milkdown(ProseMirror) live-preview editor.
//
// Replaces the CodeMirror decoration engine. Rationale (docs/REQUIREMENTS.md):
// CM drew the caret/selection from cached source-text coordinates that drifted
// from the rendered widgets in the real WKWebView (caret jump after inline
// math, zoom selection drift, dead clicks). In ProseMirror the caret moves in
// the rendered DOM itself, so that entire failure class disappears.
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
import { Slice } from "@milkdown/kit/prose/model";
import { $prose } from "@milkdown/kit/utils";
import { keymap as proseKeymap } from "@milkdown/kit/prose/keymap";
import { mathPlugins, setMathRenderer } from "./math.js";
import { quartoPlugins, QHOST } from "./quarto.js";
import { imagePlugins, IHOST } from "./image.js";
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

function create(parent, opts = {}) {
  Object.assign(HOST, opts);
  // Quarto node hooks (fenced divs + frontmatter).
  if (opts.renderBlock) QHOST.renderBlock = opts.renderBlock;
  if (opts.renderFrontmatter) QHOST.renderFrontmatter = opts.renderFrontmatter;
  if (opts.editFrontmatter) QHOST.editFrontmatter = opts.editFrontmatter;
  if (opts.editCallout) QHOST.editCallout = opts.editCallout;
  if (opts.editTabset) QHOST.editTabset = opts.editTabset;
  if (opts.enhance) QHOST.enhance = opts.enhance;
  else if (opts.resolveImages) QHOST.enhance = opts.resolveImages; // app passes its enhance() as resolveImages
  if (opts.resolveAsset) IHOST.resolveAsset = opts.resolveAsset;
  if (opts.editImage) IHOST.editImage = opts.editImage;

  let editor = null;
  let currentMarkdown = opts.doc || "";
  let onChange = opts.onChange || null;

  const holder = document.createElement("div");
  holder.className = "qv-milkdown qdoc";
  parent.appendChild(holder);

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
    "Mod-s": () => { opts.onSave && opts.onSave(); return true; },
    "Mod-p": () => { opts.onPdf && opts.onPdf(); return true; },
    "Mod-o": () => { opts.onOpen && opts.onOpen(); return true; },
    "Mod-n": () => { opts.onNew && opts.onNew(); return true; },
  }));

  async function boot(markdown) {
    editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, holder);
        ctx.set(defaultValueCtx, markdown);
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
          currentMarkdown = md;
          if (onChange) onChange(md);
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
      .use(appKeys)
      .create();
    // The app may setValue/setState before the async boot finishes (e.g. the
    // first tab is added right after create()). Catch up to the latest text.
    if (currentMarkdown !== markdown) setValue(currentMarkdown);
    return editor;
  }

  const ready = boot(currentMarkdown);

  const getValue = () => {
    if (!editor) return currentMarkdown;
    try {
      return editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const serializer = ctx.get(serializerCtx);
        return serializer(view.state.doc);
      });
    } catch (_) { return currentMarkdown; }
  };

  const setValue = (text) => {
    currentMarkdown = text;
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
    } catch (e) { console.error("setValue failed", e); }
  };

  const pmView = () => {
    try { return editor ? editor.action((c) => c.get(editorViewCtx)) : null; } catch (_) { return null; }
  };

  // Source mode: swap the rendered editor for a plain textarea over the same
  // markdown; toggling back re-parses. (⌘E in the app.)
  const srcTa = document.createElement("textarea");
  srcTa.className = "qv-source";
  srcTa.setAttribute("spellcheck", "false");
  srcTa.style.display = "none";
  parent.appendChild(srcTa);
  let sourceOn = false;
  const setSource = (on) => {
    on = !!on;
    if (on === sourceOn) return;
    sourceOn = on;
    if (on) {
      srcTa.value = getValue();
      holder.style.display = "none";
      srcTa.style.display = "";
      srcTa.focus();
    } else {
      holder.style.display = "";
      srcTa.style.display = "none";
      setValue(srcTa.value);
      focusEditor();
    }
  };
  srcTa.addEventListener("input", () => { currentMarkdown = srcTa.value; if (onChange) onChange(srcTa.value); });

  const focusEditor = () => {
    if (sourceOn) { srcTa.focus(); return; }
    const v = pmView(); if (v) v.focus();
  };

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
    getValue: () => (sourceOn ? srcTa.value : getValue()),
    setValue: (t) => { if (sourceOn) { srcTa.value = t; currentMarkdown = t; } else setValue(t); },
    focus: focusEditor,
    insertBlock,
    setSource,
    isSource: () => sourceOn,
    // Tab-state emulation: plain snapshots of markdown + scroll position.
    freshState: (text) => ({ qvText: text, qvScroll: 0 }),
    getState: () => ({ qvText: sourceOn ? srcTa.value : getValue(), qvScroll: holder.scrollTop || 0 }),
    setState: (s) => { if (s && typeof s.qvText === "string") { if (sourceOn) setSource(false); setValue(s.qvText); } },
    destroy: () => { try { editor && editor.destroy(); } catch (_) {} holder.remove(); srcTa.remove(); },
  };
}

export { create };
