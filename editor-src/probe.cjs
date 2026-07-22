const puppeteer = require("puppeteer-core");
const http = require("http"); const path = require("path"); const fs = require("fs");
const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const DOC = ["---","title: 문서","author: cgb","---","","# 제목","","문단 하나.","","**굵게** 와 $x^2$ 수식.","","| A | B |","|---|---|","| 1 | 2 |","","끝 문단.",""].join("\n");
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
 await new Promise(r=>setTimeout(r,1500));
 const probe=await page.evaluate(()=>{
  const v=ed.view;
  v.dispatch({selection:{anchor:v.state.doc.line(8).from}});
  const l8=v.state.doc.line(8), l9=v.state.doc.line(9), l10=v.state.doc.line(10);
  const c8=v.coordsAtPos(l8.from), c9=v.coordsAtPos(l9.from), c10=v.coordsAtPos(l10.from);
  const mv=v.moveVertically(v.state.selection.main,true);
  return {
    defaultLineHeight:v.defaultLineHeight,
    y8:c8&&[c8.top,c8.bottom], y9:c9&&[c9.top,c9.bottom], y10:c10&&[c10.top,c10.bottom],
    moveTargetLine: v.state.doc.lineAt(mv.head).number,
    fontsLoaded: document.fonts.status,
  };
 });
 console.log(JSON.stringify(probe,null,1));
 await browser.close(); server.close();
})().catch(e=>{console.error(e);process.exit(1);});
