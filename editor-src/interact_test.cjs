// Interaction regression test: arrow-key navigation and click-to-edit.
const puppeteer = require("puppeteer-core");
const http = require("http"); const path = require("path"); const fs = require("fs");
const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const DOC = [
  "---","title: 문서","author: cgb","---","",
  "# 제목","","문단 하나.","","**굵게** 와 $x^2$ 수식.","",
  "| A | B |","|---|---|","| 1 | 2 |","",
  "::: {.callout-note}","노트 내용",":::","",
  "```python","print(1)","```","",
  "끝 문단.",""
].join("\n");
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".ttf":"font/ttf"};
const server=http.createServer((req,res)=>{const p=path.join(STATIC,decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/,"")||"index.html");
 if(!p.startsWith(STATIC)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.writeHead(404);return res.end();}
 res.writeHead(200,{"content-type":MIME[path.extname(p)]||"application/octet-stream"});fs.createReadStream(p).pipe(res);});
(async()=>{
 await new Promise(r=>server.listen(0,"127.0.0.1",r));
 const port=server.address().port;
 const browser=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new",args:["--no-sandbox"]});
 const page=await browser.newPage();
 await page.setViewport({width:1100,height:900});
 page.on("pageerror",e=>console.log("[pageerror]",e.message));
 await page.evaluateOnNewDocument((doc)=>{
  window.pywebview={api:{get_state:async()=>({text:doc,title:"t.qmd",path:"/t.qmd"}),poll:async()=>null,
   save:async()=>({saved:true,title:"t.qmd"}),open_file:async()=>null,resolve_asset:async()=>null,open_export:async()=>({opened:true})}};
  window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
 },DOC);
 await page.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:"networkidle0"});
 await new Promise(r=>setTimeout(r,1500));
 const line=()=>page.evaluate(()=>ed.view.state.doc.lineAt(ed.view.state.selection.main.head).number);
 const bad=[];

 // -- 1) ArrowDown steps one line at a time through plain text
 await page.evaluate(()=>{ed.view.focus();ed.view.dispatch({selection:{anchor:ed.view.state.doc.line(8).from}});});
 let l0=await line();
 await page.keyboard.press("ArrowDown"); let l1=await line();
 if(l1!==l0+1) bad.push(`ArrowDown: ${l0} -> ${l1} (기대 ${l0+1})`);

 // -- 2) ArrowUp must move exactly one line (regression: jumped to top)
 await page.keyboard.press("ArrowUp"); let l2=await line();
 if(l2!==l0) bad.push(`ArrowUp: ${l1} -> ${l2} (기대 ${l0})`);
 // from line 10 press Up 3 times -> expect 7 (one per press; widgets reveal as entered)
 await page.evaluate(()=>{ed.view.dispatch({selection:{anchor:ed.view.state.doc.line(10).from}});});
 for(const _ of [1,2,3]) await page.keyboard.press("ArrowUp");
 const l3=await line();
 if(l3===1&&10-3!==1) bad.push(`ArrowUp x3 from 10 landed at top (line 1) — page-up bug`);
 if(Math.abs(10-3-l3)>1) bad.push(`ArrowUp x3 from 10 -> ${l3} (기대 ~7)`);

 // -- 3) Table is a fixed widget; clicking it opens the spreadsheet modal.
 const hasTableWidget=await page.evaluate(()=>!!document.querySelector(".qv-block table"));
 if(!hasTableWidget) bad.push("table widget not rendered");
 else {
  const box=await page.evaluate(()=>{const t=document.querySelector(".qv-block table");const r=t.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.click(box.x,box.y);
  await new Promise(r=>setTimeout(r,300));
  const modal=await page.evaluate(()=>!document.getElementById("table-modal").hasAttribute("hidden"));
  if(!modal) bad.push("table click did not open spreadsheet modal");
  await page.evaluate(()=>document.getElementById("tbl-cancel").click());
 }

 // -- 4) click callout widget → opens its popup editor
 const co=await page.evaluate(()=>{const c=document.querySelector(".qv-block .callout");if(!c)return null;const r=c.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
 if(!co) bad.push("callout widget not rendered");
 else { await page.mouse.click(co.x,co.y); await new Promise(r=>setTimeout(r,300));
  const modal=await page.evaluate(()=>!document.getElementById("callout-modal").hasAttribute("hidden"));
  if(!modal) bad.push("callout click did not open popup"); }

 // -- 5) boldsymbol renders (no red \boldsymbol text)
 await page.evaluate(()=>{ed.setValue("수식 $\\boldsymbol{\\Lambda}$ 테스트\n\n끝.\n");ed.view.dispatch({selection:{anchor:ed.view.state.doc.line(3).from}});});
 await new Promise(r=>setTimeout(r,1200));
 const mjxErr=await page.evaluate(()=>!!document.querySelector("mjx-merror, [data-mjx-error]"));
 const mathOk=await page.evaluate(()=>!!document.querySelector(".qv-math"));
 if(mjxErr) bad.push("\\boldsymbol renders as MathJax error");
 if(!mathOk) bad.push("inline math widget missing after setValue");

  console.log(bad.length?("❌ FAIL:\n - "+bad.join("\n - ")):"✅ 상호작용 테스트 전부 통과");
 if(bad.length) process.exitCode=1;
 await browser.close(); server.close();
})().catch(e=>{console.error(e);process.exit(1);});
