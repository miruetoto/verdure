const { webkit } = require("playwright");
(async () => {
  const b = await webkit.launch();
  const p = await b.newPage({ viewport: { width: 900, height: 640 } });
  p.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await p.addInitScript(() => {
    const DOC = '---\ntitle: "신록예찬"\n---\n\n## 사용법\n\n- 첫째 항목입니다\n- 둘째 항목입니다\n  - 중첩 항목\n\n인라인 수식 $e^{i\\pi}+1=0$ 과 블록 수식을 지원합니다.\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n';
    window.pywebview = { api: { get_state: async () => ({ text: DOC, title: "t.qmd", path: "/tmp/t.qmd" }), poll: async()=>null, save: async()=>({saved:1}), open_file: async()=>null, resolve_asset: async()=>null, track: async()=>({ok:1}), set_active: async()=>({ok:1}), list_dir: async()=>({entries:[]}), set_folder: async()=>({ok:1}), autosave: async()=>({saved:1}) } };
    window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 50));
  });
  await p.goto("http://127.0.0.1:8377/index.html");
  await p.waitForTimeout(2200);
  await p.evaluate(() => ed.view.dispatch({ selection: { anchor: ed.view.state.doc.length } }));
  await p.waitForTimeout(400);
  console.log("font", await p.evaluate(() => getComputedStyle(document.querySelector(".cm-scroller")).fontFamily));
  console.log("fontLoaded", await p.evaluate(() => document.fonts.check("16px NanumMyeongjo")));
  await p.screenshot({ path: "/private/tmp/claude-501/-Users-cgb-Dropbox-08-prj-quarto-viewer/f26b7efd-4b53-4c32-86ed-ba48b61f934b/scratchpad/font.png" });
  await b.close();
})();
