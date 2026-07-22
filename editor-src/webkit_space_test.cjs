const { webkit } = require("playwright");
const http = require("http"), path = require("path"), fs = require("fs");
const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const MIME = {".html":"text/html",".js":"text/javascript",".css":"text/css",".ttf":"font/ttf",".woff":"font/woff",".png":"image/png",".svg":"image/svg+xml",".json":"application/json"};
// longer formula so a stale-source cursor jump would be big
const DOC = '---\ntitle: "t"\n---\n\n앞텍스트 $\\sum_{i=1}^{n} x_i^2$\n';
const server = http.createServer((req,res)=>{
  const p = path.join(STATIC, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/,"")||"index.html");
  if(!p.startsWith(STATIC)||!fs.existsSync(p)||fs.statSync(p).isDirectory()){res.writeHead(404);return res.end("nf");}
  res.writeHead(200,{"content-type":MIME[path.extname(p)]||"application/octet-stream"});
  fs.createReadStream(p).pipe(res);
});
(async()=>{
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const port=server.address().port;
  const browser=await webkit.launch();
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.addInitScript((doc)=>{
    window.pywebview={api:{get_state:async()=>({text:doc,title:"t.qmd",path:"/tmp/t.qmd"}),poll:async()=>null,save:async()=>({saved:true}),open_file:async()=>null,resolve_asset:async()=>null,track:async()=>({ok:true}),set_active:async()=>({ok:true}),list_dir:async()=>({entries:[]})}};
    window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
  }, DOC);
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(()=>window.MathJax&&window.MathJax.tex2chtml&&window.MathJax.startup&&window.MathJax.startup.document,{timeout:15000}).catch(()=>{});
  await page.waitForTimeout(800);
  const r = await page.evaluate(async ()=>{
    const v=(typeof ed!=="undefined"&&ed)?ed.view:null; if(!v)return{err:"no ed"};
    const doc=v.state.doc; let ln=-1;
    for(let i=1;i<=doc.lines;i++){ if(doc.line(i).text.includes("sum")){ln=i;break;} }
    let line=doc.line(ln);
    // 1) put caret right AFTER the closing '$' (math shown as SOURCE, active)
    v.dispatch({selection:{anchor: line.to}});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const curX=()=>{const c=document.querySelector(".cm-cursor-primary")||document.querySelector(".cm-cursor");return c?Math.round(c.getBoundingClientRect().left):null;};
    const before = curX();
    // 2) press SPACE: insert " " at caret (math becomes a widget)
    const pos = v.state.selection.main.head;
    v.dispatch({changes:{from:pos, insert:" "}, selection:{anchor: pos+1}});
    // sample cursor X across frames
    const samples=[];
    samples.push(["t0", curX()]);
    await new Promise(r=>requestAnimationFrame(r)); samples.push(["raf1", curX()]);
    await new Promise(r=>requestAnimationFrame(r)); samples.push(["raf2", curX()]);
    await new Promise(r=>setTimeout(r,50)); samples.push(["50ms", curX()]);
    await new Promise(r=>setTimeout(r,300)); samples.push(["350ms", curX()]);
    const mjx=document.querySelector(".qv-math:not(.qv-math-block) mjx-container");
    const mathRight = mjx?Math.round(mjx.getBoundingClientRect().right):null;
    return { before_sourceCaret: before, mathRight, samples };
  });
  console.log(JSON.stringify(r,null,2));
  await browser.close(); server.close();
})();
