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
    const bar=document.querySelector(".qv-img-alignbar");
    const onBtn=document.querySelector(".qv-img-alignbar button.on");
    // toggle-off via applyImageAttr path: click simulation → dispatch mousedown on center btn
    const centerBtn=[...document.querySelectorAll(".qv-img-alignbar button")][1];
    centerBtn.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,400));
    const lineText=[...v.state.doc.iterLines()].find(l=>l.startsWith("!["));
    // re-align to right via new widget's bar
    const rightBtn=[...document.querySelectorAll(".qv-img-alignbar button")][2];
    rightBtn.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,400));
    const lineText2=[...v.state.doc.iterLines()].find(l=>l.startsWith("!["));
    return {
      centered: wrap ? wrap.classList.contains("qv-align-center") : null,
      widthApplied: img ? img.style.width : null,
      barExists: !!bar, activeMarked: !!onBtn,
      afterToggleOff: lineText,      // fig-align should be gone, width kept
      afterRight: lineText2,         // fig-align="right"
    };
  });
  console.log(JSON.stringify(r,null,2));
  await browser.close();
})();
