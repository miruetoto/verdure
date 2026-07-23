// Pururum — Vditor(IR) adapter exposing the QVEditor facade index.html speaks.
//
// Why Vditor: the user's model is SOURCE-FAITHFUL editing — what you type is
// what the file contains; the editor may hide markers when the caret leaves,
// but must never rewrite your text (ProseMirror input-rules did, and read as
// "지맘대로 바꾼다"). Vditor's IR mode is exactly Typora's behavior, with
// math/tables/code built in, fully offline (vendored dist).
//
// Front matter stays OUT of the editor (title bar above it) — the approach
// that fixed the boot-caret/slab/Space family of bugs in the Milkdown round.
/* global Vditor */
(function () {
  "use strict";

  /* ---------------- markdown helpers (shared with the popups) ------------- */
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
  function parseCallout(src) {
    const lines = src.split("\n");
    const head = lines[0] || "";
    const type = (/\.callout-([A-Za-z]+)/.exec(head) || [])[1] || "note";
    const title = (/title\s*=\s*["']([^"']*)["']/.exec(head) || [])[1] || "";
    let end = lines.length - 1;
    while (end > 0 && !/^:{3,}\s*$/.test(lines[end])) end--;
    const body = lines.slice(1, end).join("\n").replace(/^\n+|\n+$/g, "");
    return { type, title, body };
  }
  function serializeCallout(m) {
    const type = m.type || "note";
    const t = (m.title || "").trim();
    const head = "::: {.callout-" + type + (t ? ' title="' + t.replace(/"/g, "'") + '"' : "") + "}";
    const body = (m.body || "").replace(/\s+$/, "");
    return head + "\n" + (body ? body + "\n" : "") + ":::";
  }
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

  /* ---------------- front matter split (title bar above the editor) ------- */
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

  /* ------------------------------ create --------------------------------- */
  function create(parent, opts) {
    opts = opts || {};
    let onChange = opts.onChange || null;

    const init = splitFm(opts.doc || "");
    let fmText = init.fm;
    let pendingBody = init.body;   // authoritative until Vditor is ready
    let vd = null, vdReady = false;
    let wantFocus = false;

    // Layout: holder(scroll) > [fmBar, vditor host]; textarea sibling for ⌘E.
    const holder = document.createElement("div");
    holder.className = "qv-vditor qdoc";
    const fmBar = document.createElement("div");
    fmBar.className = "qv-fmbar";
    const host = document.createElement("div");
    host.className = "qv-vd-host";
    holder.appendChild(fmBar);
    holder.appendChild(host);
    parent.appendChild(holder);

    const srcTa = document.createElement("textarea");
    srcTa.className = "qv-source";
    srcTa.setAttribute("spellcheck", "false");
    srcTa.style.display = "none";
    parent.appendChild(srcTa);
    let sourceOn = false;

    const fireChange = () => { if (onChange) onChange(getValue()); };

    /* front-matter bar (same UX as before: click → popup, hover ×) */
    const fmReplace = (yamlSrc) => {
      const m = FM_RE.exec(yamlSrc);
      fmText = m ? m[1] : yamlSrc;
      paintFm(); fireChange();
    };
    const fmRemove = () => { fmText = null; paintFm(); fireChange(); };
    function paintFm() {
      holder.classList.toggle("has-fm", fmText != null);
      if (fmText == null) { fmBar.style.display = "none"; fmBar.innerHTML = ""; return; }
      fmBar.style.display = "";
      fmBar.innerHTML = opts.renderFrontmatter
        ? opts.renderFrontmatter(fmText)
        : "<pre>" + fmText.replace(/[&<]/g, (c) => (c === "&" ? "&amp;" : "&lt;")) + "</pre>";
      const x = document.createElement("button");
      x.className = "qv-delx"; x.type = "button"; x.title = "삭제"; x.textContent = "×";
      x.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); fmRemove(); });
      fmBar.classList.add("qv-obj");
      fmBar.appendChild(x);
    }
    fmBar.addEventListener("mousedown", (e) => {
      if (e.target.closest(".qv-delx")) return;
      e.preventDefault(); e.stopPropagation();
      if (opts.editFrontmatter) opts.editFrontmatter(fmText || "", fmReplace, fmRemove);
    });
    paintFm();

    /* Vditor (IR mode — Typora behavior, source-faithful) */
    vd = new Vditor(host, {
      mode: "ir",
      value: pendingBody,
      height: "auto",
      cache: { enable: false },
      toolbar: [],
      lang: "ko_KR",
      cdn: "vendor/vditor",
      preview: {
        // KaTeX for now — vditor's bundled MathJax throws ("Cannot set property
        // Package … only a getter") in its loader; MathJax parity is tracked in
        // REQUIREMENTS §3.7-1 as an open item.
        math: { engine: "KaTeX", inlineDigit: true },
        markdown: { toc: false, mark: false, autoSpace: false, fixTermTypo: false },
        hljs: { lineNumber: false, style: "github" },
      },
      input() { fireChange(); },
      after() {
        vdReady = true;
        if (vd.getValue() !== pendingBody) vd.setValue(pendingBody);
        if (wantFocus) { wantFocus = false; try { vd.focus(); } catch (_) {} }
        watchFences();
      },
    });

    const getBody = () => {
      try { if (vdReady) return vd.getValue(); } catch (_) {}
      return pendingBody;
    };
    const setBody = (text) => {
      pendingBody = text;
      if (vdReady) { try { vd.setValue(text); } catch (_) {} }
    };

    const getValue = () => (sourceOn ? srcTa.value : joinFm(fmText, getBody()));
    const setValue = (text) => {
      if (sourceOn) { srcTa.value = text; return; }
      const s = splitFm(text);
      fmText = s.fm; paintFm();
      setBody(s.body);
    };

    const contentEl = () => holder.querySelector(".vditor-ir .vditor-reset") || host;

    // Quiet styling for Quarto fenced-div lines (::: {...} / :::). The TEXT is
    // untouched — source-faithful — we only tag the block elements so CSS can
    // dim the markers and paint a type-colored accent on callout openers.
    const FENCE_OPEN = /^:{3,}\s*\{(.+)\}\s*$/;
    const FENCE_CLOSE = /^:{3,}\s*$/;
    function tagFences() {
      const rootEl = contentEl();
      if (!rootEl) return;
      for (const el of rootEl.children) {
        const t = (el.textContent || "").trim();
        const open = FENCE_OPEN.exec(t);
        if (open) {
          el.setAttribute("data-qv-fence", "open");
          const co = /\.callout-([A-Za-z]+)/.exec(open[1]);
          if (co) el.setAttribute("data-qv-callout", co[1]);
          else el.removeAttribute("data-qv-callout");
        } else if (FENCE_CLOSE.test(t)) {
          el.setAttribute("data-qv-fence", "close");
          el.removeAttribute("data-qv-callout");
        } else if (el.hasAttribute("data-qv-fence")) {
          el.removeAttribute("data-qv-fence");
          el.removeAttribute("data-qv-callout");
        }
      }
    }
    let fenceTimer = 0;
    function watchFences() {
      const rootEl = contentEl();
      if (!rootEl) return;
      tagFences();
      new MutationObserver(() => {
        clearTimeout(fenceTimer);
        fenceTimer = setTimeout(tagFences, 120);
      }).observe(rootEl, { childList: true, subtree: true, characterData: true });
    }

    const focusEditor = () => {
      if (sourceOn) { srcTa.focus(); return; }
      if (!vdReady) { wantFocus = true; return; }
      try { vd.focus(); } catch (_) {}
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

    const insertBlock = (md) => {
      if (sourceOn) { srcTa.setRangeText("\n\n" + md + "\n\n", srcTa.selectionStart, srcTa.selectionEnd, "end"); return; }
      try { vd.insertValue("\n\n" + md + "\n\n", true); vd.focus(); } catch (_) {}
    };

    const viewFacade = {
      get hasFocus() {
        if (sourceOn) return document.activeElement === srcTa;
        const c = contentEl();
        return !!(c && (document.activeElement === c || c.contains(document.activeElement)));
      },
      get contentDOM() { return contentEl(); },
      get scrollDOM() { return holder; },
    };

    return {
      view: viewFacade,
      getValue,
      setValue,
      focus: focusEditor,
      insertBlock,
      setSource,
      isSource: () => sourceOn,
      freshState: (text) => ({ qvText: text, qvScroll: 0 }),
      getState: () => ({ qvText: getValue(), qvScroll: holder.scrollTop || 0 }),
      setState: (s) => { if (s && typeof s.qvText === "string") { if (sourceOn) setSource(false); setValue(s.qvText); } },
      destroy: () => { try { vd && vd.destroy(); } catch (_) {} holder.remove(); srcTa.remove(); },
    };
  }

  window.QVEditor = {
    create,
    parseTable, serializeTable,
    parseCallout, serializeCallout,
    parseTabset, serializeTabset,
  };
})();
