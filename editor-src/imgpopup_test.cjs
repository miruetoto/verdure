const { webkit } = require("playwright");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAAB4CAIAAAA48Cq8AAAA7UlEQVR42u3SQQ0AAAjEsJONHDShCA+EZ5MqWJbqgXeRAGNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlgYSwWMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjYSy4WAtXe/7Pn5SqAAAAAElFTkSuQmCC";
(async () => {
  const b = await webkit.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 720 } });
  p.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await p.addInitScript((png) => {
    const DOC = '# 제목\n\n본문\n\n![](img/a.png)\n\n끝\n';
    window.pywebview = { api: { get_state: async () => ({ text: DOC, title: "t.qmd", path: "/tmp/t.qmd" }), poll: async()=>null, save: async()=>({saved:1}), open_file: async()=>null, resolve_asset: async()=>png, save_drawing: async()=>({path:"attachments/d.png"}), track: async()=>({ok:1}), set_active: async()=>({ok:1}), list_dir: async()=>({entries:[]}), set_folder: async()=>({ok:1}), autosave: async()=>({saved:1}) } };
    window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 50));
  }, PNG);
  await p.goto("http://127.0.0.1:8377/index.html");
  await p.waitForTimeout(1800);
  const out = {};
  out.gripExists = await p.evaluate(() => !!document.querySelector(".qv-img-grip"));
  // click image → popup opens (no slider), caption field present
  const im = await p.evaluate(() => { const i = document.querySelector(".qv-img"); const r = i.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height*0.6 }; });
  await p.mouse.click(im.x, im.y); await p.waitForTimeout(300);
  out.modalOpen = await p.evaluate(() => !document.getElementById("image-modal").hasAttribute("hidden"));
  out.noSlider = await p.evaluate(() => !document.getElementById("img-width"));
  out.hasCaption = await p.evaluate(() => !!document.getElementById("img-caption"));
  // set caption + apply (no error)
  await p.evaluate(() => { document.getElementById("img-caption").value = "캡션"; document.getElementById("img-apply").click(); });
  await p.waitForTimeout(300);
  out.afterApply = await p.evaluate(() => ed.view.state.doc.toString().split("\n").find(l=>l.startsWith("![")));
  // drag grip to resize
  const g = await p.evaluate(() => { const el = document.querySelector(".qv-img-grip"); const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
  await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(g.x - 60, g.y - 36, { steps: 5 }); await p.mouse.up();
  await p.waitForTimeout(300);
  out.afterResize = await p.evaluate(() => ed.view.state.doc.toString().split("\n").find(l=>l.startsWith("![")));
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
