// PDF export + view mode + typing latency, on a real blog post.
const puppeteer = require("puppeteer-core");
const http = require("http"); const path = require("path"); const fs = require("fs");
const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const QMD = "/Users/cgb/Dropbox/01-rsch/9999-Yechan/Posts/260312_공부_그래프신호처리.qmd";
const OUT = process.argv[2] || "/tmp/qv-pdfview";
fs.mkdirSync(OUT, { recursive: true });
const DOC = fs.readFileSync(QMD, "utf8");
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".ttf":"font/ttf"};
const server=http.createServer((req,res)=>{const p=path.join(STATIC,decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/,"")||"index.html");
 if(!p.startsWith(STATIC)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.writeHead(404);return res.end();}
 res.writeHead(200,{"content-type":MIME[path.extname(p)]||"application/octet-stream"});fs.createReadStream(p).pipe(res);});
(async()=>{
 await new Promise(r=>server.listen(0,"127.0.0.1",r));
 const port=server.address().port;
 const browser=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new",args:["--no-sandbox","--force-device-scale-factor=2"]});
 const page=await browser.newPage();
 await page.setViewport({width:1280,height:1000,deviceScaleFactor:2});
 const bad=[];
 page.on("pageerror",e=>bad.push("pageerror: "+e.message));
 await page.evaluateOnNewDocument((doc)=>{
  window.__exported=null;
  window.pywebview={api:{get_state:async()=>({text:doc,title:"post.qmd",path:"/tmp/post.qmd"}),poll:async()=>null,
   save:async()=>({saved:true,title:"post.qmd"}),open_file:async()=>null,resolve_asset:async()=>null,
   open_export:async(html)=>{window.__exported=html;return{opened:true};}}};
  window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
 },DOC);
 await page.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:"networkidle0"});
 await new Promise(r=>setTimeout(r,3000));

 // 1) typing latency in the big doc
 const lat=await page.evaluate(()=>{
   ed.view.focus();
   const line=ed.view.state.doc.line(30);
   ed.view.dispatch({selection:{anchor:line.to}});
   const t0=performance.now();
   for(let i=0;i<20;i++) ed.view.dispatch({changes:{from:ed.view.state.selection.main.head,insert:"가"},selection:{anchor:ed.view.state.selection.main.head+1}});
   return (performance.now()-t0)/20;
 });
 console.log("타이핑 1키 평균:", lat.toFixed(1)+"ms");
 if(lat>50) bad.push(`typing too slow: ${lat.toFixed(1)}ms/key`);

 
 // 3) PDF export
 await page.click("#btn-pdf");
 await new Promise(r=>setTimeout(r,5000));
 const html=await page.evaluate(()=>window.__exported);
 if(!html){bad.push("open_export not called");}
 else{
   fs.writeFileSync(path.join(STATIC,"_export.html"),html);
   const p2=await browser.newPage();
   await p2.setViewport({width:1000,height:1200,deviceScaleFactor:2});
   await p2.goto(`http://127.0.0.1:${port}/_export.html`,{waitUntil:"networkidle0"});
   await new Promise(r=>setTimeout(r,1500));
   const ex=await p2.evaluate(()=>({
     callouts:document.querySelectorAll(".callout").length,
     math:document.querySelectorAll("mjx-container").length,
     headings:document.querySelectorAll("h1,h2,h3").length,
     title:!!document.querySelector(".frontmatter .title"),
     mjxZeroH:[...document.querySelectorAll("mjx-container")].filter(m=>m.getBoundingClientRect().height<4).length,
     mjxStyles:!!document.querySelector("style[id^=MJX]"),
     zeroSamples:[...document.querySelectorAll("mjx-container")].filter(m=>m.getBoundingClientRect().height<4).slice(0,4).map(m=>({
       cls:m.className, parentCls:(m.parentElement||{}).className||"", parentChain:(function(e){let c=[];for(let i=0;i<4&&e;i++){c.push(e.tagName+"."+(e.className||"").toString().slice(0,25));e=e.parentElement;}return c.join(" < ");})(m.parentElement),
       html:m.outerHTML.slice(0,120)})),
   }));
   console.log("export page:",JSON.stringify(ex));
   if(ex.math<50) bad.push("export math missing: "+ex.math);
   if(!ex.title) bad.push("export title block missing");
   if(!ex.mjxStyles) bad.push("export page missing MathJax CHTML stylesheet");
   if(ex.mjxZeroH>5) bad.push("export math collapsed (no styles): "+ex.mjxZeroH+" zero-height");
   await p2.screenshot({path:path.join(OUT,"export.png")});
 }
 console.log(bad.length?("❌ FAIL:\n - "+bad.join("\n - ")):"✅ PDF/보기모드/성능 전부 통과");
 await browser.close(); server.close();
})().catch(e=>{console.error(e);process.exit(1);});
