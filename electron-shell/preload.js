// Pururum Electron preload — exposes the same window.pywebview.api surface the
// frontend already speaks (mirroring the Tauri adapter in index.html), so
// index.html runs unchanged. Runs before the page; the in-page web-adapter
// fallback sees window.pywebview and stands down.

const { contextBridge, ipcRenderer } = require("electron");

const inv = (name, args) => ipcRenderer.invoke(name, args || {});

contextBridge.exposeInMainWorld("pywebview", {
  api: {
    get_state: () => inv("get_state"),
    read_path: (path) => inv("read_path", { path }),
    help_doc: () => inv("help_doc"),
    list_dir: (path) => inv("list_dir", { path }),
    open_file: () => inv("open_file"),
    open_folder: () => inv("open_folder"),
    set_active: (path) => inv("set_active", { path: path || "" }),
    set_folder: (path) => inv("set_folder", { path: path || "" }),
    track: (paths) => inv("track", { paths: paths || [] }),
    poll: () => inv("poll"),
    save: (text) => inv("save_doc", { text }),
    save_as: (text) => inv("save_as", { text }),
    autosave: (text, hint) => inv("autosave", { text, hint }),
    rename_doc: (title) => inv("rename_doc", { title }),
    resolve_asset: (src) => inv("resolve_asset", { src }),
    paste_image: () => inv("paste_image"),
    save_drawing: (dataUrl) => inv("save_drawing", { dataurl: dataUrl }),
    import_image: (dataUrl, ext) => inv("import_image", { dataurl: dataUrl, ext }),
    open_url: (url) => inv("open_url", { url }),
    export_html: (html, name) => inv("export_html", { html, name }),
  },
});

window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => window.dispatchEvent(new Event("pywebviewready")), 0);
});
