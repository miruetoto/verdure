const { webkit } = require("playwright");
(async()=>{
  const browser=await webkit.launch();
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(2000);
  const r = await page.evaluate(async ()=>{
    const px="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const doc = "위\n\n![샷](data:image/png;base64," + px + "){width=120}\n\n아래\n";
    const v = ed.view;
    v.dispatch({changes:{from:0,to:v.state.doc.length,insert:doc},selection:{anchor:0}});
    await new Promise(r=>setTimeout(r,400));
    const img=document.querySelector(".qv-imgwrap img");
    const widthApplied = img ? img.style.width : null;
    const gripExists = !!document.querySelector(".qv-img-grip");
    // put caret INSIDE the data uri → fold must hold
    const d=v.state.doc; let ln=-1;
    for(let i=1;i<=d.lines;i++) if(d.line(i).text.startsWith("![")) {ln=i;break;}
    const mid = d.line(ln).from + 30;
    v.dispatch({selection:{anchor: mid}});
    await new Promise(r=>setTimeout(r,400));
    const tokenStillFolded = !!document.querySelector(".cm-datauri");
    const base64Visible = [...document.querySelectorAll(".cm-line")].some(l=>l.textContent.includes("iVBOR"));
    // simulate resize write-back
    v.dispatch({selection:{anchor:0}});
    await new Promise(r=>setTimeout(r,400));
    const wrap=document.querySelector(".qv-imgwrap");
    const pos = v.posAtDOM(wrap);
    const line = v.state.doc.lineAt(pos);
    const text = v.state.doc.sliceString(pos, line.to);
    const m = /^!\[[^\]]*\]\([^)]*\)(\{\s*width=[^}]*\})?/.exec(text);
    let widthRewritten=null;
    if(m){
      const attrTo=pos+m[0].length, attrFrom=attrTo-(m[1]?m[1].length:0);
      v.dispatch({changes:{from:attrFrom,to:attrTo,insert:"{width=250}"}});
      await new Promise(r=>setTimeout(r,300));
      widthRewritten = v.state.doc.lineAt(pos).text.includes("{width=250}");
    }
    return { widthApplied, gripExists, tokenStillFolded, base64Visible, widthRewritten };
  });
  console.log(JSON.stringify(r,null,2));
  await browser.close();
})();
