// Chromium regression for object alignment: tables and images default to CENTER
// (a render-time decision — the source is never rewritten on load), the tray
// gains a 정렬 toggle for tables + images ONLY, and toggling writes the sole
// on-disk marker (fig-align="left" / ::: {.left}) then removes it, round-trip
// clean. See COMPANY 우편 to_이슬 260724 for the design rationale.
// Usage: node align_test.cjs
const assert = require("node:assert/strict");
const puppeteer = require("puppeteer-core");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };
const PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const IMG = "data:image/png;base64," + PX;

const server = http.createServer((req, res) => {
  const p = path.join(STATIC, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
  if (!p.startsWith(STATIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new", args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    window.pywebview = { api: {
      get_state: async () => ({ text: "x", title: "a.qmd", path: "/tmp/a.qmd" }),
      poll: async () => null, save: async () => ({ saved: true }),
      open_file: async () => null, resolve_asset: async () => "", open_export: async () => ({ opened: true }),
    } };
    window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 50));
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 2000));

  const bad = [];
  const note = (m) => bad.push(m);
  const setDoc = (d) => page.evaluate(async (doc) => {
    const v = ed.view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: doc }, selection: { anchor: 0 } });
    await new Promise((r) => setTimeout(r, 500));
  }, d);
  const clickAlign = (sel) => page.evaluate(async (s) => {
    const el = document.querySelector(s);
    const btn = el.closest(".qv-obj").querySelector(".qv-alignx") || el.querySelector(".qv-alignx");
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
  }, sel);
  const line = (pfx) => page.evaluate((p) => [...ed.view.state.doc.iterLines()].find((l) => l.startsWith(p)) || "", pfx);
  const docHas = (s) => page.evaluate((x) => ed.view.state.doc.toString().includes(x), s);

  // ---- 1. Center default (render) + button gating -------------------------
  await setDoc(['---', 'title: "정렬"', '---', '', '| A | B |', '|---|---|', '| 1 | 2 |', '',
    '![](' + IMG + ')', '', '$$x$$', '', '::: {.callout-note}', '노트', '::: ', ''].join('\n'));
  const g = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const cs = (n) => (n ? getComputedStyle(n) : null);
    const img = q(".qv-imgwrap"), tbl = q(".qv-hastable");
    const order = (el) => (el ? [...el.querySelectorAll(".qv-badges button")].map((b) => b.className.split(" ")[0]) : null);
    return {
      imgTextAlign: img ? cs(img).textAlign : null,
      imgHasLeft: img ? img.classList.contains("qv-align-left") : null,
      tblML: tbl ? cs(tbl).marginLeft : null, tblMR: tbl ? cs(tbl).marginRight : null,
      tblHasLeft: tbl ? tbl.classList.contains("qv-tbl-left") : null,
      imgOrder: order(q(".qv-imgbox")), tblOrder: order(tbl),
      mathAlign: !!q(".qv-math-block .qv-alignx"), mathDel: !!q(".qv-math-block .qv-delx"),
      calloutAlign: [...document.querySelectorAll(".qv-obj")].some((o) =>
        !o.classList.contains("qv-imgbox") && !o.classList.contains("qv-hastable")
        && !o.querySelector(".qv-imgbox, .qv-hastable") && o.querySelector(".qv-alignx")),
    };
  });
  if (g.imgTextAlign !== "center") note(`image not centered by default: ${g.imgTextAlign}`);
  if (g.imgHasLeft) note("bare image wrongly has qv-align-left");
  if (g.tblML !== g.tblMR) note(`table not centered by default: ML=${g.tblML} MR=${g.tblMR}`);
  if (g.tblHasLeft) note("bare table wrongly has qv-tbl-left");
  const wantOrder = ["qv-alignx", "qv-copyx", "qv-delx"];
  if (JSON.stringify(g.imgOrder) !== JSON.stringify(wantOrder)) note(`image tray order ${JSON.stringify(g.imgOrder)}`);
  if (JSON.stringify(g.tblOrder) !== JSON.stringify(wantOrder)) note(`table tray order ${JSON.stringify(g.tblOrder)}`);
  if (g.mathAlign) note("math wrongly got an align button");
  if (!g.mathDel) note("math lost its delete button");
  if (g.calloutAlign) note("a non-table/image object got an align button");

  // ---- 2. Image toggle: bare ⇄ fig-align="left" ---------------------------
  await setDoc('위\n\n![](' + IMG + ')\n\n아래\n');
  if (!/^!\[\]\([^)]*\)$/.test(await line("!["))) note("image did not start bare");
  await clickAlign(".qv-imgbox");
  if (!/fig-align="left"/.test(await line("!["))) note("image toggle 1 did not write fig-align=left");
  await clickAlign(".qv-imgbox");
  if (/fig-align/.test(await line("!["))) note("image toggle 2 did not return to bare");

  // ---- 3. Table toggle: bare ⇄ ::: {.left} (pipe rows intact) --------------
  await setDoc('위\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n아래\n');
  if (await docHas("::: {.left}")) note("table started with a .left wrapper");
  await clickAlign(".qv-hastable");
  if (!await docHas("::: {.left}")) note("table toggle 1 did not add ::: {.left}");
  if (!await docHas("| A | B |")) note("table toggle 1 damaged the pipe rows");
  await clickAlign(".qv-hastable");
  if (await docHas("::: {.left}")) note("table toggle 2 did not remove the wrapper");
  if (!await docHas("| A | B |")) note("table toggle 2 damaged the pipe rows");

  if (errors.length) note("pageerror: " + errors.join(" | "));
  console.log(bad.length ? "❌ ISSUES:\n - " + bad.join("\n - ") : "✅ align: center default, tray gating, and center⇄left round-trip OK");
  await browser.close();
  server.close();
  assert.equal(bad.length, 0, `${bad.length} alignment failures`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
