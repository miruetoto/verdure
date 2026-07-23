// Pururum — Electron (Chromium) shell.
//
// Why Electron: every editor bug this project fought (caret jumps, selection
// drift, blank math, dead clicks) reproduced ONLY in Tauri's WKWebView — never
// in Chromium. The reference apps (Obsidian, Typora) are Chromium-based. This
// shell runs the exact same frontend in Chromium and mirrors the Rust bridge
// (verdure-tauri/src-tauri/src/lib.rs) command-for-command, same JSON shapes,
// so index.html works unchanged.

const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

const WELCOME = `---
title: "Pururum"
author: "환영합니다 👋"
---

## 사용법

- **열기…**(⌘O)로 \`.qmd\` / \`.md\` 파일을 엽니다.
- 왼쪽 **에디터**에서 편집하면 미리보기가 **즉시** 갱신됩니다.
- **⌘S** 로 저장, **출력** 버튼으로 단일 HTML로 내보냅니다.

인라인 수식 $e^{i\\pi}+1=0$ 과 블록 수식, 표, 콜아웃, 탭셋을 지원합니다.
`;

/* ---- state (mirrors Rust AppState) ---- */
const st = { path: null, folder: null, mtimes: new Map() };

const mtimeOf = (p) => { try { return fs.statSync(p).mtimeMs; } catch (_) { return null; } };
const titleOf = (p) => path.basename(p).replace(/\.[^.]+$/, "");
const readText = (p) => {
  try { return fs.readFileSync(p, "utf8"); }
  catch (e) { return fs.existsSync(p) ? `> **파일을 읽을 수 없습니다:** ${e.message}` : WELCOME; }
};
const stateOf = (p) => {
  st.mtimes.set(p, mtimeOf(p));
  return { text: readText(p), title: titleOf(p), path: p, folder: st.folder };
};
const ensureDefaultDir = () => {
  const d = path.join(app.getPath("documents"), "Verdure");
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const sanitizeName = (s) => {
  const t = String(s || "").replace(/[/\\:*?"<>|]/g, " ").trim();
  return t ? t.slice(0, 60) : "제목없음";
};
const saveAttachment = (bytes, prefix) => {
  if (!st.path) return { error: "이미지를 저장하려면 먼저 문서를 저장하세요 (⌘S)" };
  const dir = path.join(path.dirname(st.path), "attachments");
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return { error: e.message }; }
  const name = `${prefix}-${Math.floor(Date.now() / 1000)}.png`;
  try { fs.writeFileSync(path.join(dir, name), bytes); } catch (e) { return { error: e.message }; }
  return { path: `attachments/${name}` };
};
const saveDirFor = () =>
  (st.path && path.dirname(st.path)) || st.folder || ensureDefaultDir();

let win = null;

/* ---- IPC bridge (same names/shapes as the Tauri commands) ---- */
const H = {
  get_state: () => st.path ? stateOf(st.path)
    : { text: WELCOME, title: "환영합니다", path: "", folder: st.folder },
  read_path: (_e, { path: p }) => { return stateOf(p); },
  help_doc: () => ({ text: WELCOME, title: "Pururum 도움말", path: "" }),
  list_dir: (_e, { path: p }) => {
    const entries = [];
    try {
      const items = [];
      for (const name of fs.readdirSync(p)) {
        if (name.startsWith(".")) continue;
        const full = path.join(p, name);
        let isDir = false;
        try { isDir = fs.statSync(full).isDirectory(); } catch (_) { continue; }
        const extOk = /\.(qmd|md|markdown)$/i.test(name);
        if (isDir || extOk) items.push({ isDir, name, full });
      }
      items.sort((a, b) => (a.isDir === b.isDir)
        ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        : (a.isDir ? -1 : 1));
      for (const it of items) entries.push({ name: it.name, path: it.full, is_dir: it.isDir });
    } catch (_) {}
    return { path: p, name: titleOf(p), entries };
  },
  set_active: (_e, { path: p }) => { st.path = p || null; return { ok: true }; },
  set_folder: (_e, { path: p }) => { st.folder = p || null; return { ok: true }; },
  track: (_e, { paths }) => { for (const p of paths || []) st.mtimes.set(p, mtimeOf(p)); return { ok: true }; },
  poll: () => {
    const changed = [];
    for (const [p, old] of st.mtimes) {
      const cur = mtimeOf(p);
      if (cur !== old) {
        st.mtimes.set(p, cur);
        if (cur != null) changed.push(stateOf(p));
      }
    }
    return changed.length ? changed : null;
  },
  save_doc: async (_e, { text }) => {
    if (st.path) {
      try { fs.writeFileSync(st.path, text); } catch (e) { return { error: e.message }; }
      st.mtimes.set(st.path, mtimeOf(st.path));
      return { saved: true, title: titleOf(st.path), path: st.path };
    }
    return H.save_as(_e, { text });
  },
  save_as: async (_e, { text }) => {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(saveDirFor(), st.path ? path.basename(st.path) : "untitled.qmd"),
    });
    if (r.canceled || !r.filePath) return { cancelled: true };
    try { fs.writeFileSync(r.filePath, text); } catch (e) { return { error: e.message }; }
    st.path = r.filePath;
    st.mtimes.set(st.path, mtimeOf(st.path));
    return { saved: true, title: titleOf(st.path), path: st.path };
  },
  autosave: (_e, { text, hint }) => {
    if (st.path) return { skipped: "has-path" };
    const dir = ensureDefaultDir();
    const base = sanitizeName(hint);
    let p = path.join(dir, `${base}.qmd`);
    for (let n = 2; fs.existsSync(p); n++) p = path.join(dir, `${base} ${n}.qmd`);
    try { fs.writeFileSync(p, text); } catch (e) { return { error: e.message }; }
    st.path = p;
    st.mtimes.set(p, mtimeOf(p));
    return { saved: true, title: titleOf(p), path: p };
  },
  open_file: async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openFile"] });
    if (r.canceled || !r.filePaths.length) return null;
    st.path = r.filePaths[0];
    return stateOf(st.path);
  },
  open_folder: async () => {
    const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths.length) return null;
    st.folder = r.filePaths[0];
    return { folder: st.folder };
  },
  resolve_asset: (_e, { src }) => {
    if (!src || /^(https?:|data:)/.test(src)) return null;
    const base = st.path ? path.dirname(st.path) : process.cwd();
    const cand = path.isAbsolute(src) ? src : path.join(base, src);
    try {
      const bytes = fs.readFileSync(cand);
      const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" }[
        (path.extname(cand).slice(1) || "").toLowerCase()] || "application/octet-stream";
      return `data:${mime};base64,${bytes.toString("base64")}`;
    } catch (_) { return null; }
  },
  save_drawing: (_e, { dataurl }) => {
    const m = /^data:[^,]*base64,(.*)$/.exec(dataurl || "");
    if (!m) return { error: "잘못된 이미지 데이터" };
    return saveAttachment(Buffer.from(m[1], "base64"), "draw");
  },
  paste_image: () => {
    const t = clipboard.readText();
    if (t && t.trim()) return { skipped: "text" };
    const img = clipboard.readImage();
    if (!img || img.isEmpty()) return { skipped: "no-image" };
    return saveAttachment(img.toPNG(), "paste");
  },
  open_url: (_e, { url }) => {
    if (/^https?:\/\//.test(url)) { shell.openExternal(url); return { opened: true }; }
    return { opened: false };
  },
  export_html: async (_e, { html, name }) => {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(saveDirFor(), name || "document.html"),
    });
    if (r.canceled || !r.filePath) return { cancelled: true };
    try { fs.writeFileSync(r.filePath, html); } catch (e) { return { error: e.message }; }
    return { saved: true, path: r.filePath };
  },
};

for (const [name, fn] of Object.entries(H)) ipcMain.handle(name, fn);

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 960,
    title: "Pururum",
    backgroundColor: "#fcfcf7",
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  // dev: repo layout / packaged: extraResources → Contents/Resources/static
  const staticDir = app.isPackaged
    ? path.join(process.resourcesPath, "static")
    : path.join(__dirname, "..", "quarto_viewer", "static");
  win.loadFile(path.join(staticDir, "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { app.quit(); });
