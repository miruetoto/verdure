const { webkit } = require("playwright");
(async()=>{
  const browser=await webkit.launch();
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.addInitScript(()=>{
    const DOC='---\ntitle: "t"\n---\n\n# 헤딩\n\n본문 수식 $x^2$ 이 있는 줄.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n표 다음 줄입니다.\n';
    window.pywebview={api:{get_state:async()=>({text:DOC,title:"t.qmd",path:"/tmp/t.qmd"}),poll:async()=>null,save:async()=>({saved:true}),open_file:async()=>null,resolve_asset:async()=>null,track:async()=>({ok:true}),set_active:async()=>({ok:true}),list_dir:async()=>({entries:[]}),set_folder:async()=>({ok:true})}};
    window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
  });
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(2000);
  const info = await page.evaluate(()=>{
    const v=ed.view; v.focus();
    const d=v.state.doc; let ln=-1;
    for(let i=1;i<=d.lines;i++) if(d.line(i).text.includes("수식")){ln=i;break;}
    v.dispatch({selection:{anchor: d.line(ln).from + 5}});
    return {mathLine: ln, from:d.line(ln).from, to:d.line(ln).to, docLen:d.length};
  });
  const head=()=>page.evaluate(()=>{const v=ed.view;const s=v.state.selection.main;const l=v.state.doc.lineAt(s.head);return {pos:s.head,line:l.number,col:s.head-l.from,selLen:Math.abs(s.head-s.anchor)};});
  const press=async(k)=>{await page.keyboard.press(k);await page.waitForTimeout(100);return head();};
  const results={};
  results.start = await head();
  results.cmdLeft = await press("Meta+ArrowLeft");
  results.cmdRight = await press("Meta+ArrowRight");
  results.cmdUp = await press("Meta+ArrowUp");
  results.cmdDown = await press("Meta+ArrowDown");
  // cursor after table line → Cmd+Left should stay on that line
  await page.evaluate(()=>{const v=ed.view;const d=v.state.doc;for(let i=1;i<=d.lines;i++)if(d.line(i).text.includes("표 다음")){v.dispatch({selection:{anchor:d.line(i).from+4}});break;}});
  results.afterTable_cmdLeft = await press("Meta+ArrowLeft");
  results.afterTable_cmdRight = await press("Meta+ArrowRight");
  // shift selection: Cmd+Shift+Left from mid
  await page.evaluate(()=>{const v=ed.view;const d=v.state.doc;for(let i=1;i<=d.lines;i++)if(d.line(i).text.includes("수식")){v.dispatch({selection:{anchor:d.line(i).from+5}});break;}});
  results.shiftCmdLeft = await press("Meta+Shift+ArrowLeft");
  console.log(JSON.stringify({info, ...results}, null, 1));
  await browser.close();
})();
