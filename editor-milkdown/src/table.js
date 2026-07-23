// Table popup editing for Pururum.
//
// Native GFM tables stay editable INLINE (cell clicks, typing — better than the
// old widget). Double-click opens the host's spreadsheet popup for the heavy
// operations (add/remove rows/columns, per-column alignment, centering,
// caption) — same modal as before, signature:
//   editTable(pipeText, centered, caption, replace(text, center, cap), remove)

import { $prose } from "@milkdown/kit/utils";
import { Plugin } from "@milkdown/kit/prose/state";
import { Slice, Fragment } from "@milkdown/kit/prose/model";
import { serializerCtx, parserCtx, schemaCtx } from "@milkdown/kit/core";

export const THOST = { editTable: null };

export function tablePlugin(getCtx) {
  return $prose(() => new Plugin({
    props: {
      handleDoubleClickOn(view, _pos, node, nodePos) {
        if (!THOST.editTable) return false;
        if (node.type.name !== "table") return false;
        const ctx = getCtx();
        if (!ctx) return false;
        let pipeText = "";
        try {
          const serializer = ctx.get(serializerCtx);
          const schema = ctx.get(schemaCtx);
          const tmp = schema.topNodeType.create(null, Fragment.from(node));
          pipeText = serializer(tmp).trim();
        } catch (_) { return false; }
        const replace = (text, center, cap) => {
          let md = center ? "::: {.center}\n" + text + "\n:::" : text;
          if (cap && cap.trim()) md += "\n\n: " + cap.trim();
          try {
            const parser = ctx.get(parserCtx);
            const doc = parser(md);
            if (!doc) return;
            const cur = view.state.doc.nodeAt(nodePos);
            if (!cur) return;
            view.dispatch(view.state.tr.replaceRange(
              nodePos, nodePos + cur.nodeSize, new Slice(doc.content, 0, 0)));
          } catch (_) {}
        };
        const remove = () => {
          try {
            const cur = view.state.doc.nodeAt(nodePos);
            if (!cur) return;
            view.dispatch(view.state.tr.delete(nodePos, nodePos + cur.nodeSize));
          } catch (_) {}
        };
        THOST.editTable(pipeText, false, "", replace, remove);
        return true;
      },
    },
  }));
}
