const puppeteer = require("puppeteer-core");
const http = require("http"); const path = require("path"); const fs = require("fs");
const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const DOC = ["---","title: 문서","author: cgb","---","","# 제목","","문단 하나.","","**굵게** 와 $x^2$ 수식.","","| A | B |","|---|---|","| 1 | 2 |","","::: {.callout-note}","노트 내용",":::","","```python","print(1)","```","","끝 문단.",""].join("\n");
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".ttf":"font/ttf"};
const server=http.createServer((req,res)=>{const p=path.join(STATIC,decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/,"")||"index.html");
 if(!p.startsWith(STATIC)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.writeHead(404);return res.end();}
 res.writeHead(200,{"content-type":MIME[path.extname(p)]||"application/octet-stream"});fs.createReadStream(p).pipe(res);});
(async()=>{
 await new Promise(r=>server.listen(0,"127.0.0.1",r));
 const port=server.address().port;
 const browser=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new",args:["--no-sandbox"]});
 const page=await browser.newPage();
 await page.evaluateOnNewDocument((doc)=>{
  window.pywebview={api:{get_state:async()=>({text:doc,title:"t.qmd",path:"/t.qmd"}),poll:async()=>null,save:async()=>({saved:true,title:"t.qmd"}),open_file:async()=>null,resolve_asset:async()=>null,open_export:async()=>({opened:true})}};
  window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
 },DOC);
 await page.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:"networkidle0"});
 await new Promise(r=>setTimeout(r,1200));
 // cursor at line 8, dump visible DOM lines + their text
 const info=await page.evaluate(()=>{
   ed.view.dispatch({selection:{anchor:ed.view.state.doc.line(8).from}});
   const doc=ed.view.state.doc;
   const lines=[...document.querySelectorAll(".cm-content > *")].map(el=>({cls:el.className.slice(0,40),txt:(el.textContent||"").slice(0,30)}));
   return {domChildren: lines, docLines: doc.lines};
 });
 console.log("doc lines:", info.docLines);
 info.domChildren.forEach((l,i)=>console.log(i, JSON.stringify(l)));
 await browser.close(); server.close();
})().catch(e=>{console.error(e);process.exit(1);});
