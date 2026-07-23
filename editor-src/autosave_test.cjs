const { webkit } = require("playwright");
(async()=>{
  const browser=await webkit.launch();
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.addInitScript(()=>{
    window.__autosaveCalls=[];
    window.pywebview={api:{
      get_state:async()=>({text:"",title:"",path:"",folder:null}),
      poll:async()=>null, open_file:async()=>null, resolve_asset:async()=>null,
      track:async()=>({ok:true}), set_active:async()=>({ok:true}), set_folder:async()=>({ok:true}),
      list_dir:async()=>({entries:[]}),
      save:async(t)=>{ window.__autosaveCalls.push(["save"]); return {saved:true,title:"자동문서.qmd",path:"/docs/Verdure/자동문서.qmd"}; },
      autosave:async(t,hint)=>{ window.__autosaveCalls.push(["autosave",hint]); return {saved:true,title:hint+".qmd",path:"/docs/Verdure/"+hint+".qmd"}; },
    }};
    window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
  });
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(1500);
  // new blank doc active; type a heading → autosave should fire with heading hint
  await page.evaluate(()=>{ const v=ed.view; v.focus(); v.dispatch({changes:{from:v.state.doc.length,insert:"# 회의록\n\n내용입니다"},selection:{anchor:v.state.doc.length}}); });
  await page.waitForTimeout(2200);
  const r1 = await page.evaluate(()=>({calls:window.__autosaveCalls, tabTitle:document.querySelector(".tab.active .tab-name")?.textContent}));
  // further edit → plain save (auto flag)
  await page.evaluate(()=>{ const v=ed.view; v.dispatch({changes:{from:v.state.doc.length,insert:" 추가"}}); });
  await page.waitForTimeout(2200);
  const r2 = await page.evaluate(()=>window.__autosaveCalls);
  // Regression: an autosave debounce from tab A must never save tab B.
  await page.evaluate(()=>{ window.__autosaveCalls=[]; doNew(); });
  await page.evaluate(()=>{ const v=ed.view; v.dispatch({changes:{from:v.state.doc.length,insert:"# 문서A\n\n내용"}}); });
  const aId = await page.evaluate(()=>activeId);
  await page.evaluate(()=>doNew());
  await page.waitForTimeout(1800);
  const callsWhileBActive = await page.evaluate(()=>window.__autosaveCalls.slice());
  await page.evaluate((id)=>switchTo(id),aId);
  await page.waitForTimeout(1800);
  const callsAfterReturn = await page.evaluate(()=>window.__autosaveCalls.slice());
  const race = {callsWhileBActive,callsAfterReturn};
  console.log(JSON.stringify({first:r1, after:r2, race},null,1));
  const ok = r1.calls[0]?.[0] === "autosave" &&
    r2.some((x)=>x[0] === "save") &&
    callsWhileBActive.length === 0 &&
    callsAfterReturn.length === 1 &&
    callsAfterReturn[0][0] === "autosave" &&
    callsAfterReturn[0][1] === "문서A";
  if (!ok) process.exitCode = 1;
  await browser.close();
})();
