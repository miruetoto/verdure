// Quarto-specific syntax for Pururum's Milkdown editor.
//
// Two node families, both ATOMS that keep their RAW markdown as `value`:
//
//  - quarto_frontmatter — the leading `--- yaml ---` block, rendered as the
//    Quarto title block; click opens the host's frontmatter popup.
//  - quarto_block — a fenced div (`::: {...}` … `:::`): callouts, tabsets,
//    .center wrappers. Rendered by the host's markdown pipeline
//    (HOST.renderBlock); click opens the matching popup (callout/tabset).
//
// Storing the raw source verbatim gives a PERFECT round-trip for exactly the
// constructs Quarto cares about (REQUIREMENTS §2.5-1), and reuses the app's
// existing popup editors unchanged (§2.3 — modal editing is deliberate).

import { $remark, $nodeSchema, $view } from "@milkdown/kit/utils";
import remarkFrontmatter from "remark-frontmatter";

// Uniform hover-× delete badge (REQ §2.1): every object deletes the same way.
export function addDeleteBadge(el, onDelete) {
  el.classList.add("qv-obj");
  const x = document.createElement("button");
  x.className = "qv-delx"; x.type = "button"; x.title = "삭제"; x.textContent = "×";
  x.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); onDelete(); });
  el.appendChild(x);
}

/* Host hooks (wired by editor.js create()). */
export const QHOST = {
  renderBlock: (src) => { const pre = document.createElement("pre"); pre.textContent = src; return pre.outerHTML; },
  renderFrontmatter: null, // (yamlSrc) => html string for the title block
  editFrontmatter: null,   // (src, replace, remove)
  editCallout: null,       // (src, replace, remove)
  editTabset: null,        // (src, replace, remove)
  enhance: null,           // async (el) => post-process rendered HTML (tabs, hljs, math)
};

/* ---------------- frontmatter ---------------- */
// third arg = initial options ctx value; remark-frontmatter throws on `{}`.
export const remarkFrontmatterPlugin = $remark("remarkFrontmatter", () => remarkFrontmatter, "yaml");

export const frontmatterSchema = $nodeSchema("quarto_frontmatter", () => ({
  group: "block",
  atom: true,
  attrs: { value: { default: "" } },
  parseDOM: [{ tag: 'div[data-type="quarto_frontmatter"]', getAttrs: (dom) => ({ value: dom.dataset.value || "" }) }],
  toDOM: (node) => ["div", { "data-type": "quarto_frontmatter", "data-value": node.attrs.value }],
  parseMarkdown: {
    match: (node) => node.type === "yaml",
    runner: (state, node, type) => { state.addNode(type, { value: node.value || "" }); },
  },
  toMarkdown: {
    match: (node) => node.type.name === "quarto_frontmatter",
    runner: (state, node) => { state.addNode("yaml", undefined, node.attrs.value); },
  },
}));

export const frontmatterView = $view(frontmatterSchema.node, () => (node, view, getPos) => {
  const dom = document.createElement("div");
  dom.className = "qv-fmblock";
  dom.dataset.type = "quarto_frontmatter";
  const paint = (value) => {
    dom.dataset.value = value;
    dom.innerHTML = QHOST.renderFrontmatter
      ? QHOST.renderFrontmatter(value)
      : "<pre>---\n" + value.replace(/[&<]/g, (c) => (c === "&" ? "&amp;" : "&lt;")) + "\n---</pre>";
    addDeleteBadge(dom, remove);  // innerHTML wiped the badge — re-attach
  };
  const replace = (newValue) => {
    try {
      const pos = getPos();
      const n = view.state.doc.nodeAt(pos);
      if (!n) return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { value: newValue }));
    } catch (_) {}
  };
  const remove = () => {
    try {
      const pos = getPos();
      const n = view.state.doc.nodeAt(pos);
      if (!n) return;
      view.dispatch(view.state.tr.delete(pos, pos + n.nodeSize));
    } catch (_) {}
  };
  paint(node.attrs.value);
  dom.addEventListener("mousedown", (e) => {
    if (e.target.closest(".qv-delx")) return;
    e.preventDefault(); e.stopPropagation();
    if (QHOST.editFrontmatter) QHOST.editFrontmatter(dom.dataset.value, replace, remove);
  });
  return {
    dom,
    update: (n) => {
      if (n.type.name !== "quarto_frontmatter") return false;
      if (n.attrs.value !== dom.dataset.value) paint(n.attrs.value);
      return true;
    },
    ignoreMutation: () => true,
  };
});

/* ---------------- fenced divs (::: {...} … :::) ---------------- */

// Region detection runs on the RAW SOURCE (line-based, depth-counted): fenced
// div lines aren't reliably their own mdast nodes (no blank line → they merge
// into one paragraph), so mdast-level detection can't be robust. We find the
// byte regions in the source, then rebuild root.children around them.
function findFencedRegions(src) {
  const lines = src.split("\n");
  const regions = [];
  let offset = 0, open = null, depth = 0;
  for (const line of lines) {
    const isOpen = /^:{3,}\s*\{.*\}\s*$/.test(line);
    const isClose = /^:{3,}\s*$/.test(line);
    if (open === null && isOpen) { open = offset; depth = 1; }
    else if (open !== null && isOpen) depth++;
    else if (open !== null && isClose) {
      depth--;
      if (depth === 0) { regions.push([open, offset + line.length]); open = null; }
    }
    offset += line.length + 1;
  }
  return regions;
}

export const remarkQuartoDivs = $remark("remarkQuartoDivs", () => () => (tree, file) => {
  const src = String(file && (file.value ?? file) || "");
  if (!src.includes(":::")) return;
  const regions = findFencedRegions(src);
  if (!regions.length) return;
  const startOf = (n) => (n.position && n.position.start ? n.position.start.offset : null);
  const endOf = (n) => (n.position && n.position.end ? n.position.end.offset : null);
  const out = [];
  let ri = 0;
  for (const child of tree.children) {
    const s = startOf(child), e = endOf(child);
    // Emit any region that starts before this node.
    while (ri < regions.length && s != null && regions[ri][1] <= s) {
      out.push({ type: "quartoDiv", value: src.slice(regions[ri][0], regions[ri][1]) });
      ri++;
    }
    const inRegion = ri < regions.length && s != null && e != null && s >= regions[ri][0] && e <= regions[ri][1];
    if (!inRegion) out.push(child);
  }
  while (ri < regions.length) {
    out.push({ type: "quartoDiv", value: src.slice(regions[ri][0], regions[ri][1]) });
    ri++;
  }
  tree.children = out;
});

export const quartoBlockSchema = $nodeSchema("quarto_block", () => ({
  group: "block",
  atom: true,
  attrs: { value: { default: "" } },
  parseDOM: [{ tag: 'div[data-type="quarto_block"]', getAttrs: (dom) => ({ value: dom.dataset.value || "" }) }],
  toDOM: (node) => ["div", { "data-type": "quarto_block", "data-value": node.attrs.value }],
  parseMarkdown: {
    match: (node) => node.type === "quartoDiv",
    runner: (state, node, type) => { state.addNode(type, { value: node.value || "" }); },
  },
  toMarkdown: {
    match: (node) => node.type.name === "quarto_block",
    // mdast `html` nodes stringify VERBATIM — exactly what raw source needs.
    runner: (state, node) => { state.addNode("html", undefined, node.attrs.value); },
  },
}));

function kindOf(src) {
  if (/^:{3,}\s*\{[^}]*\.callout-/.test(src)) return "callout";
  if (/^:{3,}\s*\{[^}]*\.panel-tabset/.test(src)) return "tabset";
  return "div";
}

export const quartoBlockView = $view(quartoBlockSchema.node, () => (node, view, getPos) => {
  const dom = document.createElement("div");
  dom.className = "qv-block qdoc";
  dom.dataset.type = "quarto_block";
  const paint = (value) => {
    dom.dataset.value = value;
    dom.innerHTML = QHOST.renderBlock(value);
    if (QHOST.enhance) { try { QHOST.enhance(dom); } catch (_) {} }
    addDeleteBadge(dom, remove);  // innerHTML wiped the badge — re-attach
  };
  const replace = (newValue) => {
    try {
      const pos = getPos();
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { value: newValue }));
    } catch (_) {}
  };
  const remove = () => {
    try {
      const pos = getPos();
      const n = view.state.doc.nodeAt(pos);
      if (!n) return;
      view.dispatch(view.state.tr.delete(pos, pos + n.nodeSize));
    } catch (_) {}
  };
  paint(node.attrs.value);
  dom.addEventListener("mousedown", (e) => {
    // Tab clicks inside a rendered tabset switch tabs; anything else edits.
    if (e.target.closest(".tab-btn") || e.target.closest(".qv-delx")) return;
    e.preventDefault(); e.stopPropagation();
    const kind = kindOf(dom.dataset.value);
    if (kind === "callout" && QHOST.editCallout) QHOST.editCallout(dom.dataset.value, replace, remove);
    else if (kind === "tabset" && QHOST.editTabset) QHOST.editTabset(dom.dataset.value, replace, remove);
  });
  // Tabset tab switch — toggle active classes IN PLACE, never rebuild the bar
  // (rebuilding mid-click ate the first click; hard-won rule, REQ §2.4).
  dom.addEventListener("click", (e) => {
    const b = e.target.closest(".tab-btn");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const idx = b.dataset.idx;
    dom.querySelectorAll(".tab-btn").forEach((x) => x.classList.toggle("active", x.dataset.idx === idx));
    dom.querySelectorAll(".tab-panel").forEach((x) => x.classList.toggle("active", x.dataset.idx === idx));
  });
  return {
    dom,
    update: (n) => {
      if (n.type.name !== "quarto_block") return false;
      if (n.attrs.value !== dom.dataset.value) paint(n.attrs.value);
      return true;
    },
    ignoreMutation: () => true,
  };
});

export const quartoPlugins = [
  remarkFrontmatterPlugin,
  frontmatterSchema,
  frontmatterView,
  remarkQuartoDivs,
  quartoBlockSchema,
  quartoBlockView,
].flat();
