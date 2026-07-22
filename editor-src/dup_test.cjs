const puppeteer = require("puppeteer-core");
const http = require("http"); const path = require("path"); const fs = require("fs");
const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const DOC = "- **굵게**, *기울임*, `인라인 코드`\n- 인라인 수식 $e^{i\\pi}+1=0$ 과 블록 수식:\n\n$$\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n$$\n\n끝.\n";
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
 await new Promise(r=>setTimeout(r,2500));
 const count1=await page.evaluate(()=>document.querySelectorAll(".qv-math").length);
 console.log("초기 인라인+블록 수식 위젯 수 (기대 2):", count1);
 // 커서를 이리저리 움직여 데코레이션 재생성 유발 (사용자 시나리오)
 for (let i=0;i<8;i++){
   await page.evaluate((i)=>{const ln=1+(i%5);ed.view.dispatch({selection:{anchor:ed.view.state.doc.line(ln).from}});},i);
   await new Promise(r=>setTimeout(r,150));
 }
 await new Promise(r=>setTimeout(r,1000));
 const after=await page.evaluate(()=>({
   widgets: document.querySelectorAll(".qv-math").length,
   mjx: document.querySelectorAll(".cm-content mjx-container").length,
   assistiveMml: document.querySelectorAll("mjx-assistive-mml").length,
   dupInWidget: [...document.querySelectorAll(".qv-math")].filter(w=>w.querySelectorAll("mjx-container").length>1).length,
   texts: [...document.querySelectorAll(".qv-math")].map(w=>({mjx:w.querySelectorAll("mjx-container").length, txt:(w.textContent||"").slice(0,40)})),
 }));
 console.log("커서 이동 후:", JSON.stringify(after,null,1));
 await browser.close(); server.close();
})().catch(e=>{console.error(e);process.exit(1);});
