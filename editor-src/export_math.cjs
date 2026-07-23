const { webkit } = require("playwright");
const fs = require("fs");
const OUT = "/private/tmp/claude-501/-Users-cgb-Dropbox-08-prj-quarto-viewer/f26b7efd-4b53-4c32-86ed-ba48b61f934b/scratchpad";
(async () => {
  const b = await webkit.launch();
  const p = await b.newPage({ viewport: { width: 900, height: 500 } });
  p.on("pageerror", (e) => console.log("[pageerror]", e.message));
  let captured = null;
  await p.exposeFunction("__capture", (h) => { captured = h; });
  await p.addInitScript(() => {
    const DOC = '# 수식 테스트\n\n인라인 수식 $e^{i\\pi}+1=0$ 과 $a^2+b^2=c^2$ 을 봅니다.\n\n블록:\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n';
    window.pywebview = { api: { get_state: async () => ({ text: DOC, title: "t.qmd", path: "/tmp/t.qmd" }), poll: async()=>null, save: async()=>({saved:1}), open_file: async()=>null, resolve_asset: async()=>null, track: async()=>({ok:1}), set_active: async()=>({ok:1}), list_dir: async()=>({entries:[]}), set_folder: async()=>({ok:1}), autosave: async()=>({saved:1}), open_export: async (html) => { await window.__capture(html); return { opened: true }; } } };
    window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 50));
  });
  await p.goto("http://127.0.0.1:8377/index.html");
  await p.waitForTimeout(2200);
  await p.evaluate(() => doPdf());
  await p.waitForTimeout(2500);
  if (!captured) { console.log("NO HTML CAPTURED"); await b.close(); return; }
  fs.writeFileSync(OUT + "/export.html", captured);
  console.log("html bytes", captured.length, "hasMjxFontFace", /@font-face/.test(captured), "mjxRules", (captured.match(/mjx-c/g)||[]).length);
  // render standalone
  const p2 = await b.newPage({ viewport: { width: 900, height: 500 } });
  await p2.goto("file://" + OUT + "/export.html");
  await p2.waitForTimeout(1500);
  await p2.screenshot({ path: OUT + "/export.png" });
  await b.close();
})();
