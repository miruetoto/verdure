const puppeteer = require("puppeteer-core");
const http = require("http"); const path = require("path"); const fs = require("fs");
const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const DOC = "첫 줄 텍스트\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n끝 줄\n";
const MIME = { ".html":"text/html",".js":"text/javascript",".css":"text/css",".ttf":"font/ttf" };
const server = http.createServer((req,res)=>{ const p=path.join(STATIC,decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/,"")||"index.html");
  if(!p.startsWith(STATIC)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.writeHead(404);return res.end();}
  res.writeHead(200,{"content-type":MIME[path.extname(p)]||"application/octet-stream"}); fs.createReadStream(p).pipe(res); });
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
  const info=await page.evaluate(()=>({
    qvBlocks: document.querySelectorAll(".qv-block").length,
    tables: document.querySelectorAll(".qv-block table").length,
    blockHtmls: [...document.querySelectorAll(".qv-block")].map(b=>b.outerHTML.slice(0,400)),
  }));
  console.log("qv-blocks:", info.qvBlocks, "| tables:", info.tables);
  console.log(JSON.stringify(info.blockHtmls,null,1));
  await browser.close(); server.close();
})().catch(e=>{console.error(e);process.exit(1);});
