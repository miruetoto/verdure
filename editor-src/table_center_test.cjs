const { webkit } = require("playwright");
(async()=>{
  const browser=await webkit.launch();
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.addInitScript(()=>{
    const DOC='위\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n아래\n';
    window.pywebview={api:{get_state:async()=>({text:DOC,title:"t.qmd",path:"/tmp/t.qmd"}),poll:async()=>null,save:async()=>({saved:true}),open_file:async()=>null,resolve_asset:async()=>null,track:async()=>({ok:true}),set_active:async()=>({ok:true}),list_dir:async()=>({entries:[]}),set_folder:async()=>({ok:true}),autosave:async()=>({skipped:1})}};
    window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
  });
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(2000);
  const out={};
  // activate: click a cell so the context bar docks
  const cb0=await page.evaluate(()=>{const c=document.querySelector(".qv-hastable td");const r=c.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.click(cb0.x,cb0.y); await page.waitForTimeout(400);
  const clickBar=async(label)=>page.evaluate((l)=>{const b=[...document.querySelectorAll("#ctxbar button")].find(b=>b.textContent===l);if(!b)return false;b.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));return true;},label);
  // toggle center on
  out.clicked = await clickBar("가운데");
  await page.waitForTimeout(500);
  out.docWrapped = await page.evaluate(()=>ed.view.state.doc.toString().includes("::: {.center}"));
  out.stillWidget = await page.evaluate(()=>!!document.querySelector(".qv-hastable table"));
  out.centeredCss = await page.evaluate(()=>{const t=document.querySelector(".qdiv.center > table");return t?getComputedStyle(t).marginLeft!=="0px":false;});
  // cell edit inside centered table still works and preserves wrapper
  const cb=await page.evaluate(()=>{const c=document.querySelector(".qv-hastable td");const r=c.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.click(cb.x,cb.y);
  await page.keyboard.type("X"); await page.keyboard.press("Tab"); await page.waitForTimeout(500);
  const doc1=await page.evaluate(()=>ed.view.state.doc.toString());
  out.wrapperKept = doc1.includes("::: {.center}") && doc1.includes(":::") && /X/.test(doc1);
  // toggle off
  await clickBar("가운데"); await page.waitForTimeout(500);
  const doc2=await page.evaluate(()=>ed.view.state.doc.toString());
  out.unwrapped = !doc2.includes("::: {.center}");
  out.tableIntact = doc2.split("\n").filter(l=>l.trim().startsWith("|")).length===3;
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})();
