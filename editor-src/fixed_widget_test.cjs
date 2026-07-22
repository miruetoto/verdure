const { webkit } = require("playwright");
(async()=>{
  const browser=await webkit.launch();
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.addInitScript(()=>{
    const px="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const DOC='첫줄\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![샷](data:image/png;base64,'+px+')\n\n끝줄\n';
    window.pywebview={api:{get_state:async()=>({text:DOC,title:"t.qmd",path:"/tmp/t.qmd"}),poll:async()=>null,save:async()=>({saved:true}),open_file:async()=>null,resolve_asset:async()=>null,track:async()=>({ok:true}),set_active:async()=>({ok:true}),list_dir:async()=>({entries:[]}),set_folder:async()=>({ok:true}),autosave:async()=>({skipped:1})}};
    window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
  });
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(2000);
  const out={};
  const widgets=()=>page.evaluate(()=>({table:!!document.querySelector(".qv-hastable table"),img:!!document.querySelector(".qv-imgwrap img"),rawPipes:[...document.querySelectorAll(".cm-line")].some(l=>l.textContent.includes("|---|"))}));
  // 1) click on table border area (not a cell): widget must survive
  const tb = await page.evaluate(()=>{const t=document.querySelector(".qv-hastable table");const r=t.getBoundingClientRect();return {x:r.x+r.width-2,y:r.y+2};});
  await page.mouse.click(tb.x, tb.y); await page.waitForTimeout(300);
  out.afterBorderClick = await widgets();
  // 2) put caret on first line, arrow down through table+image to last line
  await page.evaluate(()=>{ed.view.focus();ed.view.dispatch({selection:{anchor:0}});});
  for (let i=0;i<8;i++){ await page.keyboard.press("ArrowDown"); await page.waitForTimeout(80); }
  out.afterArrows = await page.evaluate(()=>{const v=ed.view;const l=v.state.doc.lineAt(v.state.selection.main.head);return {line:l.number, text:l.text.slice(0,10)};});
  out.widgetsAfterArrows = await widgets();
  // 3) MD button: reveal source; then move caret out → widget returns
  const cellBox=await page.evaluate(()=>{const c=document.querySelector(".qv-hastable td");const r=c.getBoundingClientRect();return {x:r.x+5,y:r.y+5};});
  await page.mouse.move(cellBox.x, cellBox.y); await page.waitForTimeout(200); // hover to show toolbar
  const mdClicked = await page.evaluate(()=>{const b=[...document.querySelectorAll(".qv-tablebar button")].find(b=>b.textContent==="MD"); if(!b)return false; b.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true})); return true;});
  await page.waitForTimeout(300);
  out.mdClicked = mdClicked;
  out.rawShown = (await widgets()).rawPipes;
  await page.evaluate(()=>{const v=ed.view;v.dispatch({selection:{anchor:0}});});
  await page.waitForTimeout(300);
  out.widgetBackAfterLeave = await widgets();
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})();
