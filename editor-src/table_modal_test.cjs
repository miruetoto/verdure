const { webkit } = require("playwright");
(async()=>{
  const browser=await webkit.launch();
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.addInitScript(()=>{
    const DOC='위\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n아래\n';
    window.pywebview={api:{get_state:async()=>({text:DOC,title:"t.qmd",path:"/tmp/t.qmd"}),poll:async()=>null,save:async()=>({saved:true}),open_file:async()=>null,resolve_asset:async()=>null,track:async()=>({ok:true}),set_active:async()=>({ok:true}),list_dir:async()=>({entries:[]}),set_folder:async()=>({ok:true}),autosave:async()=>({skipped:1})}};
    window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
  });
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(2000);
  const out={};
  // 1) click the rendered table (real mouse) → modal opens prefilled
  const tb=await page.evaluate(()=>{const t=document.querySelector(".qv-hastable table");const r=t.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.click(tb.x,tb.y); await page.waitForTimeout(400);
  out.modalOpen = await page.evaluate(()=>!document.getElementById("table-modal").hasAttribute("hidden"));
  out.prefill = await page.evaluate(()=>[...document.querySelectorAll("#tbl-grid input")].map(i=>i.value).join(","));
  // 2) edit first body cell, add a row, set col2 center, apply
  await page.evaluate(()=>{const i=document.querySelector('#tbl-grid input[data-r="1"][data-c="0"]');i.focus();i.value="수정됨";});
  await page.evaluate(()=>document.getElementById("tbl-addrow").click());
  await page.waitForTimeout(200);
  await page.evaluate(()=>{ // cycle col 1 align to center (null→left→center)
    const b=[...document.querySelectorAll("#tbl-grid tr.aligns button")][1]; b.click(); });
  await page.waitForTimeout(150);
  await page.evaluate(()=>{const b=[...document.querySelectorAll("#tbl-grid tr.aligns button")][1]; b.click();});
  await page.waitForTimeout(150);
  await page.evaluate(()=>document.getElementById("tbl-apply").click());
  await page.waitForTimeout(500);
  const doc1 = await page.evaluate(()=>ed.view.state.doc.toString());
  out.applied = doc1;
  // 3) 삽입 → 표 (new table via modal)
  await page.evaluate(()=>{const v=ed.view;v.dispatch({selection:{anchor:v.state.doc.length}});insertBlock("table");});
  await page.waitForTimeout(300);
  out.newModal = await page.evaluate(()=>!document.getElementById("table-modal").hasAttribute("hidden"));
  await page.evaluate(()=>{const i=document.querySelector('#tbl-grid input[data-r="1"][data-c="0"]');i.value="새값";document.getElementById("tbl-centered").checked=true;document.getElementById("tbl-apply").click();});
  await page.waitForTimeout(500);
  const doc2 = await page.evaluate(()=>ed.view.state.doc.toString());
  out.newInserted = doc2.includes("새값") && doc2.includes("::: {.center}");
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})();
