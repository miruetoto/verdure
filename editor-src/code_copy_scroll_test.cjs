// Chromium regression for rendered fenced-code chrome.
// Verifies accessible copy semantics, clipboard failure handling, internal
// horizontal overflow, zoom stability, and the existing edit/delete/source
// interactions that the code-specific button must not steal.
const assert = require("node:assert/strict");
const puppeteer = require("puppeteer-core");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2",
};
const LONG = `const longLine = "${"abcdefghijklmnopqrstuvwxyz0123456789".repeat(28)}";`;
const SHORT = "const shortLine = 1;";
const MULTI = "first();\nsecond();\nthird();";
const DOC = `# Code blocks

\`\`\`javascript
${LONG}
\`\`\`

\`\`\`javascript
${SHORT}
\`\`\`

\`\`\`javascript
${MULTI}
\`\`\`
`;
const ZOOMS = [0.6, 1, 1.25, 1.5, 3];

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.join(STATIC, rel);
  if (!file.startsWith(STATIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  let browser;
  const bad = [];
  const check = (condition, message) => { if (!condition) bad.push(message); };

  try {
    browser = await puppeteer.launch({
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: "new",
      args: ["--no-sandbox", "--disable-gpu"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1180, height: 900 });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.evaluateOnNewDocument((doc) => {
      window.__clipboardWrites = [];
      window.__clipboardReject = false;
      window.__fallbackCalls = 0;
      window.__fallbackText = null;
      window.__fallbackFail = false;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__clipboardWrites.push(String(text));
            if (window.__clipboardReject) throw new Error("clipboard denied");
          },
        },
      });
      Document.prototype.execCommand = function (command) {
        if (command !== "copy") return false;
        window.__fallbackCalls++;
        window.__fallbackText = document.activeElement && "value" in document.activeElement
          ? document.activeElement.value : null;
        return !window.__fallbackFail;
      };
      window.pywebview = {
        api: {
          get_state: async () => ({ text: doc, title: "code.qmd", path: "/tmp/code.qmd" }),
          poll: async () => null,
          save: async () => ({ saved: true, title: "code.qmd", path: "/tmp/code.qmd" }),
          set_active: async () => ({ ok: true }),
          track: async () => ({ ok: true }),
          resolve_asset: async () => "",
          open_export: async () => ({ opened: true }),
        },
      };
      window.addEventListener("DOMContentLoaded", () => {
        setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 40);
      });
    }, DOC);

    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".qv-codeframe", { timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll(".qv-codeframe").length === 3);

    const structure = await page.evaluate(() => [...document.querySelectorAll(".qv-codeframe")].map((frame) => {
      const pre = frame.querySelector(":scope > pre");
      const code = pre && pre.querySelector(":scope > code");
      const button = frame.querySelector(":scope > button.qv-code-copy");
      const object = frame.closest(".qv-hascode");
      return {
        directPre: !!pre,
        directCode: !!code,
        oneButton: frame.querySelectorAll(":scope > button.qv-code-copy").length === 1,
        tag: button && button.tagName,
        type: button && button.type,
        aria: button && button.getAttribute("aria-label"),
        title: button && button.title,
        tabIndex: button && button.tabIndex,
        generalCopies: object ? object.querySelectorAll(".qv-copyx").length : -1,
        deletes: object ? object.querySelectorAll(".qv-delx").length : -1,
      };
    }));
    check(structure.length === 3, `code frame count = ${structure.length}, expected 3`);
    for (const [index, item] of structure.entries()) {
      check(item.directPre && item.directCode, `frame ${index + 1}: expected direct pre > code`);
      check(item.oneButton, `frame ${index + 1}: expected exactly one direct copy button`);
      check(item.tag === "BUTTON" && item.type === "button", `frame ${index + 1}: copy control is not type=button`);
      check(item.aria === "코드 복사" && item.title === "코드 복사", `frame ${index + 1}: accessible name/title mismatch`);
      check(item.tabIndex === 0, `frame ${index + 1}: button is not in the Tab order`);
      check(item.generalCopies === 0, `frame ${index + 1}: duplicate generic copy button remains`);
      check(item.deletes === 1, `frame ${index + 1}: delete control was lost`);
    }

    const copyState = async () => page.evaluate(() => {
      const frames = [...document.querySelectorAll(".qv-codeframe")];
      const frame = frames[2];
      return {
        domText: frame.querySelector("pre > code").textContent,
        writes: [...window.__clipboardWrites],
        fallbackCalls: window.__fallbackCalls,
        fallbackText: window.__fallbackText,
        focused: document.activeElement === frame.querySelector(".qv-code-copy"),
        toast: document.querySelector("#toast").textContent,
        rendered: !!frame.closest(".qv-hascode"),
      };
    });
    const focusMultiCopy = () => page.evaluate(() => {
      document.querySelectorAll(".qv-code-copy")[2].focus();
    });

    // Native button keyboard activation: Enter and Space must both copy the
    // rendered code text (not its fence or language class).
    await focusMultiCopy();
    await page.keyboard.press("Enter");
    await new Promise((resolve) => setTimeout(resolve, 80));
    let copied = await copyState();
    check(copied.writes.length === 1, `Enter clipboard writes = ${copied.writes.length}`);
    check(copied.writes[0] === copied.domText, "Enter did not copy the complete rendered code text");
    check(copied.domText.trimEnd() === MULTI, `rendered multi-line text changed: ${JSON.stringify(copied.domText)}`);
    check(!copied.writes[0].includes("```") && !copied.writes[0].startsWith("javascript"), "copy included fence/language");
    check(copied.focused && copied.rendered, "Enter moved focus or switched the block to source editing");

    await page.evaluate(() => { window.__clipboardWrites = []; });
    await focusMultiCopy();
    await page.keyboard.press("Space");
    await new Promise((resolve) => setTimeout(resolve, 80));
    copied = await copyState();
    check(copied.writes.length === 1 && copied.writes[0] === copied.domText, "Space did not copy the complete code");
    check(copied.focused && copied.rendered, "Space moved focus or switched the block to source editing");

    // Rejected async clipboard must run the textarea fallback, restore button
    // focus, and only then report success.
    await page.evaluate(() => {
      window.__clipboardWrites = [];
      window.__clipboardReject = true;
      window.__fallbackCalls = 0;
      window.__fallbackText = null;
      window.__fallbackFail = false;
      document.querySelectorAll(".qv-code-copy")[2].focus();
    });
    await page.keyboard.press("Enter");
    await new Promise((resolve) => setTimeout(resolve, 100));
    copied = await copyState();
    check(copied.writes.length === 1, "rejected Clipboard API was not attempted");
    check(copied.fallbackCalls === 1 && copied.fallbackText === copied.domText, "clipboard fallback did not copy the rendered code");
    check(copied.focused, "clipboard fallback did not restore button focus");
    check(copied.toast.includes("코드 복사됨"), `fallback success toast = ${JSON.stringify(copied.toast)}`);

    // If both paths fail, no false success feedback is allowed.
    await page.evaluate(() => {
      window.__fallbackFail = true;
      document.querySelectorAll(".qv-code-copy")[2].focus();
    });
    await page.keyboard.press("Enter");
    await new Promise((resolve) => setTimeout(resolve, 100));
    copied = await copyState();
    check(copied.toast.includes("복사하지 못했습니다"), `clipboard failure toast = ${JSON.stringify(copied.toast)}`);
    check(!copied.toast.includes("복사됨"), "clipboard failure emitted a success message");
    await page.evaluate(() => {
      window.__clipboardReject = false;
      window.__fallbackFail = false;
    });

    const geometry = await page.evaluate(() => {
      const frames = [...document.querySelectorAll(".qv-codeframe")];
      const measure = (frame) => {
        const pre = frame.querySelector("pre");
        const code = pre.querySelector("code");
        const button = frame.querySelector(".qv-code-copy");
        const content = document.querySelector(".cm-content");
        const f = frame.getBoundingClientRect();
        const c = content.getBoundingClientRect();
        const b0 = button.getBoundingClientRect();
        pre.scrollLeft = pre.scrollWidth;
        const b1 = button.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(code).lineHeight);
        return {
          overflowX: getComputedStyle(pre).overflowX,
          overflowY: getComputedStyle(pre).overflowY,
          whiteSpace: getComputedStyle(code).whiteSpace,
          scrollWidth: pre.scrollWidth,
          clientWidth: pre.clientWidth,
          scrollLeft: pre.scrollLeft,
          codeWidth: code.getBoundingClientRect().width,
          textLength: code.textContent.length,
          oneLine: code.getBoundingClientRect().height <= lineHeight + 1,
          frameInsideContent: f.left >= c.left - 1 && f.right <= c.right + 1,
          buttonDelta: Math.max(Math.abs(b1.left - b0.left), Math.abs(b1.top - b0.top)),
          buttonInside: b0.left >= f.left && b0.right <= f.right && b0.top >= f.top && b0.bottom <= f.bottom,
        };
      };
      return { long: measure(frames[0]), short: measure(frames[1]) };
    });
    check(geometry.long.overflowX === "auto", `long overflow-x = ${geometry.long.overflowX}`);
    check(geometry.long.overflowY === "hidden", `long overflow-y = ${geometry.long.overflowY}`);
    check(geometry.long.whiteSpace === "pre" && geometry.long.oneLine, "long line wrapped");
    check(geometry.long.scrollWidth > geometry.long.clientWidth + 1 && geometry.long.scrollLeft > 0,
      `long line is not horizontally scrollable: ${JSON.stringify(geometry.long)}`);
    check(geometry.long.frameInsideContent, "long code frame widened beyond the document content");
    check(geometry.long.buttonDelta <= 0.5 && geometry.long.buttonInside, "copy button moved with the scrolled code");
    check(geometry.short.scrollWidth <= geometry.short.clientWidth + 1, "short code has unnecessary horizontal overflow");

    // The same width/button invariants must hold at all supported zoom levels.
    for (const zoom of ZOOMS) {
      const z = await page.evaluate(async (value) => {
        document.documentElement.style.setProperty("--qv-zoom", value);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const frame = document.querySelector(".qv-codeframe");
        frame.scrollIntoView({ block: "start" });
        const pre = frame.querySelector("pre");
        const button = frame.querySelector(".qv-code-copy");
        const content = document.querySelector(".cm-content");
        pre.scrollLeft = 0;
        const b0 = button.getBoundingClientRect();
        pre.scrollLeft = pre.scrollWidth;
        const b1 = button.getBoundingClientRect();
        const f = frame.getBoundingClientRect(), c = content.getBoundingClientRect();
        return {
          frameInside: f.left >= c.left - 1 && f.right <= c.right + 1,
          scrollable: pre.scrollWidth > pre.clientWidth + 1 && pre.scrollLeft > 0,
          buttonDelta: Math.max(Math.abs(b1.left - b0.left), Math.abs(b1.top - b0.top)),
        };
      }, zoom);
      check(z.frameInside, `${Math.round(zoom * 100)}%: frame escaped document width`);
      check(z.scrollable, `${Math.round(zoom * 100)}%: long code stopped scrolling`);
      check(z.buttonDelta <= 0.5, `${Math.round(zoom * 100)}%: button moved with horizontal scroll`);
    }
    await page.evaluate(() => document.documentElement.style.setProperty("--qv-zoom", 1));

    // Whole-document source mode still removes/recreates rendered widgets.
    await page.evaluate(() => toggleSource());
    await new Promise((resolve) => setTimeout(resolve, 100));
    const sourceOn = await page.evaluate(() => ({
      on: ed.isSource(),
      frames: document.querySelectorAll(".qv-codeframe").length,
      text: ed.getValue(),
    }));
    check(sourceOn.on && sourceOn.frames === 0 && sourceOn.text.includes("```javascript"), "source mode no longer exposes fenced markdown");
    await page.evaluate(() => toggleSource());
    await page.waitForFunction(() => document.querySelectorAll(".qv-codeframe").length === 3);

    // Clicking code (but not its copy button) still reveals the in-place source.
    await page.evaluate(() => {
      document.querySelector(".qv-codeframe pre").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    check(await page.evaluate(() => document.querySelectorAll(".cm-line.cm-codeblock").length >= 3), "click-to-edit no longer reveals fenced source");
    await page.evaluate(() => {
      const view = ed.view;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
    await page.waitForFunction(() => document.querySelectorAll(".qv-codeframe").length === 3);

    // The existing object-ring delete control remains functional.
    const beforeDelete = await page.evaluate(() => ed.getValue());
    await page.evaluate((shortLine) => {
      const object = [...document.querySelectorAll(".qv-hascode")]
        .find((el) => el.querySelector("pre code").textContent.includes(shortLine));
      object.querySelector(".qv-delx").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    }, SHORT);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const afterDelete = await page.evaluate(() => ed.getValue());
    check(beforeDelete.includes(SHORT) && !afterDelete.includes(SHORT), "code-block delete control stopped working");

    check(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);
    assert.deepEqual(bad, []);
    console.log("✅ 코드블록 복사·가로 스크롤 Chromium 테스트 통과");
  } catch (error) {
    if (bad.length) console.error("❌ 코드블록 회귀 실패:\n - " + bad.join("\n - "));
    throw error;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
