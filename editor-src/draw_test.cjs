// Paint popup test: open modal, draw a stroke, insert → markdown + save_drawing called.
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
    const doc = "---\ntitle: T\n---\n\n본문\n";
    window.__savedDrawing = null;
    window.pywebview = { api: {
      get_state: async () => ({ text: doc, title: "t.qmd", path: "/t.qmd" }),
      read_path: async () => ({ text: doc, title: "t.qmd", path: "/t.qmd" }),
      open_file: async () => null, save: async () => ({ saved: 1, title: "t.qmd", path: "/t.qmd" }),
      set_active: async () => ({ ok: 1 }), track: async () => ({ ok: 1 }), poll: async () => null,
      resolve_asset: async () => null, paste_image: async () => ({ skipped: "text" }),
      save_drawing: async (url) => { window.__savedDrawing = url; return { path: "attachments/draw-x.png" }; },
      open_url: async () => ({ opened: 1 }), open_export: async () => ({ opened: 1 }),
    } };
    window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 40));
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 900));

  const bad = [];
  const pause = (ms = 200) => new Promise(r => setTimeout(r, ms));

  // open menu → 그림
  await page.click("#btn-insert"); await pause(120);
  await page.click('#insert-menu button[data-snip="draw"]'); await pause(200);
  const open = await page.evaluate(() => !document.getElementById("draw-modal").hasAttribute("hidden"));
  if (!open) bad.push("그림 모달이 열리지 않음");

  // draw a stroke on the canvas
  const box = await page.evaluate(() => { const c = document.getElementById("draw-canvas"); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 90);
  await page.mouse.move(box.x + 200, box.y + 60);
  await page.mouse.up();
  await pause(150);
  // the canvas should now have non-transparent pixels
  const painted = await page.evaluate(() => {
    const c = document.getElementById("draw-canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
    return false;
  });
  if (!painted) bad.push("캔버스에 그림이 그려지지 않음");

  // insert
  await page.click("#draw-insert"); await pause(200);
  const closed = await page.evaluate(() => document.getElementById("draw-modal").hasAttribute("hidden"));
  if (!closed) bad.push("삽입 후 모달이 닫히지 않음");
  const savedUrl = await page.evaluate(() => window.__savedDrawing);
  if (!savedUrl || !savedUrl.startsWith("data:image/png;base64,")) bad.push("save_drawing에 PNG data URL이 전달되지 않음");
  // the saved image must be cropped to the drawn area (not the full 880 canvas),
  // but keep the drawn size (no normalization)
  const dim = await page.evaluate((u) => new Promise((res) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.src = u; }), savedUrl);
  if (dim.w >= 860 || dim.h >= 540) bad.push("전체 캔버스가 그대로 저장됨(크롭 안됨): " + JSON.stringify(dim));
  if (Math.max(dim.w, dim.h) < 30) bad.push("크롭 결과가 너무 작음: " + JSON.stringify(dim));
  const v = await page.evaluate(() => ed.getValue());
  if (!v.includes("![](attachments/draw-x.png)")) bad.push("이미지 마크다운이 삽입되지 않음: " + JSON.stringify(v.slice(-40)));

  await browser.close(); server.close();
  if (bad.length) { console.log("❌ 그림판 테스트 실패:\n - " + bad.join("\n - ")); process.exit(1); }
  console.log("✅ 그림판 테스트 전부 통과");
})();
