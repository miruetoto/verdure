const { webkit } = require("playwright");

(async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__downloads = [];
    URL.createObjectURL = () => "blob:qv-test";
    URL.revokeObjectURL = (url) => { window.__revoked = url; };
    HTMLAnchorElement.prototype.click = function () {
      window.__downloads.push({ download: this.download, href: this.href });
    };
  });
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForFunction(() => window.pywebview && document.documentElement.classList.contains("qv-web"));
  const result = await page.evaluate(async () => {
    await window.pywebview.api.set_active("web:한글 보고서.qmd");
    const saved = await window.pywebview.api.save("# 변경");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    return { saved, downloads: window.__downloads, revoked: window.__revoked };
  });
  console.log(JSON.stringify(result, null, 2));
  const download = result.downloads[0];
  if (!download || download.download !== "한글 보고서.qmd" ||
      result.saved.title !== "한글 보고서.qmd" ||
      result.revoked !== "blob:qv-test") process.exitCode = 1;
  await browser.close();
})();
