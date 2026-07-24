// Chromium geometry regression for the fused object outline + action tab.
// It catches the silhouette failures a size-only visual_test misses: a square
// left shoulder, a stepped right wall, the path folding back on narrow math,
// hover-to-hover tray growth, and CSS-zoom coordinate drift.
// Usage: node object_ring_test.cjs
const assert = require("node:assert/strict");
const puppeteer = require("puppeteer-core");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const STATIC = path.resolve(__dirname, "../quarto_viewer/static");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };

// One wide target (table), one narrow target (short display math, which is what
// used to make the path fold back on itself), one full-width target (tabset).
const DOC = `---
title: "Object ring"
---

| 이름 | 값 |
|---|---:|
| 원주율 | 3.14 |

$$x$$

::: {.panel-tabset}
## Python
\`\`\`python
print("hello")
\`\`\`

## R
\`\`\`r
print("hi")
\`\`\`
:::
`;

// 110% is in here because that is what the owner had on screen when the tray
// vanished — the zoom steps a user actually lands on matter more than round
// numbers.
const ZOOMS = [0.6, 1, 1.1, 1.25, 1.5, 3];
const TOL = 0.6;  // px — path coords are rounded to integers upstream
const TAB_H = 26;  // must match tabH in addDeleteBadge()

const server = http.createServer((req, res) => {
  const p = path.join(STATIC, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
  if (!p.startsWith(STATIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});

// Hover one object and read back everything the ring geometry is judged on.
// Sampling the real path with getPointAtLength keeps the assertions honest:
// they describe the drawn curve, not the formula that produced it.
const probe = (sel, nth) => {
  const el = document.querySelectorAll(sel)[nth];
  if (!el) return null;
  el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
  const svg = el.querySelector("svg.qv-ring");
  const p = svg && svg.querySelector("path");
  const tray = el.querySelector(".qv-badges");
  if (!svg || !p || !tray) return null;
  const len = p.getTotalLength();
  // Dense sampling: the left shoulder arc is only ~10px long, and at 400
  // samples a square corner there could slip through unnoticed.
  const N = 2000;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const q = p.getPointAtLength((len * i) / N);
    pts.push([q.x, q.y]);
  }
  const bb = p.getBBox();
  const sr = svg.getBoundingClientRect(), tr2 = tray.getBoundingClientRect();
  return {
    d: p.getAttribute("d"),
    svgW: +svg.getAttribute("width"), svgH: +svg.getAttribute("height"),
    trayW: tray.offsetWidth,
    bbox: { x: bb.x, y: bb.y, w: bb.width, h: bb.height },
    // Tray must sit inside the tab, i.e. inside the ring's own box.
    trayInside: tr2.left >= sr.left - 1 && tr2.right <= sr.right + 1
      && tr2.top >= sr.top - 1 && tr2.bottom <= sr.bottom + 1,
    pts,
  };
};

// --- geometry assertions on the sampled polyline -------------------------

// Top and bottom of the rightmost wall — plus whether it is ONE run. Extent
// alone is not enough: a wall that touches maxX at both ends and is notched in
// between has the same top and bottom as a clean one. The samples are evenly
// spaced along the path, so a single wall must occupy consecutive indices.
function maxXWall(pts, tol) {
  const maxX = Math.max(...pts.map((p) => p[0]));
  const idx = [];
  pts.forEach((p, i) => { if (p[0] >= maxX - tol) idx.push(i); });
  const ys = idx.map((i) => pts[i][1]);
  return {
    maxX, top: Math.min(...ys), bottom: Math.max(...ys), n: idx.length,
    contiguous: idx.length > 0 && idx[idx.length - 1] - idx[0] + 1 === idx.length,
  };
}

// How far the shoulder clears the square-corner vertex. A right angle passes
// straight through it (0px); a quarter-circle of radius R stands off by
// R·(√2−1). Measuring the standoff instead of counting "diagonal" samples
// makes the check independent of sample density and of the path's total
// length — a fixed sample budget spread over a longer perimeter silently
// weakened the old count, and a 3px fillet still satisfied it.
function shoulderClearance(pts, yT, xaWall) {
  const iUp = pts.findIndex((p) => p[1] < yT - 2);   // path leaves the body top line
  if (iUp < 1) return 0;
  let best = Infinity;
  for (let i = Math.max(0, iUp - 120); i <= Math.min(pts.length - 1, iUp + 20); i++) {
    best = Math.min(best, Math.hypot(pts[i][0] - xaWall, pts[i][1] - yT));
  }
  return Number.isFinite(best) ? best : 0;
}


(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.evaluateOnNewDocument((doc) => {
    window.pywebview = {
      api: {
        get_state: async () => ({ text: doc, title: "ring.qmd", path: "/tmp/ring.qmd" }),
        poll: async () => null,
        save: async () => ({ saved: true, title: "ring.qmd", path: "/tmp/ring.qmd" }),
        open_file: async () => null,
        resolve_asset: async () => "",
        open_export: async () => ({ opened: true }),
      },
    };
    window.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 50);
    });
  }, DOC);

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 2500));  // MathJax + widgets settle

  // Address each object by its own class — `.qv-block` alone also matches the
  // frontmatter, so positional indices silently test the wrong widget.
  const TARGETS = [
    { name: "frontmatter", sel: ".qv-hasfm", nth: 0 },
    { name: "table", sel: ".qv-hastable", nth: 0 },
    { name: "short display math", sel: ".qv-math-block", nth: 0 },
    { name: "tabset", sel: ".qv-hastabset", nth: 0 },
  ];

  const bad = [];
  const note = (t, msg) => bad.push(`[${t}] ${msg}`);

  // CodeMirror only builds widgets for its current viewport, and at 300% zoom
  // most of the document sits outside it — so a target can be genuinely absent
  // until we scroll to it. Walk the scroller down until it materialises.
  const bringIntoView = async (sel, nth) => {
    for (let step = 0; step < 24; step++) {
      const ok = await page.evaluate((s, n) => {
        const el = document.querySelectorAll(s)[n];
        if (el) { el.scrollIntoView({ block: "center" }); return true; }
        const sc = document.querySelector(".cm-scroller");
        if (!sc || sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 1) return null;
        sc.scrollTop += sc.clientHeight * 0.6;
        return false;
      }, sel, nth);
      if (ok) { await new Promise((r) => setTimeout(r, 200)); return true; }
      if (ok === null) return false;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };

  for (const t of TARGETS) {
    for (const z of ZOOMS) {
      await page.evaluate((zz) => document.documentElement.style.setProperty("--qv-zoom", zz), z);
      await new Promise((r) => setTimeout(r, 250));
      if (!await bringIntoView(t.sel, t.nth)) {
        note(t.name, `target never entered the viewport at zoom ${z}`);
        continue;
      }

      // Re-hover the SAME target three times: nothing may grow between hovers.
      const runs = [];
      for (let k = 0; k < 3; k++) {
        const r = await page.evaluate(probe, t.sel, t.nth);
        if (!r) { note(t.name, `no ring at zoom ${z} (hover ${k + 1})`); break; }
        runs.push(r);
        await new Promise((rr) => setTimeout(rr, 120));
      }
      if (runs.length < 3) continue;
      const tag = `${t.name} @ ${Math.round(z * 100)}%`;

      // 1. Idempotent re-hover — the old tray/ring stretch bug.
      for (let k = 1; k < 3; k++) {
        if (runs[k].d !== runs[0].d) note(tag, `path d changed on hover ${k + 1}`);
        if (runs[k].trayW !== runs[0].trayW) note(tag, `tray width ${runs[0].trayW} → ${runs[k].trayW} on hover ${k + 1}`);
        if (runs[k].svgW !== runs[0].svgW || runs[k].svgH !== runs[0].svgH) {
          note(tag, `svg ${runs[0].svgW}x${runs[0].svgH} → ${runs[k].svgW}x${runs[k].svgH} on hover ${k + 1}`);
        }
      }

      const g = runs[0];
      const { pts, bbox } = g;

      // 2. The path stays inside its own SVG box.
      if (bbox.x < -TOL || bbox.y < -TOL || bbox.x + bbox.w > g.svgW + TOL || bbox.y + bbox.h > g.svgH + TOL) {
        note(tag, `path bbox ${JSON.stringify(bbox)} escapes svg ${g.svgW}x${g.svgH}`);
      }
      if (!g.trayInside) note(tag, "buttons sit outside the tab");

      // 3. Right wall is ONE vertical: tab top-right down to body bottom-right,
      //    with no 10px shelf. Only the two corner radii (tab 8px, body 10px)
      //    may be missing from the span — a shelf would cost the whole 26px tab.
      const wall = maxXWall(pts, TOL);
      const span = wall.bottom - wall.top;
      if (span < bbox.h - 18 - TOL) {
        note(tag, `right wall spans only ${span.toFixed(1)}px of ${bbox.h.toFixed(1)}px — stepped, not a single vertical`);
      }
      if (!wall.contiguous) {
        note(tag, `right wall reaches max-x in ${wall.n} samples that are not one run — it is notched, not a single vertical`);
      }

      // 4. The tab's outer wall and the body's outer wall are the same x.
      const tabWallX = Math.max(...pts.filter((p) => p[1] < bbox.y + TAB_H - TOL).map((p) => p[0]));
      const bodyWallX = Math.max(...pts.filter((p) => p[1] > bbox.y + TAB_H + TOL).map((p) => p[0]));
      if (Math.abs(tabWallX - bodyWallX) > TOL) {
        note(tag, `tab wall x=${tabWallX.toFixed(1)} ≠ body wall x=${bodyWallX.toFixed(1)}`);
      }

      // Tab left wall, read from the upper half of the tab band — above where
      // the shoulder arc bulges left of it.
      const xaWall = Math.min(...pts.filter((p) => p[1] < bbox.y + TAB_H / 2).map((p) => p[0]));

      // 5. Left shoulder is a real arc, not a right angle. One stroke width of
      //    clearance: the 10px shoulder stands off 4.1px, a right angle 0, and
      //    a fillet too small to read as round (≲4px) is rejected too.
      const clearance = shoulderClearance(pts, bbox.y + TAB_H, xaWall);
      if (clearance < 2) {
        note(tag, `left shoulder clears the corner by only ${clearance.toFixed(2)}px — reads as a square corner`);
      }

      // 6. No fold-back: the tab band must be narrower than the ring, and the
      //    body must be wide enough to host it (the narrow-math failure mode).
      const tabW = tabWallX - xaWall;
      if (tabW <= 0) note(tag, `tab width ${tabW.toFixed(1)} — path folded back`);
      if (bbox.w < tabW + 18) note(tag, `ring ${bbox.w.toFixed(1)}px too narrow for a ${tabW.toFixed(1)}px tab`);
    }
  }

  // --- reachability: can the pointer actually GET to the buttons? ----------
  // The geometry pass above hovers synthetically, which keeps `.qv-obj:hover`
  // alive by fiat. Only a real pointer crossing the band between the object's
  // box and the tray exercises the dead zone that made the buttons unreachable.
  // Criteria per 이슬's audit (260724-1137).
  for (const t of TARGETS) {
    for (const z of ZOOMS) {
      await page.evaluate((zz) => {
        document.documentElement.style.setProperty("--qv-zoom", zz);
        // Each combination starts from a known scroll — otherwise the pan a
        // previous zoom needed leaves this one measuring a half-off-screen
        // object and reporting a harness artefact as a product failure.
        const sc = document.querySelector(".cm-scroller");
        if (sc) sc.scrollLeft = 0;
      }, z);
      await new Promise((r) => setTimeout(r, 250));
      if (!await bringIntoView(t.sel, t.nth)) continue;   // already reported above
      const tag = `${t.name} @ ${Math.round(z * 100)}% reach`;

      // Read the button and the part of the object that is actually on screen.
      // At 300% a full-width object runs past the right edge, so its tab can be
      // off-viewport — a point outside the viewport cannot be hit-tested, and
      // measuring there would report a harness limit as a product failure.
      const vp = page.viewport();
      const read = () => page.evaluate((s, n, vw, vh) => {
        const el = document.querySelectorAll(s)[n];
        const btn = el && el.querySelector(".qv-delx");
        const tray = el && el.querySelector(".qv-badges");
        if (!el || !btn || !tray) return null;
        const r = el.getBoundingClientRect(), br = btn.getBoundingClientRect();
        // Start the gesture from the middle of the VISIBLE part of the object,
        // so the pointer really begins on it even when it overflows the view.
        const vl = Math.max(r.left, 2), vr = Math.min(r.right, vw - 2);
        const vt = Math.max(r.top, 2), vb = Math.min(r.bottom, vh - 2);
        return {
          trayW: tray.offsetWidth,
          bx: br.left + br.width / 2, by: br.top + br.height / 2,
          cx: (vl + vr) / 2, cy: (vt + vb) / 2, onScreen: vr > vl && vb > vt,
        };
      }, t.sel, t.nth, vp.width, vp.height);

      let g = await read();
      if (!g) { note(tag, "no tray/button on the object"); continue; }
      const inView = (p) => p.bx > 1 && p.by > 1 && p.bx < vp.width - 1 && p.by < vp.height - 1;
      for (let tries = 0; tries < 4 && !inView(g); tries++) {
        await page.evaluate((dx, dy) => {
          const sc = document.querySelector(".cm-scroller");
          if (!sc) return;
          sc.scrollLeft += dx; sc.scrollTop += dy;
        }, g.bx > vp.width - 1 ? g.bx - vp.width + 90 : (g.bx < 1 ? g.bx - 90 : 0),
           g.by < 1 ? g.by - 70 : (g.by > vp.height - 1 ? g.by - vp.height + 70 : 0));
        await new Promise((r) => setTimeout(r, 300));
        const re = await read();
        if (!re) break;
        g = re;
      }
      if (!inView(g) || !g.onScreen) {
        note(tag, `button centre (${g.bx.toFixed(0)}, ${g.by.toFixed(0)}) stayed outside the ${vp.width}x${vp.height} viewport — combination went unmeasured`);
        continue;
      }

      // Leave the object first. `positionRing()` only runs on `mouseenter`, so
      // a pointer that never left keeps the ring at the PREVIOUS zoom's
      // coordinates and the gesture would aim at a stale button.
      await page.mouse.move(2, 2);
      await new Promise((r) => setTimeout(r, 120));
      await page.mouse.move(g.cx, g.cy);                  // land on the object
      await new Promise((r) => setTimeout(r, 300));
      const before = await read();
      if (!before) { note(tag, "no tray/button while hovering the object"); continue; }
      // The tray only takes its real position once `positionRing()` has run on
      // a genuine hover, so re-check that the target is still reachable.
      if (!inView(before)) {
        note(tag, `button centre moved to (${before.bx.toFixed(0)}, ${before.by.toFixed(0)}) once hovered — outside the ${vp.width}x${vp.height} viewport, unmeasured`);
        continue;
      }

      // Glide toward the buttons one pixel at a time. A coarse move is the
      // EASY case: a long stride can land past a dead band without ever
      // sampling it, so hover survives by luck. A slow hand samples every
      // pixel — that is what the owner reported failing, so that is what the
      // test must reproduce.
      await page.mouse.move(before.bx, before.by, {
        steps: Math.max(2, Math.ceil(Math.hypot(before.bx - before.cx, before.by - before.cy))),
      });
      await new Promise((r) => setTimeout(r, 300));

      const after = await page.evaluate((s, n, bx, by) => {
        const el = document.querySelectorAll(s)[n];
        const tray = el.querySelector(".qv-badges");
        const cs = getComputedStyle(tray);
        const hit = document.elementFromPoint(bx, by);
        const r = el.getBoundingClientRect();
        const name = (e) => (e ? String(e.className?.baseVal ?? e.className ?? e.tagName) : "null");
        const isHitArea = (e) => !!(e && e.closest && (e.closest(".qv-badges") || e.closest(".qv-ring")));
        // Sample just inside the content's top edge, across the object's width
        // — the strip is full-width now, so probing only under the tray would
        // miss it stealing clicks anywhere else along that edge.
        const edges = [0.15, 0.5, 0.85].map((f) =>
          document.elementFromPoint(r.left + r.width * f, r.top + 0.5));
        const stolen = edges.filter(isHitArea);
        return {
          opacity: cs.opacity, pe: cs.pointerEvents, trayW: tray.offsetWidth,
          hitIsButton: !!(hit && hit.closest && hit.closest(".qv-badges")),
          hit: name(hit),
          edgeIsBridge: stolen.length > 0,
          edge: edges.map(name).join(" / "),
          trayAt: (() => { const b = tray.getBoundingClientRect(); return `${b.left.toFixed(0)},${b.top.toFixed(0)}–${b.right.toFixed(0)},${b.bottom.toFixed(0)}`; })(),
        };
      }, t.sel, t.nth, before.bx, before.by);

      // When the gesture fails, walk it again a step at a time and say exactly
      // where `.qv-obj:hover` died. Guessing at this from a pass/fail line cost
      // several wrong fixes; the test should hand over the coordinate.
      if (+after.opacity !== 1 || after.pe !== "auto" || !after.hitIsButton) {
        await page.mouse.move(before.cx, before.cy);
        await new Promise((r) => setTimeout(r, 250));
        const n = Math.ceil(Math.hypot(before.bx - before.cx, before.by - before.cy));
        let drop = null;
        for (let i = 1; i <= n && !drop; i++) {
          const x = before.cx + (before.bx - before.cx) * i / n;
          const y = before.cy + (before.by - before.cy) * i / n;
          await page.mouse.move(x, y);
          const live = await page.evaluate((s, k, xx, yy) => {
            const el = document.querySelectorAll(s)[k];
            const e = document.elementFromPoint(xx, yy);
            return { hov: el.matches(":hover"), under: e ? String(e.className?.baseVal ?? e.className ?? e.tagName) : "null" };
          }, t.sel, t.nth, x, y);
          if (!live.hov) {
            const geo = await page.evaluate((s, k) => {
              const el = document.querySelectorAll(s)[k];
              const strip = el.querySelector(".qv-hit"), ring = el.querySelector("svg.qv-ring");
              const R = (n) => { if (!n) return "none"; const b = n.getBoundingClientRect(); return `${b.left.toFixed(0)},${b.top.toFixed(0)}–${b.right.toFixed(0)},${b.bottom.toFixed(0)}`; };
              const tray = el.querySelector(".qv-badges");
              const tgt = (el.classList.contains("qv-math-block") && el.querySelector("mjx-math"))
                || el.querySelector("table, .tabset, .callout, .frontmatter, pre") || el;
              return { el: R(el), ring: R(ring), strip: R(strip), stripH: strip && strip.getAttribute("height"), stripPE: strip && getComputedStyle(strip).pointerEvents,
                trayLeft: tray.style.left, trayTop: tray.style.top, trayW: tray.offsetWidth,
                trayOffsetLeft: tray.offsetLeft, elClientLeft: el.clientLeft,
                trayComputed: getComputedStyle(tray).left + " tf=" + getComputedStyle(tray).transform + " ml=" + getComputedStyle(tray).marginLeft,
                ringComputed: getComputedStyle(ring).left + " tf=" + getComputedStyle(ring).transform,
                nSame: document.querySelectorAll(".qv-hasfm").length,
                offsetParent: tray.offsetParent ? String(tray.offsetParent.className?.baseVal ?? tray.offsetParent.className) : "null",
                target: R(tgt), targetTag: tgt.tagName + "." + String(tgt.className || "") };
            }, t.sel, t.nth);
            drop = `hover died at (${x.toFixed(0)}, ${y.toFixed(0)}) over "${live.under}" — path (${before.cx.toFixed(0)}, ${before.cy.toFixed(0)}) → (${before.bx.toFixed(0)}, ${before.by.toFixed(0)}) | el ${geo.el} | ring ${geo.ring} | strip ${geo.strip} h=${geo.stripH} pe=${geo.stripPE} | tray inline left=${geo.trayLeft} w=${geo.trayW} offsetLeft=${geo.trayOffsetLeft} elClientLeft=${geo.elClientLeft} computed=${geo.trayComputed} ringComputed=${geo.ringComputed} nFM=${geo.nSame} offsetParent=${geo.offsetParent} | target ${geo.targetTag} ${geo.target}`;
          }
        }
        note(tag, drop || "gesture failed but hover never dropped — check pointer-events, not geometry");
      }
      if (+after.opacity !== 1) note(tag, `tray faded to opacity ${after.opacity} on the way to the buttons`);
      if (after.pe !== "auto") note(tag, `tray pointer-events=${after.pe} at the button`);
      if (!after.hitIsButton) note(tag, `pointer at the button centre (${before.bx.toFixed(0)}, ${before.by.toFixed(0)}) hits "${after.hit}"; tray is at ${after.trayAt}`);
      if (after.edgeIsBridge) note(tag, `hit bridge steals the content's top row (elementFromPoint → "${after.edge}")`);
      if (after.trayW !== before.trayW) note(tag, `tray width ${before.trayW} → ${after.trayW} across the move`);
    }
  }

  await page.evaluate(() => document.documentElement.style.setProperty("--qv-zoom", 1));
  if (errors.length) bad.push("pageerror: " + errors.join(" | "));

  console.log(bad.length
    ? "❌ ISSUES:\n - " + bad.join("\n - ")
    : `✅ object ring: geometry + button reachability OK for ${TARGETS.length} objects × ${ZOOMS.length} zooms (`
      + ZOOMS.map((z) => Math.round(z * 100) + "%").join(", ") + ")");
  await browser.close();
  server.close();
  assert.equal(bad.length, 0, `${bad.length} ring geometry failures`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
