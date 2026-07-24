// Tab behavior regression test: multi-document tabs, switching, dirty tracking,
// close/dedupe, welcome fallback, blank startup, and QV.openPath
// (single-instance delivery).
const puppeteer = require("puppeteer-core");
const http = require("http"); const path = require("path"); const fs = require("fs");
const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const p = path.join(STATIC, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
  if (!p.startsWith(STATIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(res);
});

const mkdoc = (title, body) => `---\ntitle: ${title}\n---\n\n${body}\n`;

(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 800 });
  page.on("pageerror", e => console.log("[pageerror]", e.message));

  await page.evaluateOnNewDocument(() => {
    // In-memory filesystem the mock backend reads/writes.
    const FS = {
      "/a.qmd": "---\ntitle: A\n---\n\nalpha\n",
      "/b.qmd": "---\ntitle: B\n---\n\nbeta\n",
      "/c.qmd": "---\ntitle: C\n---\n\ngamma\n",
    };
    const WELCOME = "---\ntitle: 푸르름\n---\n\n환영\n";
    const base = (p) => (p.split("/").pop());
    let active = "/a.qmd";
    let tracked = [];
    window.__FS = FS; window.__mtime = {};   // test can bump mtime
    const stateOf = (p) => {
      if (!p) return { text: WELCOME, title: "환영합니다", path: "" };
      return { text: FS[p] ?? WELCOME, title: base(p), path: p };
    };
    window.__pollQueue = [];   // test pushes changed-doc arrays here
    window.pywebview = { api: {
      get_state: async () => stateOf("/a.qmd"),
      read_path: async (p) => stateOf(p),
      open_file: async () => stateOf("/b.qmd"),
      save: async (text) => { if (active) FS[active] = text; return { saved: true, title: base(active) || "환영합니다", path: active || "" }; },
      set_active: async (p) => { active = p; return { ok: true }; },
      track: async (ps) => { tracked = ps; window.__tracked = ps; return { ok: true }; },
      poll: async () => (window.__pollQueue.length ? window.__pollQueue.shift() : null),
      resolve_asset: async () => null,
      paste_image: async () => ({ skipped: "text" }),
      open_url: async () => ({ opened: true }),
      open_export: async () => ({ opened: true }),
    } };
    window.confirm = () => true;   // auto-approve close of dirty tabs
    window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 40));
  });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 900));

  const bad = [];
  const tabTitles = () => page.evaluate(() => [...document.querySelectorAll("#tabs .tab .tab-name")].map(e => e.textContent));
  const activeTitle = () => page.evaluate(() => { const a = document.querySelector("#tabs .tab.active .tab-name"); return a ? a.textContent : null; });
  const docTitle = () => page.evaluate(() => ed.getValue().match(/title: (.*)/)[1]);
  const pause = (ms = 250) => new Promise(r => setTimeout(r, ms));

  // 1) Boot: exactly one tab (A), active, editor shows A.
  let titles = await tabTitles();
  if (JSON.stringify(titles) !== JSON.stringify(["a.qmd"])) bad.push(`boot tabs = ${JSON.stringify(titles)} (기대 [a.qmd])`);
  if (await activeTitle() !== "a.qmd") bad.push("boot active tab != a.qmd");
  if (await docTitle() !== "A") bad.push("boot editor doc != A");

  // 2) QV.openPath adds a tab and focuses it (simulates Finder-opened 2nd file).
  await page.evaluate(() => window.QV.openPath("/b.qmd")); await pause();
  titles = await tabTitles();
  if (JSON.stringify(titles) !== JSON.stringify(["a.qmd", "b.qmd"])) bad.push(`after openPath b = ${JSON.stringify(titles)}`);
  if (await activeTitle() !== "b.qmd") bad.push("openPath did not focus b");
  if (await docTitle() !== "B") bad.push("editor did not switch to B");

  // 3) Dedupe: opening b again just switches, no duplicate tab.
  await page.evaluate(() => window.QV.openPath("/a.qmd")); await pause();
  await page.evaluate(() => window.QV.openPath("/b.qmd")); await pause();
  titles = await tabTitles();
  if (titles.length !== 2) bad.push(`dedupe failed, tabs = ${JSON.stringify(titles)}`);

  // 3b) 새로 만들기: doNew adds an untitled tab, focused, empty-ish body.
  await page.evaluate(() => doNew()); await pause();
  titles = await tabTitles();
  if (!titles.includes("제목 없음")) bad.push(`doNew did not add 제목 없음 tab: ${JSON.stringify(titles)}`);
  if (await activeTitle() !== "제목 없음") bad.push("doNew did not focus the new tab");
  if (await page.evaluate(() => !/title: "제목 없음"/.test(ed.getValue()))) bad.push("new doc template missing");
  // close it so later step counts stay predictable
  await page.evaluate(() => { const t = [...document.querySelectorAll("#tabs .tab")].find(e => e.querySelector(".tab-name").textContent === "제목 없음"); t.querySelector(".tab-close").click(); });
  await pause();

  // 4) Per-tab state isolation: edit B, switch to A, A must be clean & unchanged.
  await page.evaluate(() => { ed.view.focus(); ed.view.dispatch(ed.view.state.replaceSelection("EDIT-B ")); });
  await pause();
  let bDirty = await page.evaluate(() => document.querySelector('#tabs .tab.active').classList.contains("dirty"));
  if (!bDirty) bad.push("B not marked dirty after edit");
  // switch to A (click its tab)
  await page.evaluate(() => { const t = [...document.querySelectorAll("#tabs .tab")].find(e => e.querySelector(".tab-name").textContent === "a.qmd"); t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  await pause();
  if (await docTitle() !== "A") bad.push("switch to A: editor not showing A");
  if (await page.evaluate(() => !ed.getValue().includes("alpha") || ed.getValue().includes("EDIT-B"))) bad.push("A content leaked/corrupted across tabs");
  let aDirty = await page.evaluate(() => document.querySelector('#tabs .tab.active').classList.contains("dirty"));
  if (aDirty) bad.push("A wrongly marked dirty");
  // back to B — edit must still be there and dirty
  await page.evaluate(() => { const t = [...document.querySelectorAll("#tabs .tab")].find(e => e.querySelector(".tab-name").textContent === "b.qmd"); t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  await pause();
  if (await page.evaluate(() => !ed.getValue().includes("EDIT-B"))) bad.push("B edit lost after round-trip");

  // 5) Save clears dirty (doSave is a page-global function).
  await page.evaluate(async () => { await doSave(); });
  await pause();
  if (await page.evaluate(() => document.querySelector('#tabs .tab.active').classList.contains("dirty"))) bad.push("save did not clear dirty");

  // 6) track() reflects open file paths.
  const tracked = await page.evaluate(() => window.__tracked);
  if (JSON.stringify([...tracked].sort()) !== JSON.stringify(["/a.qmd", "/b.qmd"])) bad.push(`track = ${JSON.stringify(tracked)}`);

  // 7) External change on inactive tab A → poll marks it, switching in shows new content.
  await page.evaluate(() => { window.__FS["/a.qmd"] = "---\ntitle: A2\n---\n\nalpha-external\n"; window.__pollQueue.push([{ text: window.__FS["/a.qmd"], title: "a.qmd", path: "/a.qmd" }]); });
  await pause(900);   // let a poll cycle run
  // A is not dirty → reloaded silently; switch to it and verify.
  await page.evaluate(() => { const t = [...document.querySelectorAll("#tabs .tab")].find(e => e.querySelector(".tab-name").textContent === "a.qmd"); t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  await pause();
  if (await page.evaluate(() => !ed.getValue().includes("alpha-external"))) bad.push("external change to A not reloaded");

  // 8) Close a tab → removed; closing all leaves the explicit help fallback.
  const before = (await tabTitles()).length;
  await page.evaluate(() => { const t = [...document.querySelectorAll("#tabs .tab")].find(e => e.querySelector(".tab-name").textContent === "b.qmd"); t.querySelector(".tab-close").click(); });
  await pause();
  titles = await tabTitles();
  if (titles.includes("b.qmd")) bad.push("close did not remove b");
  if (titles.length !== before - 1) bad.push(`close count wrong: ${JSON.stringify(titles)}`);
  // close remaining → help fallback
  await page.evaluate(() => { document.querySelector("#tabs .tab .tab-close").click(); });
  await pause();
  titles = await tabTitles();
  if (JSON.stringify(titles) !== JSON.stringify(["Pururum 도움말"])) {
    bad.push(`help fallback = ${JSON.stringify(titles)}`);
  }

  // 9) Launch without a file → an untitled new document, never auto-help.
  const blankPage = await browser.newPage();
  await blankPage.evaluateOnNewDocument(() => {
    window.pywebview = { api: {
      get_state: async () => ({ text: "", title: "", path: "", folder: null }),
      read_path: async (path) => ({
        text: "---\ntitle: Late\n---\n\nopened from Finder\n",
        title: path.split("/").pop(),
        path,
      }),
      set_active: async () => ({ ok: true }),
      track: async () => ({ ok: true }),
      poll: async () => null,
      resolve_asset: async () => null,
      paste_image: async () => ({ skipped: "text" }),
      open_url: async () => ({ opened: true }),
      open_export: async () => ({ opened: true }),
    } };
    window.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 40);
    });
  });
  await blankPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
  await pause(500);
  const blankBoot = await blankPage.evaluate(() => ({
    titles: [...document.querySelectorAll("#tabs .tab .tab-name")].map((e) => e.textContent),
    active: document.querySelector("#tabs .tab.active .tab-name")?.textContent || null,
    text: ed.getValue(),
  }));
  if (JSON.stringify(blankBoot.titles) !== JSON.stringify(["제목 없음"])) {
    bad.push(`blank boot tabs = ${JSON.stringify(blankBoot.titles)} (기대 [제목 없음])`);
  }
  if (blankBoot.active !== "제목 없음") bad.push(`blank boot active = ${blankBoot.active}`);
  if (blankBoot.text !== "---\ntitle: \"제목 없음\"\n---\n\n") {
    bad.push(`blank boot template = ${JSON.stringify(blankBoot.text)}`);
  }

  // A Finder/CLI open delivered just after boot replaces only the untouched
  // startup tab, so users never get a stray blank beside the requested file.
  await blankPage.evaluate(() => window.QV.openPath("/late.qmd"));
  await pause();
  const lateBootTitles = await blankPage.evaluate(() =>
    [...document.querySelectorAll("#tabs .tab .tab-name")].map((e) => e.textContent));
  if (JSON.stringify(lateBootTitles) !== JSON.stringify(["late.qmd"])) {
    bad.push(`late launch tabs = ${JSON.stringify(lateBootTitles)} (기대 [late.qmd])`);
  }

  // Likewise, delayed --new-blank replaces the untouched starter rather than
  // creating two identical blank tabs.
  await blankPage.reload({ waitUntil: "networkidle0" });
  await pause(500);
  await blankPage.evaluate(() => window.QV.newBlank());
  await pause();
  const delayedBlankTitles = await blankPage.evaluate(() =>
    [...document.querySelectorAll("#tabs .tab .tab-name")].map((e) => e.textContent));
  if (JSON.stringify(delayedBlankTitles) !== JSON.stringify(["제목 없음"])) {
    bad.push(`delayed blank tabs = ${JSON.stringify(delayedBlankTitles)} (기대 [제목 없음])`);
  }
  await blankPage.close();

  await browser.close(); server.close();
  if (bad.length) { console.log("❌ 탭 테스트 실패:\n - " + bad.join("\n - ")); process.exit(1); }
  console.log("✅ 탭 테스트 전부 통과");
})();
