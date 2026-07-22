// Generate the app icon: coral macOS squircle + white serif Q (NanumMyeongjo).
const puppeteer = require("puppeteer-core");
const path = require("path"); const fs = require("fs");
const OUT = process.argv[2];
const FONT = path.resolve(__dirname, "../quarto_viewer/static/fonts/NanumMyeongjoExtraBold.ttf");
const fontB64 = fs.readFileSync(FONT).toString("base64");
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family:'NM'; src:url(data:font/ttf;base64,${fontB64}) format('truetype'); }
html,body{margin:0;width:1024px;height:1024px;background:transparent}
.sq{position:absolute;left:100px;top:100px;width:824px;height:824px;border-radius:186px;
  background:linear-gradient(160deg,#ff8d7e 0%,#ff6f61 55%,#ef5b4d 100%);
  box-shadow:inset 0 -14px 40px rgba(0,0,0,.10), inset 0 10px 30px rgba(255,255,255,.18);}
.q{position:absolute;left:0;top:0;width:1024px;height:1024px;display:flex;align-items:center;justify-content:center;
  font:800 560px/1 'NM',serif;color:#fcfcf7;text-shadow:0 12px 28px rgba(0,0,0,.18);}
.bar{position:absolute;left:664px;top:640px;width:14px;height:150px;background:#fcfcf7;border-radius:7px;
  box-shadow:0 8px 18px rgba(0,0,0,.2);}
</style><div class="sq"></div><div class="q">Q</div><div class="bar"></div>`;
(async()=>{
 const browser=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new",args:["--no-sandbox"]});
 const page=await browser.newPage();
 await page.setViewport({width:1024,height:1024});
 await page.setContent(html,{waitUntil:"networkidle0"});
 await page.evaluateHandle("document.fonts.ready");
 await new Promise(r=>setTimeout(r,300));
 await page.screenshot({path:OUT,omitBackground:true});
 await browser.close();
 console.log("icon png:",OUT);
})().catch(e=>{console.error(e);process.exit(1);});
