const { webkit } = require("playwright");
(async () => {
  const b = await webkit.launch();
  const p = await b.newPage({ viewport: { width: 760, height: 560 } });
  p.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await p.addInitScript(() => {
    const DOC = '---\ntitle: "리스트 테스트"\n---\n\n## 항목\n\n- 첫째 항목입니다 여기에 긴 문장을 넣어서 줄바꿈이 어떻게 되는지 봅니다 계속계속 이어집니다\n- 둘째 항목\n  - 중첩된 항목 하나\n  - 중첩된 항목 둘\n- 셋째 항목\n\n1. 순서 하나\n2. 순서 둘\n';
    window.pywebview = { api: { get_state: async () => ({ text: DOC, title: "t.qmd", path: "/tmp/t.qmd" }), poll: async()=>null, save: async()=>({saved:true}), open_file: async()=>null, resolve_asset: async()=>null, track: async()=>({ok:1}), set_active: async()=>({ok:1}), list_dir: async()=>({entries:[]}), set_folder: async()=>({ok:1}), autosave: async()=>({saved:1}) } };
    window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 50));
  });
  await p.goto("http://127.0.0.1:8377/index.html");
  await p.waitForTimeout(1600);
  console.log("cm-li count", await p.evaluate(() => document.querySelectorAll(".cm-line.cm-li").length));
  console.log("bullets", await p.evaluate(() => document.querySelectorAll(".qv-bullet").length));
  await p.screenshot({ path: "/private/tmp/claude-501/-Users-cgb-Dropbox-08-prj-quarto-viewer/f26b7efd-4b53-4c32-86ed-ba48b61f934b/scratchpad/list.png" });
  await b.close();
})();
