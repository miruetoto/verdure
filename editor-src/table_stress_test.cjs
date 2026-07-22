const { webkit } = require("playwright");
(async()=>{
  const browser=await webkit.launch();
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.addInitScript(()=>{
    const DOC='위\n\n| 열 1 | 열 2 |\n| --- | --- |\n|  |  |\n\n아래\n';
    window.pywebview={api:{get_state:async()=>({text:DOC,title:"t.qmd",path:"/tmp/t.qmd"}),poll:async()=>null,save:async()=>({saved:true}),open_file:async()=>null,resolve_asset:async()=>null,track:async()=>({ok:true}),set_active:async()=>({ok:true}),list_dir:async()=>({entries:[]}),set_folder:async()=>({ok:true}),autosave:async()=>({skipped:1})}};
    window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
  });
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(2000);
  const doc=()=>page.evaluate(()=>ed.view.state.doc.toString());
  const clickCell=async(sel)=>{const b=await page.evaluate((s)=>{const c=document.querySelector(s);if(!c)return null;const r=c.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},sel); if(b) await page.mouse.click(b.x,b.y); await page.waitForTimeout(250);};
  const out={};
  const before=await doc();
  // click cell, no edit, Escape → unchanged
  await clickCell(".qv-hastable td");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  out.unchangedAfterEsc = (await doc())===before;
  // click, type, Tab, type, Tab (adds row), verify integrity
  await clickCell(".qv-hastable td");
  await page.keyboard.type("AA"); await page.keyboard.press("Tab"); await page.waitForTimeout(300);
  await page.keyboard.type("BB"); await page.keyboard.press("Tab"); await page.waitForTimeout(500);
  const lines=(await doc()).split("\n").filter(l=>l.trim().startsWith("|"));
  out.lines=lines;
  out.intact = lines.length===4 && /AA/.test(lines[2]) && /BB/.test(lines[2]);
  out.widgetCount = await page.evaluate(()=>document.querySelectorAll(".qv-hastable").length);
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})();
