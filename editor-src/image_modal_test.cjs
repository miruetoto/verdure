const { webkit } = require("playwright");
(async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.addInitScript(() => {
    const DOC = '# 제목\n\n본문 문단입니다.\n\n![](img/a.png)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n끝\n';
    window.pywebview = { api: {
      get_state: async () => ({ text: DOC, title: "t.qmd", path: "/tmp/t.qmd" }),
      poll: async () => null, save: async () => ({ saved: true }), open_file: async () => null,
      resolve_asset: async () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      track: async () => ({ ok: true }), set_active: async () => ({ ok: true }),
      list_dir: async () => ({ entries: [] }), set_folder: async () => ({ ok: true }),
      autosave: async () => ({ skipped: 1 }) } };
    window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 50));
  });
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(2000);
  const out = {};

  // 1) click the rendered image → image-modal opens
  await page.evaluate(() => document.querySelector(".qv-imgwrap")
    .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
  await page.waitForTimeout(400);
  out.modalOpen = await page.evaluate(() => !document.getElementById("image-modal").hasAttribute("hidden"));

  // 2) set caption + align=center, apply. Size is intentionally controlled by
  // the image corner grip now; the old modal slider no longer exists.
  await page.evaluate(() => document.querySelector('#img-aligns button[data-al="center"]').click());
  await page.evaluate(() => { document.getElementById("img-caption").value = "설명"; });
  await page.evaluate(() => document.getElementById("img-apply").click());
  await page.waitForTimeout(400);
  out.afterApply = await page.evaluate(() => ed.view.state.doc.toString().split("\n").find((l) => l.startsWith("![")));

  // 3) reopen → delete
  await page.evaluate(() => document.querySelector(".qv-imgwrap")
    .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })));
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById("img-delete").click());
  await page.waitForTimeout(400);
  out.afterDelete = await page.evaluate(() => ed.view.state.doc.toString().includes("![]"));

  // 4) insertBlock isolation: insert an image on a non-blank line, expect blank lines around
  await page.evaluate(() => { const v = ed.view; const p = v.state.doc.line(3).to; v.dispatch({ selection: { anchor: p } }); insertImageMarkdown("img/b.png"); });
  await page.waitForTimeout(300);
  out.isolation = await page.evaluate(() => {
    const t = ed.view.state.doc.toString();
    return /본문 문단입니다\.\n\n!\[\]\(img\/b\.png\)\n\n/.test(t);
  });

  // 5) backspace deletes an object: put caret right after the table widget, press Backspace
  out.tableBefore = await page.evaluate(() => /\| A \| B \|/.test(ed.view.state.doc.toString()));
  await page.evaluate(() => {
    const t = ed.view.state.doc.toString();
    const idx = t.indexOf("| 1 | 2 |");
    const end = t.indexOf("\n", idx); // end of last table line
    ed.view.dispatch({ selection: { anchor: end } });
  });
  // click into editor first to focus, then keyboard
  await page.evaluate(() => ed.view.focus());
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(300);
  out.tableAfterBksp = await page.evaluate(() => /\| A \| B \|/.test(ed.view.state.doc.toString()));

  console.log(JSON.stringify(out, null, 1));
  const ok = out.modalOpen &&
    /!\[설명\]\(img\/a\.png\).*fig-align="center"/.test(out.afterApply || "") &&
    out.afterDelete === false && out.isolation &&
    out.tableBefore && out.tableAfterBksp === false;
  if (!ok) process.exitCode = 1;
  await browser.close();
})();
