// Insert-menu test: clicking 삽입 items inserts correct Quarto snippets and they render.
const puppeteer = require("puppeteer-core");
const http = require("http"); const path = require("path"); const fs = require("fs");
const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const p = path.join(STATIC, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
  if (!p.startsWith(STATIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 800 });
  page.on("pageerror", e => console.log("[pageerror]", e.message));
  await page.evaluateOnNewDocument(() => {
    const doc = "---\ntitle: T\n---\n\n본문 시작\n";
    window.pywebview = { api: {
      get_state: async () => ({ text: doc, title: "t.qmd", path: "/t.qmd" }),
      read_path: async () => ({ text: doc, title: "t.qmd", path: "/t.qmd" }),
      open_file: async () => null, save: async () => ({ saved: true, title: "t.qmd", path: "/t.qmd" }),
      set_active: async () => ({ ok: 1 }), track: async () => ({ ok: 1 }), poll: async () => null,
      resolve_asset: async () => null, paste_image: async () => ({ skipped: "text" }), open_url: async () => ({ opened: 1 }), open_export: async () => ({ opened: 1 }),
    } };
    window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 40));
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 900));

  const bad = [];
  const val = () => page.evaluate(() => ed.getValue());
  const pause = (ms = 250) => new Promise(r => setTimeout(r, ms));

  // put cursor at end of body, then insert each block via the menu
  async function insertViaMenu(snip) {
    await page.evaluate(() => { ed.view.focus(); ed.view.dispatch({ selection: { anchor: ed.view.state.doc.length } }); });
    await page.click("#btn-insert"); await pause(120);
    const visible = await page.evaluate(() => !document.getElementById("insert-menu").hasAttribute("hidden"));
    if (!visible) bad.push("menu did not open");
    await page.click(`#insert-menu button[data-snip="${snip}"]`); await pause(200);
  }

  await insertViaMenu("callout");
  await page.evaluate(() => document.getElementById("co-apply").click());
  await pause();
  let v = await val();
  if (!v.includes("::: {.callout-note}") || !/:::\s*$/m.test(v)) bad.push("callout-note snippet wrong: " + JSON.stringify(v.slice(-60)));

  await insertViaMenu("table");
  await page.evaluate(() => document.getElementById("tbl-apply").click());
  await pause();
  v = await val();
  if (!/\| 열 1 \| 열 2 \|/.test(v) || !/\| --- \| --- \|/.test(v)) bad.push("table snippet wrong");

  await insertViaMenu("tabset");
  await page.evaluate(() => document.getElementById("tabset-apply").click());
  await pause();
  v = await val();
  if (!v.includes("::: {.panel-tabset}") || !v.includes("## 탭 1") || !v.includes("## 탭 2")) bad.push("tabset snippet wrong");

  await insertViaMenu("code");
  v = await val();
  if (!v.includes("```\n\n```")) bad.push("code snippet wrong");

  // no stray sentinel token left in the document
  if (v.includes("«»")) bad.push("cursor sentinel « » leaked into document");

  // Move cursor away and confirm the callout renders as a widget
  await page.evaluate(() => { ed.view.dispatch({ selection: { anchor: 0 } }); });
  await pause(300);
  const rendered = await page.evaluate(() => !!document.querySelector(".qv-block .callout, .qv-block table, .qv-block .tabset"));
  if (!rendered) bad.push("inserted blocks did not render as widgets");

  await browser.close(); server.close();
  if (bad.length) { console.log("❌ 삽입 테스트 실패:\n - " + bad.join("\n - ")); process.exit(1); }
  console.log("✅ 삽입 테스트 전부 통과");
})();
