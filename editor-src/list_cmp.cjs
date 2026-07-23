const { webkit } = require("playwright");
(async () => {
  const b = await webkit.launch();
  const p = await b.newPage({ viewport: { width: 720, height: 520 } });
  p.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await p.addInitScript(() => {
    const DOC = '---\ntitle: "리스트"\n---\n\n## 목록\n\n- 좋아\n  - 중첩 하나입니다\n  - 중첩 둘입니다\n    - 더 깊은 항목\n- 둘째\n\n다음 문단.\n';
    window.pywebview = { api: { get_state: async () => ({ text: DOC, title: "t.qmd", path: "/tmp/t.qmd" }), poll: async()=>null, save: async()=>({saved:1}), open_file: async()=>null, resolve_asset: async()=>null, track: async()=>({ok:1}), set_active: async()=>({ok:1}), list_dir: async()=>({entries:[]}), set_folder: async()=>({ok:1}), autosave: async()=>({saved:1}) } };
    window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 50));
  });
  await p.goto("http://127.0.0.1:8377/index.html");
  await p.waitForTimeout(1500);
  // move caret out of the list so all markers render as bullets (not raw)
  await p.evaluate(() => ed.view.dispatch({ selection: { anchor: ed.view.state.doc.length } }));
  await p.waitForTimeout(300);
  await p.screenshot({ path: "/private/tmp/claude-501/-Users-cgb-Dropbox-08-prj-quarto-viewer/f26b7efd-4b53-4c32-86ed-ba48b61f934b/scratchpad/ed_list.png" });
  // Also render the SAME list through the app's preview pipeline (doc.css) for comparison
  const html = await p.evaluate(() => { const h = document.createElement("div"); h.className="qdoc"; h.innerHTML = mdToHtml("- 좋아\n  - 중첩 하나입니다\n  - 중첩 둘입니다\n    - 더 깊은 항목\n- 둘째"); document.body.appendChild(h); const r=h.getBoundingClientRect(); return {ok:true}; });
  await b.close();
})();
