const { webkit } = require("playwright");
(async()=>{
  const browser=await webkit.launch();
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.addInitScript(()=>{
    const DOC='위\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n아래\n';
    window.pywebview={api:{get_state:async()=>({text:DOC,title:"t.qmd",path:"/tmp/t.qmd"}),poll:async()=>null,save:async()=>({saved:true}),open_file:async()=>null,resolve_asset:async()=>null,track:async()=>({ok:true}),set_active:async()=>({ok:true}),list_dir:async()=>({entries:[]}),set_folder:async()=>({ok:true})}};
    window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
  });
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(2000);
  const out = {};
  // widget rendered with editable cells + toolbar?
  out.setup = await page.evaluate(()=>{
    const t=document.querySelector(".qv-hastable table");
    return { table: !!t, editableCells: t?[...t.querySelectorAll("td,th")].filter(c=>c.isContentEditable).length:0,
             toolbar: !!document.querySelector(".qv-tablebar"),
             btns: [...document.querySelectorAll(".qv-tablebar button")].map(b=>b.textContent) };
  });
  // edit a cell then Tab → doc updated & focus moved
  await page.evaluate(()=>{
    const cell=document.querySelector(".qv-hastable td");  // first body cell "1"
    cell.focus(); document.getSelection().selectAllChildren(cell);
    document.execCommand("insertText", false, "안녕");
  });
  await page.keyboard.press("Tab");
  await page.waitForTimeout(400);
  out.afterTabDoc = await page.evaluate(()=>ed.view.state.doc.toString());
  out.focusedCell = await page.evaluate(()=>document.activeElement && document.activeElement.tagName + ":" + document.activeElement.textContent);
  // toolbar: add a row
  await page.evaluate(()=>{
    [...document.querySelectorAll(".qv-tablebar button")].find(b=>b.textContent==="＋행")
      .dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));
  });
  await page.waitForTimeout(400);
  out.afterAddRow = await page.evaluate(()=>ed.view.state.doc.toString().split("\n").filter(l=>l.startsWith("|")).length);
  // set column center align
  await page.evaluate(()=>{
    [...document.querySelectorAll(".qv-tablebar button")].find(b=>b.textContent==="↔")
      .dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true}));
  });
  await page.waitForTimeout(400);
  out.alignRow = await page.evaluate(()=>ed.view.state.doc.toString().split("\n").find(l=>/^\|[ :-]+\|/.test(l)));
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})();
