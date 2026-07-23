// Math for Pururum's Milkdown editor — $inline$ and $$block$$, rendered with
// MathJax CHTML (NOT KaTeX): the requirement is pixel-parity with the 신록예찬
// blog, which is Quarto/MathJax CHTML (docs/REQUIREMENTS.md §3).
//
// remark-math contributes the mdast `inlineMath` / `math` node types and their
// $-delimiter serialization, so the markdown round-trip is handled by remark;
// we only supply the ProseMirror schema + a MathJax-rendering node view.

import { $remark, $nodeSchema, $inputRule, $view } from "@milkdown/kit/utils";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import remarkMath from "remark-math";

// Host hook: the app supplies MathJax rendering (same helpers index.html already
// has). Fallback = plain \(..\) text so content is never lost.
let renderMath = null; // (el, tex, display) => boolean (true = sync-rendered)
export function setMathRenderer(fn) { renderMath = fn; }

// MathJax loads lazily in the app, so the FIRST formulas paint before the
// library is ready. The async fallback proved racy on the real WKWebView (the
// node view can be recreated while typeset runs, leaving the visible DOM
// unrendered — formulas showed as blank). Instead: every paint that could not
// sync-render registers here, and a single poller repaints them all through
// the SYNC path the moment the renderer starts succeeding. Idempotent, DOM-
// recreation-proof (the registry always holds the CURRENT dom of each view).
const pending = new Set(); // Set<() => boolean> — repaint fns returning success
let poller = 0;
function pollPending() {
  if (poller) return;
  poller = setInterval(() => {
    for (const fn of [...pending]) { if (fn()) pending.delete(fn); }
    if (!pending.size) { clearInterval(poller); poller = 0; }
  }, 250);
}

function paint(el, tex, display) {
  const trySync = () => {
    if (!renderMath) return false;
    try { return renderMath(el, tex, display) === true; } catch (_) { return false; }
  };
  el.textContent = display ? `\\[${tex}\\]` : `\\(${tex}\\)`;
  if (trySync()) return;
  pending.add(trySync);
  pollPending();
}

export const remarkMathPlugin = $remark("remarkMath", () => remarkMath);

// Pandoc/Quarto treats `$$…$$` as DISPLAY math even on a single line, but
// micromark only makes a flow `math` node when the delimiters sit on their own
// lines — a one-liner becomes `inlineMath`. Milkdown passes the source text as
// the vfile, so we can look at the original delimiters: a paragraph whose only
// child is an inlineMath written with $$ becomes a math (display) block.
export const remarkQuartoBlockMath = $remark("remarkQuartoBlockMath", () => () => (tree, file) => {
  const src = String(file && (file.value ?? file) || "");
  const walk = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    node.children = node.children.map((child) => {
      if (
        child.type === "paragraph" &&
        child.children && child.children.length === 1 &&
        child.children[0].type === "inlineMath"
      ) {
        const m = child.children[0];
        const off = m.position && m.position.start ? m.position.start.offset : null;
        if (off != null && src.slice(off, off + 2) === "$$") {
          return { type: "math", value: m.value, position: child.position };
        }
      }
      // Mid-paragraph $$…$$: keep it inline but flag display styling (pandoc
      // renders double-dollar as display math wherever it appears).
      if (Array.isArray(child.children)) {
        for (const g of child.children) {
          if (g.type === "inlineMath" && g.position && g.position.start) {
            if (src.slice(g.position.start.offset, g.position.start.offset + 2) === "$$") g.qvDisplay = true;
          }
        }
      }
      walk(child);
      return child;
    });
  };
  walk(tree);
});

/* ---------------- inline $…$ ---------------- */
export const mathInlineSchema = $nodeSchema("math_inline", () => ({
  group: "inline",
  inline: true,
  atom: true,
  attrs: { value: { default: "" }, display: { default: false } },
  parseDOM: [{
    tag: 'span[data-type="math_inline"]',
    getAttrs: (dom) => ({ value: dom.dataset.value || "", display: dom.dataset.display === "true" }),
  }],
  toDOM: (node) => ["span", { "data-type": "math_inline", "data-value": node.attrs.value, "data-display": String(!!node.attrs.display) }, node.attrs.value],
  parseMarkdown: {
    match: (node) => node.type === "inlineMath",
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value || "", display: !!node.qvDisplay });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "math_inline",
    runner: (state, node) => {
      // Display-styled inline math must keep its $$…$$ delimiters — emit the
      // raw token verbatim (phrasing html); plain inline uses remark-math.
      if (node.attrs.display) state.addNode("html", undefined, "$$" + node.attrs.value + "$$");
      else state.addNode("inlineMath", undefined, node.attrs.value);
    },
  },
}));

export const mathInlineView = $view(mathInlineSchema.node, () => (node) => {
  const dom = document.createElement("span");
  const disp = !!node.attrs.display;
  dom.className = disp ? "qv-math math display qv-math-block" : "qv-math math inline";
  dom.dataset.type = "math_inline";
  dom.dataset.value = node.attrs.value;
  dom.dataset.display = String(disp);
  paint(dom, node.attrs.value, disp);
  return {
    dom,
    update: (n) => {
      if (n.type.name !== "math_inline") return false;
      if (n.attrs.value !== dom.dataset.value) {
        dom.dataset.value = n.attrs.value;
        paint(dom, n.attrs.value, !!n.attrs.display);
      }
      return true;
    },
    // Let ProseMirror handle selection/clicks natively — the node is an atom,
    // so a click selects it (NodeSelection) and Backspace deletes it whole.
    ignoreMutation: () => true,
  };
});

// Typing "$x^2$" converts to an inline math atom.
export const mathInlineInputRule = $inputRule((ctx) =>
  new InputRule(/(?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$$/,
    (state, match, start, end) => {
      const value = match[1];
      const type = mathInlineSchema.type(ctx);
      return state.tr.replaceRangeWith(start, end, type.create({ value }));
    })
);

// Typing "$$a+b=c$$" converts to a DISPLAY math block (pandoc treats one-line
// $$…$$ as display; without this rule the text just sat there unrendered).
export const mathBlockInputRule = $inputRule((ctx) =>
  new InputRule(/\$\$([^$\n]+?)\$\$$/,
    (state, match, start, end) => {
      const value = match[1].trim();
      const type = mathBlockSchema.type(ctx);
      const $start = state.doc.resolve(start);
      // Only when the $$…$$ is the entire paragraph — replace the whole block.
      if ($start.parent.textContent.trim() !== match[0].trim()) return null;
      const from = $start.before(), to = $start.after();
      return state.tr.replaceRangeWith(from, to, type.create({ value }));
    })
);

/* ---------------- block $$…$$ ---------------- */
export const mathBlockSchema = $nodeSchema("math_block", () => ({
  group: "block",
  atom: true,
  attrs: { value: { default: "" } },
  parseDOM: [{
    tag: 'div[data-type="math_block"]',
    getAttrs: (dom) => ({ value: dom.dataset.value || "" }),
  }],
  toDOM: (node) => ["div", { "data-type": "math_block", "data-value": node.attrs.value }, node.attrs.value],
  parseMarkdown: {
    match: (node) => node.type === "math",
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value || "" });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "math_block",
    runner: (state, node) => {
      state.addNode("math", undefined, node.attrs.value);
    },
  },
}));

export const mathBlockView = $view(mathBlockSchema.node, () => (node) => {
  const dom = document.createElement("div");
  dom.className = "qv-math math display qv-math-block";
  dom.dataset.type = "math_block";
  dom.dataset.value = node.attrs.value;
  paint(dom, node.attrs.value, true);
  return {
    dom,
    update: (n) => {
      if (n.type.name !== "math_block") return false;
      if (n.attrs.value !== dom.dataset.value) {
        dom.dataset.value = n.attrs.value;
        paint(dom, n.attrs.value, true);
      }
      return true;
    },
    ignoreMutation: () => true,
  };
});

// Mid-paragraph "$a+b$" → inline node with display styling (the block rule
// above takes the whole-paragraph case first; when it returns null this fires).
export const mathDisplayInlineInputRule = $inputRule((ctx) =>
  new InputRule(/\$\$([^$\n]+?)\$\$/,
    (state, match, start, end) => {
      const type = mathInlineSchema.type(ctx);
      return state.tr.replaceRangeWith(start, end, type.create({ value: match[1].trim(), display: true }));
    })
);

export const mathPlugins = [
  remarkMathPlugin,
  remarkQuartoBlockMath,
  mathInlineSchema,
  mathInlineView,
  mathInlineInputRule,
  mathBlockInputRule,
  mathDisplayInlineInputRule,
  mathBlockSchema,
  mathBlockView,
].flat();
