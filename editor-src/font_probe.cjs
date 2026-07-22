async function measure(launch, name){
  const page = await launch();
  await page.goto("http://127.0.0.1:8377/index.html");
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async ()=>{
    await (document.fonts?document.fonts.ready:Promise.resolve());
    const mk=(ff)=>{const s=document.createElement("span");s.textContent="한글가나다라마바사아자차카";s.style.cssText="position:absolute;font-size:40px;visibility:hidden;font-family:"+ff;document.body.appendChild(s);const w=s.getBoundingClientRect().width;s.remove();return Math.round(w);};
    const cs = getComputedStyle(document.querySelector(".cm-content")||document.body).fontFamily;
    return {
      appStack: mk(cs),
      nanum: mk("'NanumMyeongjo'"),
      sans: mk("sans-serif"),
      serifGeneric: mk("serif"),
      nanumLoaded: document.fonts ? [...document.fonts].some(f=>/Nanum/i.test(f.family) && f.status==="loaded") : "n/a",
    };
  });
  console.log(name, JSON.stringify(r));
  return r;
}
(async()=>{
  // WebKit
  try{ const {webkit}=require("playwright"); const b=await webkit.launch(); const ctx=await b.newContext({viewport:{width:1000,height:700}}); await measure(async()=>ctx.newPage(),"WEBKIT"); await b.close(); }catch(e){console.log("webkit err",e.message);}
  // Chrome (system)
  try{ const puppeteer=require("puppeteer-core"); const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new",args:["--no-sandbox"]}); await measure(async()=>{const p=await b.newPage();await p.setViewport({width:1000,height:700});return p;},"CHROME "); await b.close(); }catch(e){console.log("chrome err",e.message);}
})();
