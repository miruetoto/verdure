const { webkit } = require("playwright");
(async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.addInitScript(() => {
    const DOC = '# 제목\n\n본문\n\n::: {.callout-note}\n원래 내용\n:::\n\n끝\n';
    window.pywebview = { api: {
      get_state: async () => ({ text: DOC, title: "t.qmd", path: "/tmp/t.qmd" }),
      poll: async () => null, save: async () => ({ saved: true }), open_file: async () => null,
      resolve_asset: async () => null, track: async () => ({ ok: true }), set_active: async () => ({ ok: true }),
      list_dir: async () => ({ entries: [] }), set_folder: async () => ({ ok: true }), autosave: async () => ({ saved: true }) } };
    window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 50));
  });
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(1800);
  const out = {};
  // open callout popup via the editor API path (grab ops), then FORCE a re-render
  // that disconnects the widget DOM, THEN apply — must still reflect.
  const co = await page.evaluate(() => { const c = document.querySelector(".callout-body"); const r = c.getBoundingClientRect(); return { x: r.x + 20, y: r.y + 8 }; });
  await page.mouse.click(co.x, co.y); await page.waitForTimeout(250);
  out.opened = await page.evaluate(() => !document.getElementById("callout-modal").hasAttribute("hidden"));
  // force rebuild of decorations (re-render widget → old el detached)
  await page.evaluate(() => { const v = ed.view; v.dispatch({ selection: { anchor: 0 } }); v.dispatch({ selection: { anchor: v.state.doc.length } }); });
  await page.waitForTimeout(100);
  // now edit + apply
  await page.evaluate(() => { document.getElementById("co-body").value = "바뀐 내용"; document.querySelector('#co-types button[data-co="tip"]').click(); document.getElementById("co-apply").click(); });
  await page.waitForTimeout(300);
  out.doc = await page.evaluate(() => ed.view.state.doc.toString());
  out.reflected = out.doc.includes("바뀐 내용") && out.doc.includes("callout-tip");
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
