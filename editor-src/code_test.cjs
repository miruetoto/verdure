const { webkit } = require("playwright");
(async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.addInitScript(() => {
    const DOC = '# 제목\n\n본문\n\n```python\nprint("hi")\n```\n\n끝\n';
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
  out.renderedWhenInactive = await page.evaluate(() => !!document.querySelector(".qv-block pre code"));
  await page.evaluate(() => {
    const v = ed.view;
    const pos = v.state.doc.toString().indexOf('print("hi")') + 2;
    v.dispatch({ selection: { anchor: pos } });
    v.focus();
  });
  await page.waitForTimeout(300);
  out.rawWhenActive = await page.evaluate(() => {
    const lines = [...document.querySelectorAll(".cm-line.cm-codeblock")];
    return lines.length >= 3 && ed.view.state.doc.toString().includes("```python");
  });
  await page.keyboard.insertText("X");
  await page.waitForTimeout(200);
  out.editApplied = await page.evaluate(() => ed.view.state.doc.toString().includes('prXint("hi")'));
  await page.evaluate(() => {
    const v = ed.view;
    v.dispatch({ selection: { anchor: v.state.doc.length } });
  });
  await page.waitForTimeout(300);
  out.renderedAfterLeave = await page.evaluate(() => !!document.querySelector(".qv-block pre code"));
  console.log(JSON.stringify(out, null, 1));
  if (!Object.values(out).every(Boolean)) process.exitCode = 1;
  await browser.close();
})();
