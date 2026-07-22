const puppeteer = require("puppeteer-core");
const http = require("http"); const path = require("path"); const fs = require("fs");
const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".ttf":"font/ttf",".woff":"font/woff"};
const server=http.createServer((req,res)=>{const p=path.join(STATIC,decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/,""));
 if(!p.startsWith(STATIC)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.writeHead(404);return res.end();}
 res.writeHead(200,{"content-type":MIME[path.extname(p)]||"application/octet-stream"});fs.createReadStream(p).pipe(res);});
(async()=>{
 await new Promise(r=>server.listen(0,"127.0.0.1",r));
 const port=server.address().port;
 const browser=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new",args:["--no-sandbox"]});
 const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${port}/_export.html`,{waitUntil:"networkidle0"});
 await new Promise(r=>setTimeout(r,800));
 const info=await page.evaluate(()=>{
   const all=[...document.querySelectorAll("mjx-container")];
   const zero=all.find(m=>m.getBoundingClientRect().height<4);
   const ok=all.find(m=>m.getBoundingClientRect().height>=8);
   const probe=(m)=>{ if(!m) return null;
     const c=m.querySelector("mjx-c");
     return { disp:getComputedStyle(m).display,
       cCls:c?c.className:null,
       cBefore:c?getComputedStyle(c,"::before").content.slice(0,20):null,
       cFont:c?getComputedStyle(c,"::before").fontFamily.slice(0,40):null,
       cW:c?Math.round(c.getBoundingClientRect().width):null };
   };
   return { zero:probe(zero), ok:probe(ok),
     sheetCount:[...document.querySelectorAll("style[id^=MJX]")].length,
     sheetLen:[...document.querySelectorAll("style[id^=MJX]")].map(x=>x.textContent.length) };
 });
 console.log(JSON.stringify(info,null,1));
 await browser.close(); server.close();
})().catch(e=>{console.error(e);process.exit(1);});
