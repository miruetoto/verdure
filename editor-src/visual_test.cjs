// Visual regression harness: run the real app page in headless Chrome with a
// mocked pywebview API, screenshot it, and measure key elements.
// Usage: node visual_test.cjs [outdir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const path = require("path");
const fs = require("fs");

const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const OUT = process.argv[2] || "/tmp/qv-visual";
fs.mkdirSync(OUT, { recursive: true });

const DOC = fs.existsSync(path.join(__dirname, "testdoc.qmd"))
  ? fs.readFileSync(path.join(__dirname, "testdoc.qmd"), "utf8")
  : `---
title: "테스트 문서"
author: "cgb"
---

## 사용법

- **굵게**, *기울임*, \`인라인 코드\` 그리고 [링크](https://x.com)
- 인라인 수식 $e^{i\\pi}+1=0$ 과 텍스트가 한 줄에.

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

::: {.callout-note}
콜아웃 안 **굵게** 와 수식 $a^2+b^2=c^2$.
:::

::: {.panel-tabset}
## Python
\`\`\`python
print("hello")
\`\`\`

## R
\`\`\`r
print("hi")
\`\`\`
:::

> 인용문입니다.

| A | B |
|---|---|
| 1 | 2 |
`;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".png": "image/png", ".svg": "image/svg+xml" };
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
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--force-device-scale-factor=2"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") { errors.push(m.text()); console.log("[console.error]", m.text()); } });
  page.on("requestfailed",(r)=>console.log("[reqfail]",r.url().slice(-60)));
  page.on("response",(r)=>{if(r.status()===404)console.log("[404]",r.url().slice(-60))}); // request failed log
  page.on("pageerror", (e) => { errors.push(e.message); console.log("[pageerror]", e.message); });

  // Mock the pywebview bridge before any app script runs.
  await page.evaluateOnNewDocument((doc) => {
    window.pywebview = {
      api: {
        get_state: async () => ({ text: doc, title: "테스트.qmd", path: "/tmp/테스트.qmd" }),
        poll: async () => null,
        save: async (t) => ({ saved: true, title: "테스트.qmd", path: "/tmp/테스트.qmd" }),
        open_file: async () => null,
        resolve_asset: async () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        open_export: async () => ({ opened: true }),
      },
    };
    window.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 50);
    });
  }, DOC);

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 2500)); // let MathJax + widgets settle

  // Measure key elements.
  const report = await page.evaluate(() => {
    const lh = parseFloat(getComputedStyle(document.querySelector(".cm-content")).lineHeight) || 28;
    const pick = (sel) => [...document.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    return {
      lineHeight: lh,
      editorMounted: !!document.querySelector(".cm-editor"),
      inlineMath: pick(".qv-math:not(.qv-math-block)"),
      blockMath: pick(".qv-math-block"),
      mathSvgs: pick("mjx-container"),
      nanSvgs: [...document.querySelectorAll("mjx-container svg")].filter((s) =>
        /NaN/.test(s.getAttribute("width") || "") || /NaN/.test(s.getAttribute("viewBox") || "")).length,
      callouts: pick(".qv-block .callout"),
      tabsets: pick(".qv-block .tabset"),
      images: pick(".qv-img"),
      headings: pick(".cm-hd"),
      tables: pick(".qv-block table, .cm-content table"),
      rawPipes: [...document.querySelectorAll(".cm-line")].filter(l=>/^\s*\|.*\|\s*$/.test(l.textContent)).length,
      strongs: document.querySelectorAll(".cm-strong").length,
      docText: document.body.innerText.slice(0, 120).replace(/\n/g, " | "),
    };
  });
  console.log(JSON.stringify(report, null, 2));

  // Verdicts.
  const bad = [];
  if (!report.editorMounted) bad.push("editor not mounted");
  if (report.nanSvgs > 0) bad.push(`${report.nanSvgs} math SVGs have NaN dimensions`);
  if (errors.some((e) => /NaN/.test(e))) bad.push("NaN errors on console");
  for (const m of report.inlineMath) if (m.h > report.lineHeight * 1.6) bad.push(`inline math too tall: ${m.h}px (line ${report.lineHeight}px)`);
  for (const m of report.blockMath) if (m.h > 200) bad.push(`block math too tall: ${m.h}px`);
  for (const s of report.mathSvgs) if (s.h > 300 || s.w > 1300) bad.push(`oversized math svg: ${s.w}x${s.h}px`);
  if (report.inlineMath.length === 0) bad.push("no inline math rendered");
  if (report.mathSvgs.length === 0) bad.push("no math rendered at all");
  if (report.callouts.length === 0) bad.push("no callout rendered");
  if (report.tabsets.length === 0) bad.push("no tabset rendered");
  if (report.tables.length === 0) bad.push("no table rendered (raw pipes: " + report.rawPipes + ")");
  console.log(bad.length ? "❌ ISSUES:\n - " + bad.join("\n - ") : "✅ all size checks passed");

  await page.screenshot({ path: path.join(OUT, "app.png"), fullPage: false });
  console.log("screenshot:", path.join(OUT, "app.png"));
  // The editor is an inner scroll container — fullPage cannot capture it, so
  // scroll to the bottom and take a second shot.
  await page.evaluate(() => { const sc = document.querySelector(".cm-scroller"); if (sc) sc.scrollTop = sc.scrollHeight; });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUT, "app-bottom.png"), fullPage: false });
  console.log("screenshot:", path.join(OUT, "app-bottom.png"));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
