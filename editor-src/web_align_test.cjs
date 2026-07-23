const { webkit } = require("playwright");
(async()=>{
  const browser=await webkit.launch();
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(2000);
  const r = await page.evaluate(async ()=>{
    const px="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const doc = '위\n\n![샷](data:image/png;base64,'+px+'){width=120 fig-align="center"}\n\n아래\n';
    const v = ed.view;
    v.dispatch({changes:{from:0,to:v.state.doc.length,insert:doc},selection:{anchor:0}});
    await new Promise(r=>setTimeout(r,500));
    const wrap=document.querySelector(".qv-imgwrap");
    const img=document.querySelector(".qv-imgwrap img");
    const box=document.querySelector(".qv-imgbox");
    box.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,200));
    const modalOpen=!document.getElementById("image-modal").hasAttribute("hidden");
    document.querySelector('#img-aligns button[data-al=""]').click();
    document.getElementById("img-apply").click();
    await new Promise(r=>setTimeout(r,400));
    const lineText=[...v.state.doc.iterLines()].find(l=>l.startsWith("!["));
    document.querySelector(".qv-imgbox").dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,200));
    document.querySelector('#img-aligns button[data-al="right"]').click();
    document.getElementById("img-apply").click();
    await new Promise(r=>setTimeout(r,400));
    const lineText2=[...v.state.doc.iterLines()].find(l=>l.startsWith("!["));
    return {
      centered: wrap ? wrap.classList.contains("qv-align-center") : null,
      widthApplied: img ? img.style.width : null,
      modalOpen,
      afterToggleOff: lineText,      // fig-align should be gone, width kept
      afterRight: lineText2,         // fig-align="right"
    };
  });
  console.log(JSON.stringify(r,null,2));
  if (!r.centered || r.widthApplied !== "120px" || !r.modalOpen ||
      /fig-align/.test(r.afterToggleOff || "") ||
      !/fig-align="right"/.test(r.afterRight || "")) process.exitCode = 1;
  await browser.close();
})();
