const { webkit } = require("playwright");
const http = require("http"), path = require("path"), fs = require("fs");
const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const MIME = {".html":"text/html",".js":"text/javascript",".css":"text/css",".ttf":"font/ttf",".woff":"font/woff",".png":"image/png",".svg":"image/svg+xml",".json":"application/json"};
const DOC = '---\ntitle: "t"\n---\n\n짧은수식 $x^2$ \n긴수식 $\\sum_{i=1}^{n} x_i^2 = \\alpha$ \n';
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
    window.pywebview={api:{
      get_state:async()=>({text:doc,title:"t.qmd",path:"/tmp/t.qmd"}),
      poll:async()=>null, save:async()=>({saved:true}), open_file:async()=>null,
      resolve_asset:async()=>null, track:async()=>({ok:true}), set_active:async()=>({ok:true}),
      list_dir:async()=>({entries:[]}),
    }};
    window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
  }, DOC);
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  // wait for MathJax to load fully (tex2chtml available)
  await page.waitForFunction(()=>window.MathJax&&window.MathJax.tex2chtml&&window.MathJax.startup&&window.MathJax.startup.document, {timeout:15000}).catch(()=>console.log("mathjax wait timeout"));
  await page.waitForTimeout(800);

  async function testLine(needle, label){
    const r = await page.evaluate(async (needle)=>{
      const v = (typeof ed!=="undefined"&&ed)?ed.view:null;
      if(!v) return {err:"no ed"};
      const doc=v.state.doc; let ln=-1;
      for(let i=1;i<=doc.lines;i++){ if(doc.line(i).text.includes(needle)){ln=i;break;} }
      const line=doc.line(ln);
      // place caret at end of the line (after math + trailing space) -> math renders (sync)
      v.dispatch({selection:{anchor: line.to}});
      await new Promise(r=>setTimeout(r,300));
      // the math widget on THIS line
      const maths=[...document.querySelectorAll(".qv-math:not(.qv-math-block)")];
      // pick the math whose rendered content is on the same visual line as caret
      const cur=document.querySelector(".cm-cursor-primary")||document.querySelector(".cm-cursor");
      const cr=cur?cur.getBoundingClientRect():null;
      let best=null,bestDy=1e9;
      for(const m of maths){const b=m.getBoundingClientRect(); const dy=Math.abs((b.top+b.bottom)/2-((cr.top+cr.bottom)/2)); if(dy<bestDy){bestDy=dy;best=b;}}
      return {
        line: line.text,
        mathRight: best?Math.round(best.right):null,
        mathWidth: best?Math.round(best.width):null,
        cursorLeft: cr?Math.round(cr.left):null,
        gap: (best&&cr)?Math.round(cr.left-best.right):null,
      };
    }, needle);
    console.log(label, JSON.stringify(r));
    return r;
  }
  const shortR = await testLine("x^2","SHORT:");
  const longR  = await testLine("alpha","LONG :");
  await page.screenshot({path:"/tmp/webkit_cursor.png"});
  await browser.close(); server.close();
  // verdict: gap should be ~ one space (< ~15px). A big gap (>30px) = bug.
  const bad=[];
  if(shortR.gap!=null && shortR.gap>20) bad.push("short gap "+shortR.gap);
  if(longR.gap!=null && longR.gap>20) bad.push("long gap "+longR.gap);
  console.log(bad.length? "❌ "+bad.join("; ") : "✅ caret sits right after math (no gap)");
})();
