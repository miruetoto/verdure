// Ground-truth comparison: the real 신록예찬 blog page (Quarto-rendered HTML)
// vs this viewer showing the same .qmd. Extracts computed styles from both and
// prints a diff; saves screenshots of each.
// Usage: node style_compare.cjs <rendered.html> <source.qmd> <outdir>
const puppeteer = require("puppeteer-core");
const http = require("http");
const path = require("path");
const fs = require("fs");

const BLOG_DOCS = path.resolve(process.env.HOME, "Dropbox/01-rsch/9999-Yechan/docs");
const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const [, , htmlRel, qmdPath, outDir] = process.argv;
const OUT = outDir || "/tmp/qv-compare";
fs.mkdirSync(OUT, { recursive: true });

function serve(root) {
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json" };
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, ""));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("nf"); }
    res.writeHead(200, { "content-type": MIME[path.extname(p).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const PROPS = ["font-family", "font-size", "font-weight", "font-style", "color", "background-color", "line-height", "border-radius", "border-left-width", "border-left-color", "padding", "margin-top", "margin-bottom", "text-decoration-line"];

function grab(sel, label) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const out = { label, sel };
  for (const p of window.__PROPS) out[p] = cs.getPropertyValue(p);
  return out;
}

(async () => {
  const blogSrv = await serve(BLOG_DOCS);
  const mySrv = await serve(STATIC);
  const blogPort = blogSrv.address().port, myPort = mySrv.address().port;
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new", args: ["--no-sandbox", "--disable-gpu", "--force-device-scale-factor=2"],
  });

  // ---------- real blog page ----------
  const p1 = await browser.newPage();
  await p1.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 2 });
  await p1.goto(`http://127.0.0.1:${blogPort}/${htmlRel}`, { waitUntil: "networkidle0", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
  await p1.evaluate((props) => { window.__PROPS = props; }, PROPS);
  const real = await p1.evaluate((grabSrc) => {
    const grab = new Function("sel", "label", grabSrc);
    const sels = [
      ["body", "body"],
      ["h1.title", "doc-title"],
      ["main h1, main h2", "h-top"],
      ["main h3", "h3"],
      ["main p", "p"],
      ["main a:not(.nav-link):not(.anchorjs-link)", "a"],
      ["main p code:not(.sourceCode), main li code:not(.sourceCode)", "inline-code"],
      ["div.sourceCode pre, pre.sourceCode", "pre"],
      ["main table", "table"], ["main th", "th"], ["main td", "td"],
      ["main blockquote", "blockquote"],
      [".callout.callout-style-default", "callout"],
      [".callout-header, .callout-title-container", "callout-header"],
      [".callout-body-container, .callout-body", "callout-body"],
      [".nav-tabs .nav-link.active", "tab-active"],
      [".nav-tabs .nav-link:not(.active)", "tab"],
      ["main li", "li"], ["main strong", "strong"],
    ];
    return sels.map(([s, l]) => grab(s, l)).filter(Boolean);
  }, grab.toString().replace(/^function[^{]+\{/, "").replace(/\}$/, ""));
  await p1.screenshot({ path: path.join(OUT, "real-top.png") });
  await p1.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.35));
  await new Promise((r) => setTimeout(r, 500));
  await p1.screenshot({ path: path.join(OUT, "real-mid.png") });

  // ---------- my viewer ----------
  const qmd = fs.readFileSync(qmdPath, "utf8");
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 2 });
  await p2.evaluateOnNewDocument((doc) => {
    window.pywebview = { api: {
      get_state: async () => ({ text: doc, title: "compare.qmd", path: "/tmp/compare.qmd" }),
      poll: async () => null, save: async () => ({ saved: true, title: "compare.qmd" }),
      open_file: async () => null, resolve_asset: async () => null, open_export: async () => ({ opened: true }),
    }};
    window.addEventListener("DOMContentLoaded", () => setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 50));
  }, qmd);
  const errors = [];
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto(`http://127.0.0.1:${myPort}/index.html`, { waitUntil: "networkidle0", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4000));
  await p2.evaluate((props) => { window.__PROPS = props; }, PROPS);
  const mine = await p2.evaluate((grabSrc) => {
    const grab = new Function("sel", "label", grabSrc);
    const sels = [
      [".cm-content", "body"],
      [".cm-h1", "h-top"], [".cm-h2", "h-top2"], [".cm-h3", "h3"],
      [".cm-line", "p"],
      [".cm-link", "a"],
      [".cm-code", "inline-code"],
      [".cm-codeblock", "pre"],
      [".qv-block table", "table"], [".qv-block th", "th"], [".qv-block td", "td"],
      [".cm-quote", "blockquote"],
      [".qv-block .callout", "callout"],
      [".qv-block .callout-header", "callout-header"],
      [".qv-block .callout-body", "callout-body"],
      [".qv-block .tab-btn.active", "tab-active"],
      [".qv-block .tab-btn:not(.active)", "tab"],
      [".cm-strong", "strong"],
    ];
    return sels.map(([s, l]) => grab(s, l)).filter(Boolean);
  }, grab.toString().replace(/^function[^{]+\{/, "").replace(/\}$/, ""));
  await p2.screenshot({ path: path.join(OUT, "mine-top.png") });
  await p2.evaluate(() => { const sc = document.querySelector(".cm-scroller"); if (sc) sc.scrollTop = sc.scrollHeight * 0.35; });
  await new Promise((r) => setTimeout(r, 500));
  await p2.screenshot({ path: path.join(OUT, "mine-mid.png") });

  // ---------- diff ----------
  const realBy = Object.fromEntries(real.map((r) => [r.label, r]));
  const mineBy = Object.fromEntries(mine.map((m) => [m.label, m]));
  console.log("=== REAL blog styles ===");
  console.log(JSON.stringify(real, null, 1));
  console.log("=== MY viewer styles ===");
  console.log(JSON.stringify(mine, null, 1));
  console.log("=== DIFF (label: prop real → mine) ===");
  for (const label of Object.keys(realBy)) {
    const r = realBy[label], m = mineBy[label];
    if (!m) { console.log(`- [${label}] MISSING in viewer`); continue; }
    for (const p of PROPS) {
      if ((r[p] || "") !== (m[p] || "")) console.log(`- [${label}] ${p}: "${r[p]}" → "${m[p]}"`);
    }
  }
  if (errors.length) console.log("viewer pageerrors:", errors);
  console.log("screenshots in", OUT);
  await browser.close(); blogSrv.close(); mySrv.close();
})().catch((e) => { console.error(e); process.exit(1); });
