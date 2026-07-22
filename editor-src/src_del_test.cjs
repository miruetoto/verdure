const { webkit } = require("playwright");
(async()=>{
  const b=await webkit.launch(); const page=await b.newPage({viewport:{width:1200,height:800}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.addInitScript(()=>{
    const DOC='# 문서\n\n**굵게** 텍스트 $x^2$\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n끝\n';
    window.pywebview={api:{get_state:async()=>({text:DOC,title:"t.qmd",path:"/tmp/t.qmd"}),poll:async()=>null,save:async()=>({saved:true}),open_file:async()=>null,resolve_asset:async()=>null,track:async()=>({ok:true}),set_active:async()=>({ok:true}),list_dir:async()=>({entries:[]}),set_folder:async()=>({ok:true}),autosave:async()=>({skipped:1})}};
    window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
  });
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(1500);
  const out={};
  // SOURCE MODE toggle: widgets disappear, raw pipes/asterisks show
  out.beforeSrc = await page.evaluate(()=>({widgets: !!document.querySelector(".qv-hastable, .qv-block"), rawStars: [...document.querySelectorAll(".cm-line")].some(l=>l.textContent.includes("**굵게**"))}));
  await page.evaluate(()=>document.getElementById("btn-source").click());
  await page.waitForTimeout(300);
  out.inSource = await page.evaluate(()=>({widgets: !!document.querySelector(".qv-hastable, .qv-block"), rawStars:[...document.querySelectorAll(".cm-line")].some(l=>l.textContent.includes("**굵게**")), btnOn: document.getElementById("btn-source").classList.contains("on")}));
  await page.evaluate(()=>document.getElementById("btn-source").click());
  await page.waitForTimeout(300);
  out.backToWysiwyg = await page.evaluate(()=>!!document.querySelector(".qv-hastable"));
  // TABLE DELETE via modal
  const cb=await page.evaluate(()=>{const t=document.querySelector(".qv-hastable table");const r=t.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
  await page.mouse.click(cb.x,cb.y); await page.waitForTimeout(400);
  out.deleteVisible = await page.evaluate(()=>!document.getElementById("tbl-delete").hidden);
  await page.evaluate(()=>document.getElementById("tbl-delete").click());
  await page.waitForTimeout(500);
  const doc = await page.evaluate(()=>ed.view.state.doc.toString());
  out.tableGone = !doc.includes("| A | B |") && !/\|---/.test(doc);
  out.restKept = doc.includes("# 문서") && doc.includes("끝");
  console.log(JSON.stringify(out,null,1));
  await b.close();
})();
