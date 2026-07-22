const { JSDOM } = require("jsdom");
const fs = require("fs");
const dom = new JSDOM(`<!doctype html><body><div id="host"></div></body>`, { pretendToBeVisual: true });
const { window } = dom;

// The bundle runs via indirect eval in Node's global scope, so mirror the DOM
// globals CM6 reads as bare identifiers onto `global`.
class NoObs { observe() {} disconnect() {} takeRecords() { return []; } unobserve() {} }
const names = ["document","navigator","matchMedia","getComputedStyle",
  "requestAnimationFrame","cancelAnimationFrame","DOMParser","Node","NodeFilter","Range","Text",
  "Window","Document","HTMLElement","Element","Event","CustomEvent","KeyboardEvent","InputEvent","DOMRect","getSelection"];
for (const k of names) if (window[k]) global[k] = window[k];
global.window = window;
global.document = window.document;
global.MutationObserver = window.MutationObserver || NoObs;
global.ResizeObserver = window.ResizeObserver || NoObs;
if (!global.requestAnimationFrame) global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);

global.__QVDBG=true;
const code = fs.readFileSync(__dirname + "/../quarto_viewer/static/vendor/cm6/editor.bundle.js", "utf8");
(0, eval)(code + "; global.__QV = QVEditor;");
const QV = global.__QV;
const document = window.document;
console.log("QVEditor.create is fn:", typeof QV.create === "function");

const host = document.getElementById("host");
const doc = [
  "---","title: 테스트","author: cgb","---","",
  "# 제목1","## 제목2","",
  "**굵게** *기울임* `code` ~~취소~~ [링크](http://x)","",
  "인라인 수식 $a^2+b^2$ 과 블록:","","$$\\int_0^1 x\\,dx$$","",
  "![그림](pic.png)","",
  "::: {.callout-note}","노트 안 **굵게** 와 $x^2$",":::","",
  "::: {.panel-tabset}","## A","aaa","## B","bbb",":::","",
  "> 인용문","","```python","import numpy as np","print(1)","```","",
].join("\n");

let err = null, api = null;
try {
  api = QV.create(host, {
    doc,
    renderBlock: (s) => '<div class="qdoc">' + s.replace(/[&<]/g, c => c === "&" ? "&amp;" : "&lt;") + "</div>",
    resolveAsset: async () => "data:image/png;base64,iVBORw0KGgo=", typeset: async () => {}, resolveImages: async () => {},
    onChange: () => {}, onSave: () => {}, onPdf: () => {}, onOpen: () => {},
  });
} catch (e) { err = e; }
console.log("create() MY-code error:", err ? String(err.stack || err.message).split("\n").slice(0, 6).join("\n") : "NONE ✅");

if (api) {
  console.log("getValue round-trips:", api.getValue() === doc);
  console.log(".cm-editor mounted:", !!host.querySelector(".cm-editor"));
  console.log("live-preview marks: hd=", !!host.querySelector(".cm-hd"),
              "strong=", !!host.querySelector(".cm-strong"),
              "em=", !!host.querySelector(".cm-em"),
              "code=", !!host.querySelector(".cm-code"),
              "link=", !!host.querySelector(".cm-link"));
  console.log("widgets: img=", !!host.querySelector(".qv-img"),
              "block=", !!host.querySelector(".qv-block"),
              "math=", !!host.querySelector(".qv-math"));
  try {
    api.view.dispatch({ selection: { anchor: doc.indexOf("굵게") } });
    api.view.dispatch({ changes: { from: doc.length, insert: "\n끝 **b** $z$" } });
    console.log("selection+edit dispatch: OK (decorations rebuilt without throwing)");
  } catch (e) { console.log("dispatch error:", String(e.stack || e.message).split("\n").slice(0, 4).join("\n")); }
}
