const { webkit } = require("playwright");
(async()=>{
  const browser=await webkit.launch();
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.addInitScript(()=>{
    const DOC='위\n\n| 열 1 | 열 2 |\n| --- | --- |\n|  |  |\n\n아래\n';
    window.pywebview={api:{get_state:async()=>({text:DOC,title:"t.qmd",path:"/tmp/t.qmd"}),poll:async()=>null,save:async()=>({saved:true}),open_file:async()=>null,resolve_asset:async()=>null,track:async()=>({ok:true}),set_active:async()=>({ok:true}),list_dir:async()=>({entries:[]}),set_folder:async()=>({ok:true})}};
    window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
  });
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(2000);
  const doc = () => page.evaluate(()=>ed.view.state.doc.toString());
  const tableLines = async () => (await doc()).split("\n").filter(l=>l.trim().startsWith("|"));
  const out={};
  // 1) click cell, no edit, click body elsewhere → doc must be unchanged
  const before = await doc();
  await page.evaluate(()=>{ document.querySelector(".qv-hastable td").focus(); });
  await page.waitForTimeout(200);
  await page.evaluate(()=>{ document.querySelector(".qv-hastable td").blur(); });
  await page.waitForTimeout(400);
  out.unchangedAfterFocusBlur = (await doc()) === before;
  // 2) type in cell then Tab x2 (rapid) — table stays intact, single table
  await page.evaluate(()=>{const c=document.querySelector(".qv-hastable td");c.focus();document.getSelection().selectAllChildren(c);document.execCommand("insertText",false,"AA");});
  await page.keyboard.press("Tab");
  await page.waitForTimeout(250);
  await page.evaluate(()=>{const c=document.activeElement;document.execCommand("insertText",false,"BB");});
  await page.keyboard.press("Tab");   // past last cell → adds a row
  await page.waitForTimeout(400);
  out.linesAfterTabs = await tableLines();
  // 3) click outside the table entirely → commit, still exactly one table block
  await page.evaluate(()=>{const v=ed.view;v.focus();v.dispatch({selection:{anchor:0}});});
  await page.waitForTimeout(400);
  const lines = await tableLines();
  out.finalTableLines = lines;
  out.oneTableIntact = lines.length===4 && /AA/.test(lines[2]) && /BB/.test(lines[2]);
  out.fullDoc = await doc();
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})();
