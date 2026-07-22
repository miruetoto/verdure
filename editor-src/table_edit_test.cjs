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
  // real mouse click on the first body cell → inline input opens, table stays a widget
  const cellBox = await page.evaluate(()=>{const c=document.querySelector(".qv-hastable td");const r=c.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.click(cellBox.x, cellBox.y);
  await page.waitForTimeout(300);
  out.inputOpen = await page.evaluate(()=>!!document.querySelector(".qv-cell-input"));
  out.tableStillWidget = await page.evaluate(()=>!!document.querySelector(".qv-hastable table"));
  out.rawRevealed = await page.evaluate(()=>[...document.querySelectorAll(".cm-line")].some(l=>l.textContent.includes("|---|")));
  // type & Tab → commits, moves to next cell input
  await page.keyboard.type("안녕");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(500);
  out.docAfterTab = await page.evaluate(()=>ed.view.state.doc.toString().split("\n").find(l=>l.includes("안녕")));
  out.nextInputOpen = await page.evaluate(()=>!!document.querySelector(".qv-cell-input"));
  // click outside → commit, no fragments
  await page.mouse.click(900, 200);
  await page.waitForTimeout(500);
  out.tableLines = await page.evaluate(()=>ed.view.state.doc.toString().split("\n").filter(l=>l.trim().startsWith("|")).length);
  out.stillOneTable = await page.evaluate(()=>document.querySelectorAll(".qv-hastable").length);
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})();
