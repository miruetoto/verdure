const { webkit } = require("playwright");
(async()=>{
  const browser=await webkit.launch();
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on("pageerror",e=>console.log("[pageerror]",e.message));
  await page.addInitScript(()=>{
    const FS = {
      "/proj/a": {name:"a", entries:[{name:"x.qmd",path:"/proj/a/x.qmd",is_dir:false},{name:"sub",path:"/proj/a/sub",is_dir:true}]},
      "/proj/b": {name:"b", entries:[{name:"y.md",path:"/proj/b/y.md",is_dir:false}]},
      "/proj/a/sub": {name:"sub", entries:[]},
    };
    window.pywebview={api:{
      get_state:async()=>({text:"",title:"",path:"",folder:null}),
      list_dir:async(p)=>FS[p]||{path:p,name:p,entries:[]},
      read_path:async(p)=>({text:"# doc "+p,title:p.split("/").pop(),path:p}),
      open_folder:async()=>({folder:"/proj/b"}),
      set_folder:async()=>({ok:true}), set_active:async()=>({ok:true}),
      track:async()=>({ok:true}), poll:async()=>null, save:async()=>({saved:true}),
      open_file:async()=>null, resolve_asset:async()=>null,
    }};
    window.addEventListener("DOMContentLoaded",()=>setTimeout(()=>window.dispatchEvent(new Event("pywebviewready")),50));
  });
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(1200);
  const r = await page.evaluate(async ()=>{
    const out={};
    out.emptyBtnShown = !!document.querySelector(".sidebar-empty button");
    await openFolder("/proj/a");
    await openFolder("/proj/b");
    out.rootCount = document.querySelectorAll(".tree-root-sec").length;
    out.rootNames = [...document.querySelectorAll(".tree-root-head .tn")].map(e=>e.textContent);
    out.fileRows = document.querySelectorAll(".tree-row.file").length;
    // click file in root b → opens tab
    [...document.querySelectorAll(".tree-row.file")].find(e=>e.dataset.path==="/proj/b/y.md").click();
    await new Promise(r=>setTimeout(r,300));
    out.tabTitle = document.querySelector(".tab.active .tab-name")?.textContent;
    // close root a
    document.querySelector(".tree-root-close").click();
    await new Promise(r=>setTimeout(r,300));
    out.rootsAfterClose = [...document.querySelectorAll(".tree-root-head .tn")].map(e=>e.textContent);
    out.addBtn = !!document.getElementById("sidebar-addbtn");
    return out;
  });
  console.log(JSON.stringify(r,null,2));
  await browser.close();
})();
