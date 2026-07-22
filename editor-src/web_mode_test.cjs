const { webkit } = require("playwright");
(async()=>{
  const browser=await webkit.launch();
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(2500);
  const r = await page.evaluate(()=>({
    editorMounted: !!document.querySelector(".cm-editor"),
    hasApi: !!(window.pywebview&&window.pywebview.api),
    tabCount: document.querySelectorAll(".tab").length,
    tabTitle: (document.querySelector(".tab-name")||{}).textContent||null,
    sidebarText: (document.querySelector(".sidebar-empty")||{}).textContent||null,
  }));
  console.log(JSON.stringify(r,null,2));
  await page.screenshot({path:"/tmp/web_version.png"});
  await browser.close();
})();
