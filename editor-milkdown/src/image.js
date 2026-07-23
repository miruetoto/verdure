// Quarto images for Pururum — `![caption](src){width=N fig-align="…"}`.
//
// Commonmark parses the image but leaves the `{…}` attribute suffix as plain
// text. A transformer merges the pair into a custom `qvImage` mdast node that
// keeps the EXACT raw token, so serialization is verbatim (round-trip safe).
// The node view renders the resolved image with:
//   - corner-grip drag resize (persists as {width=N})
//   - click → host image popup (align / caption / drawing / delete)
//   - caption (= alt text) under the image, Quarto figure style.

import { $remark, $nodeSchema, $view } from "@milkdown/kit/utils";
import { addDeleteBadge } from "./quarto.js";

export const IHOST = {
  resolveAsset: async () => null,
  editImage: null, // (info, apply, remove, rewrite)
};

const IMG_RE = /^!\[([^\]]*)\]\(([^)\s]*)\)(\{[^}]*\})?$/;

function parseAttrs(attrStr) {
  const width = (/(?:^|[{\s])width=(\d+%?)/.exec(attrStr || "") || [])[1] || null;
  const align = (/fig-align="?(left|center|right)"?/.exec(attrStr || "") || [])[1] || null;
  return { width, align };
}
function buildToken({ alt = "", src = "", width, align }) {
  let t = "![" + alt + "](" + src + ")";
  const parts = [];
  if (width) parts.push("width=" + width);
  if (align) parts.push('fig-align="' + align + '"');
  return parts.length ? t + "{" + parts.join(" ") + "}" : t;
}

// paragraph: [ …, image, text("{…}…"), … ] → merge into qvImage; also convert
// bare images so every image gets the same node view (resize/popup/caption).
export const remarkQvImage = $remark("remarkQvImage", () => () => (tree) => {
  const walk = (node) => {
    if (!node || !Array.isArray(node.children)) return;
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      if (child.type !== "image") { walk(child); continue; }
      let attrStr = null;
      const next = kids[i + 1];
      if (next && next.type === "text" && next.value.startsWith("{")) {
        const m = /^\{[^}]*\}/.exec(next.value);
        if (m) {
          attrStr = m[0];
          const rest = next.value.slice(m[0].length);
          if (rest) next.value = rest; else kids.splice(i + 1, 1);
        }
      }
      kids[i] = {
        type: "qvImage",
        url: child.url || "",
        alt: child.alt || "",
        attrs: attrStr || "",
      };
    }
  };
  walk(tree);
});

export const qvImageSchema = $nodeSchema("qv_image", () => ({
  group: "inline",
  inline: true,
  atom: true,
  attrs: {
    src: { default: "" },
    alt: { default: "" },
    width: { default: null },
    align: { default: null },
  },
  parseDOM: [{
    tag: 'span[data-type="qv_image"]',
    getAttrs: (dom) => ({
      src: dom.dataset.src || "", alt: dom.dataset.alt || "",
      width: dom.dataset.width || null, align: dom.dataset.align || null,
    }),
  }],
  toDOM: (node) => ["span", {
    "data-type": "qv_image", "data-src": node.attrs.src, "data-alt": node.attrs.alt,
    "data-width": node.attrs.width || "", "data-align": node.attrs.align || "",
  }],
  parseMarkdown: {
    match: (node) => node.type === "qvImage",
    runner: (state, node, type) => {
      const { width, align } = parseAttrs(node.attrs);
      state.addNode(type, { src: node.url || "", alt: node.alt || "", width, align });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "qv_image",
    runner: (state, node) => {
      const tok = buildToken({
        alt: node.attrs.alt, src: node.attrs.src,
        width: node.attrs.width, align: node.attrs.align,
      });
      // phrasing `html` serializes verbatim — emits the exact Quarto token.
      state.addNode("html", undefined, tok);
    },
  },
}));

export const qvImageView = $view(qvImageSchema.node, () => (node, view, getPos) => {
  const wrap = document.createElement("span");
  wrap.className = "qv-imgwrap" + (node.attrs.align ? " qv-align-" + node.attrs.align : "");
  wrap.dataset.type = "qv_image";
  const box = document.createElement("span");
  box.className = "qv-imgbox";
  wrap.appendChild(box);
  const img = document.createElement("img");
  img.className = "qv-img";
  box.appendChild(img);
  const cap = document.createElement("span");
  cap.className = "qv-imgcap";
  wrap.appendChild(cap);

  let cur = { ...node.attrs };
  const applyDom = () => {
    img.alt = cur.alt || "";
    img.style.width = cur.width ? (/%$/.test(cur.width) ? cur.width : cur.width + "px") : "";
    wrap.className = "qv-imgwrap" + (cur.align ? " qv-align-" + cur.align : "");
    cap.textContent = cur.alt || "";
    cap.style.display = cur.alt ? "" : "none";
    wrap.dataset.src = cur.src; wrap.dataset.alt = cur.alt;
    wrap.dataset.width = cur.width || ""; wrap.dataset.align = cur.align || "";
  };
  const load = () => {
    const src = cur.src || "";
    if (/^(https?:|data:|asset:|attachment:)/.test(src)) img.src = src;
    else IHOST.resolveAsset(src).then((uri) => { if (uri) img.src = uri; }).catch(() => {});
  };
  applyDom(); load();

  const setAttrs = (patch) => {
    try {
      const pos = getPos();
      const n = view.state.doc.nodeAt(pos);
      if (!n) return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...patch }));
    } catch (_) {}
  };
  const removeNode = () => {
    try {
      const pos = getPos();
      const n = view.state.doc.nodeAt(pos);
      if (!n) return;
      view.dispatch(view.state.tr.delete(pos, pos + n.nodeSize));
    } catch (_) {}
  };

  // Corner grip — drag to resize, persisted as width attr ({width=N}).
  const grip = document.createElement("span");
  grip.className = "qv-img-grip";
  grip.title = "드래그해서 크기 조절";
  box.appendChild(grip);
  grip.addEventListener("mousedown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = img.getBoundingClientRect().width;
    const move = (ev) => {
      const w = Math.max(40, Math.round(startW + (ev.clientX - startX)));
      img.style.width = w + "px";
    };
    const up = (ev) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const w = Math.max(40, Math.round(startW + (ev.clientX - startX)));
      cur.width = String(w); applyDom(); setAttrs({ width: String(w) });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });

  addDeleteBadge(box, removeNode);  // box = image-sized, so × sits on its corner
  // Click (not on the grip) → host image popup.
  wrap.addEventListener("mousedown", (e) => {
    if (e.target === grip || e.target.closest(".qv-delx")) return;
    e.preventDefault(); e.stopPropagation();
    if (!IHOST.editImage) return;
    const apply = (patch) => {
      const next = {};
      if ("caption" in patch) next.alt = patch.caption;
      if ("width" in patch) next.width = patch.width;
      if ("align" in patch) next.align = patch.align;
      cur = { ...cur, ...next }; applyDom(); setAttrs(next);
    };
    const rewrite = ({ src, width, align, caption }) => {
      const next = { src, width: width || null, align: align || null };
      if (caption != null) next.alt = caption;
      cur = { ...cur, ...next }; applyDom(); load(); setAttrs(next);
    };
    IHOST.editImage(
      { src: cur.src, alt: cur.alt, width: cur.width, align: cur.align, preview: img.currentSrc || img.src },
      apply, removeNode, rewrite
    );
  });

  return {
    dom: wrap,
    update: (n) => {
      if (n.type.name !== "qv_image") return false;
      const changedSrc = n.attrs.src !== cur.src;
      cur = { ...n.attrs };
      applyDom();
      if (changedSrc) load();
      return true;
    },
    ignoreMutation: () => true,
  };
});

export const imagePlugins = [remarkQvImage, qvImageSchema, qvImageView].flat();
export { buildToken as buildImageToken };
