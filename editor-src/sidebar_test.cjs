// Sidebar test: openFolder renders the tree; clicking a file opens a tab;
// clicking a folder expands lazily.
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
  await page.setViewport({ width: 1100, height: 760 });
  page.on("pageerror", e => console.log("[pageerror]", e.message));
  await page.evaluateOnNewDocument(() => {
    const TREE = {
      "/proj": { path: "/proj", name: "proj", entries: [
        { name: "sub", path: "/proj/sub", is_dir: true },
        { name: "a.qmd", path: "/proj/a.qmd", is_dir: false },
        { name: "b.md", path: "/proj/b.md", is_dir: false },
      ] },
      "/proj/sub": { path: "/proj/sub", name: "sub", entries: [
        { name: "inner.qmd", path: "/proj/sub/inner.qmd", is_dir: false },
      ] },
    };
    const doc = "---\ntitle: T\n---\n\n본문\n";
    window.pywebview = { api: {
      get_state: async () => ({ text: doc, title: "제목 없음", path: "", folder: "/proj" }),
      read_path: async (p) => ({ text: "---\ntitle: " + p + "\n---\n\nx\n", title: p.split("/").pop(), path: p }),
      list_dir: async (p) => TREE[p] || { path: p, name: p, entries: [] },
      open_file: async () => null, open_folder: async () => null, save: async () => ({ saved: 1 }),
      set_active: async () => ({ ok: 1 }), track: async () => ({ ok: 1 }), poll: async () => null,
      resolve_asset: async () => null, paste_image: async () => ({ skipped: "text" }), save_drawing: async () => ({ path: "a.png" }),
      open_url: async () => ({ opened: 1 }), open_export: async () => ({ opened: 1 }),
    } };
    window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 40));
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 900));

  const bad = [];
  const pause = (ms = 200) => new Promise(r => setTimeout(r, ms));

  // sidebar visible on boot (launched on a folder)
  const shown = await page.evaluate(() => !document.getElementById("sidebar").hasAttribute("hidden"));
  if (!shown) bad.push("사이드바가 폴더 부팅 시 안 보임");
  const rootName = await page.evaluate(() => document.getElementById("sidebar-root").textContent);
  if (rootName !== "proj") bad.push("루트 이름 = " + rootName);
  const rows = await page.evaluate(() => [...document.querySelectorAll("#sidebar-tree > div > .tree-row .tn")].map(e => e.textContent));
  if (JSON.stringify(rows) !== JSON.stringify(["sub", "a.qmd", "b.md"])) bad.push("트리 최상위 = " + JSON.stringify(rows));

  // editor should NOT have auto-opened files — just the blank tab
  const tabTitles = await page.evaluate(() => [...document.querySelectorAll("#tabs .tab .tab-name")].map(e => e.textContent));
  if (JSON.stringify(tabTitles) !== JSON.stringify(["제목 없음"])) bad.push("폴더 열 때 파일 자동 오픈됨: " + JSON.stringify(tabTitles));

  // click a file → opens a tab
  await page.evaluate(() => { const r = [...document.querySelectorAll("#sidebar-tree .tree-row.file")].find(r => r.dataset.path === "/proj/a.qmd"); r.click(); });
  await pause(250);
  const afterClick = await page.evaluate(() => [...document.querySelectorAll("#tabs .tab .tab-name")].map(e => e.textContent));
  if (!afterClick.includes("a.qmd")) bad.push("파일 클릭이 탭 안 엶: " + JSON.stringify(afterClick));
  const activeMarked = await page.evaluate(() => { const r = [...document.querySelectorAll("#sidebar-tree .tree-row.file")].find(r => r.dataset.path === "/proj/a.qmd"); return r.classList.contains("active"); });
  if (!activeMarked) bad.push("열린 파일이 트리에서 하이라이트 안 됨");

  // expand folder → shows child
  await page.evaluate(() => { const r = [...document.querySelectorAll("#sidebar-tree .tree-row.dir")].find(r => r.dataset.path === "/proj/sub"); r.click(); });
  await pause(250);
  const hasInner = await page.evaluate(() => [...document.querySelectorAll("#sidebar-tree .tree-row .tn")].some(e => e.textContent === "inner.qmd"));
  if (!hasInner) bad.push("폴더 확장이 하위 파일 안 보여줌");

  await browser.close(); server.close();
  if (bad.length) { console.log("❌ 사이드바 테스트 실패:\n - " + bad.join("\n - ")); process.exit(1); }
  console.log("✅ 사이드바 테스트 전부 통과");
})();
