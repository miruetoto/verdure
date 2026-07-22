const puppeteer = require("puppeteer-core");
const http = require("http"); const path = require("path"); const fs = require("fs");
const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const DOC = "- **굵게**, *기울임*, `인라인 코드`\n- 인라인 수식 $e^{i\\pi}+1=0$ 과 블록 수식:\n\n$$\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n$$\n\n| 기능 | 지원 |\n|---|---|\n| 마크다운 | ✅ |\n";
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
 await page.evaluateOnNewDocument((doc)=>{
  window.pywebview={api:{get_state:async()=>({text:doc,title:"t.qmd",path:"/t.qmd"}),poll:async()=>null,save:async()=>({saved:true,title:"t.qmd"}),open_file:async()=>null,resolve_asset:async()=>null,open_export:async()=>({opened:true})}};
  window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
 },DOC);
 await page.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:"networkidle0"});
 await new Promise(r=>setTimeout(r,2000));
 const dump=async(tag)=>{
   const d=await page.evaluate(()=>({
     mode:document.body.classList.contains("view-mode"),
     viewMjx:document.querySelectorAll("#view-doc mjx-container").length,
     viewRaw:(document.getElementById("view-doc").innerText.match(/\$/g)||[]).length,
     edMjx:document.querySelectorAll(".cm-content mjx-container").length,
     viewInlineP:(document.querySelector("#view-doc li:nth-child(2)")||{}).textContent||"",
   }));
   console.log(tag, JSON.stringify(d));
   return d;
 };
 // 1) 보기 토글 1회
 await page.click("#btn-view"); await new Promise(r=>setTimeout(r,1800)); await dump("보기1회:");
 // 2) 편집→보기 빠른 재토글 (연속 refreshViewPane)
 await page.click("#btn-view"); await page.click("#btn-view"); await page.click("#btn-view");
 await new Promise(r=>setTimeout(r,2000)); await dump("빠른토글후:");
 // 3) 보기 상태에서 외부변경(applyState 경로) 시뮬레이션
 await page.evaluate(()=>{applyState({text:pywebview_doc_backup||ed.getValue(),title:"t.qmd"});});
 await new Promise(r=>setTimeout(r,1500)); await dump("applyState후:");
 await browser.close(); server.close();
})().catch(e=>{console.error(e);process.exit(1);});
