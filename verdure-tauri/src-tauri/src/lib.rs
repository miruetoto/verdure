// Verdure (Tauri) — native shell for the Quarto/Markdown live editor.
// The web frontend (quarto_viewer/static) is reused verbatim; a shim maps its
// `window.pywebview.api.*` calls to these Tauri commands.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

const WELCOME: &str = "---\ntitle: \"푸르름\"\nauthor: \"환영합니다 👋\"\n---\n\n## 사용법\n\n- **열기…**(⌘O)로 `.qmd` / `.md` 파일을 엽니다.\n- 왼쪽 **에디터**에서 편집하면 미리보기가 **즉시** 갱신됩니다.\n- **⌘S** 로 저장, **출력** 버튼으로 PDF로 내보냅니다.\n\n인라인 수식 $e^{i\\pi}+1=0$ 과 블록 수식, 표, 콜아웃, 탭셋을 지원합니다.\n";

#[derive(Default)]
struct AppState {
    path: Option<PathBuf>,                // active tab's file
    folder: Option<String>,               // sidebar root
    mtimes: HashMap<String, Option<f64>>, // watched files -> last mtime
}
type SharedState = Mutex<AppState>;

// ---- helpers ---------------------------------------------------------------
fn mtime_of(p: &str) -> Option<f64> {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
}

fn title_of(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "환영합니다".into())
}

fn read_text(p: &Path) -> String {
    if p.exists() {
        fs::read_to_string(p).unwrap_or_else(|e| format!("> **파일을 읽을 수 없습니다:** {e}"))
    } else {
        WELCOME.to_string()
    }
}

fn state_of(st: &mut AppState, p: &Path) -> Value {
    st.mtimes
        .insert(p.to_string_lossy().to_string(), mtime_of(&p.to_string_lossy()));
    json!({ "text": read_text(p), "title": title_of(p), "path": p.to_string_lossy(), "folder": st.folder })
}

// ---- commands --------------------------------------------------------------
#[tauri::command]
fn get_state(state: State<SharedState>) -> Value {
    let mut st = state.lock().unwrap();
    if let Some(p) = st.path.clone() {
        return state_of(&mut st, &p);
    }
    json!({ "text": WELCOME, "title": "환영합니다", "path": "", "folder": st.folder })
}

#[tauri::command]
fn read_path(state: State<SharedState>, path: String) -> Value {
    let mut st = state.lock().unwrap();
    state_of(&mut st, &PathBuf::from(&path))
}

#[tauri::command]
fn help_doc() -> Value {
    json!({ "text": WELCOME, "title": "푸르름 도움말", "path": "" })
}

#[tauri::command]
fn list_dir(path: String) -> Value {
    let p = PathBuf::from(&path);
    let mut entries: Vec<Value> = Vec::new();
    if let Ok(rd) = fs::read_dir(&p) {
        let mut items: Vec<(bool, String, String)> = Vec::new();
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let is_dir = e.path().is_dir();
            let ext_ok = matches!(
                e.path()
                    .extension()
                    .and_then(|x| x.to_str())
                    .map(|s| s.to_lowercase())
                    .as_deref(),
                Some("qmd") | Some("md") | Some("markdown")
            );
            if is_dir || ext_ok {
                items.push((is_dir, name, e.path().to_string_lossy().to_string()));
            }
        }
        items.sort_by(|a, b| (!a.0, a.1.to_lowercase()).cmp(&(!b.0, b.1.to_lowercase())));
        for (is_dir, name, full) in items {
            entries.push(json!({ "name": name, "path": full, "is_dir": is_dir }));
        }
    }
    json!({ "path": path, "name": title_of(&p), "entries": entries })
}

#[tauri::command]
fn set_active(state: State<SharedState>, path: String) -> Value {
    let mut st = state.lock().unwrap();
    st.path = if path.is_empty() { None } else { Some(PathBuf::from(path)) };
    json!({ "ok": true })
}

#[tauri::command]
fn set_folder(state: State<SharedState>, path: String) -> Value {
    let mut st = state.lock().unwrap();
    st.folder = if path.is_empty() { None } else { Some(path) };
    json!({ "ok": true })
}

#[tauri::command]
fn track(state: State<SharedState>, paths: Vec<String>) -> Value {
    let mut st = state.lock().unwrap();
    let mut keep: HashMap<String, Option<f64>> = HashMap::new();
    for p in paths {
        let existing = st.mtimes.get(&p).cloned().unwrap_or_else(|| mtime_of(&p));
        keep.insert(p, existing);
    }
    st.mtimes = keep;
    json!({ "ok": true })
}

#[tauri::command]
fn poll(state: State<SharedState>) -> Value {
    let mut st = state.lock().unwrap();
    let keys: Vec<String> = st.mtimes.keys().cloned().collect();
    let mut changed: Vec<Value> = Vec::new();
    for p in keys {
        let cur = mtime_of(&p);
        if cur != *st.mtimes.get(&p).unwrap() {
            st.mtimes.insert(p.clone(), cur);
            if cur.is_some() {
                changed.push(state_of(&mut st, &PathBuf::from(&p)));
            }
        }
    }
    if changed.is_empty() {
        Value::Null
    } else {
        Value::Array(changed)
    }
}

// NOTE: open_file / open_folder / save_as / save_doc are `async` on purpose.
// tauri-plugin-dialog's `blocking_*` helpers must NOT run on the main thread —
// they dispatch the native panel onto the main thread and block waiting for it,
// so calling them from the main thread deadlocks the event loop (the dialog
// never appears and the app appears frozen). Sync `#[tauri::command]` fns run on
// the main thread; async ones run on a worker thread, where blocking is safe.
#[tauri::command]
async fn save_doc(state: State<'_, SharedState>, app: AppHandle, text: String) -> Result<Value, ()> {
    let active = { state.lock().unwrap().path.clone() };
    match active {
        Some(p) => {
            if let Err(e) = fs::write(&p, &text) {
                return Ok(json!({ "error": e.to_string() }));
            }
            let mut st = state.lock().unwrap();
            st.mtimes
                .insert(p.to_string_lossy().to_string(), mtime_of(&p.to_string_lossy()));
            Ok(json!({ "saved": true, "title": title_of(&p), "path": p.to_string_lossy() }))
        }
        None => save_as(state, app, text).await,
    }
}

// ~/Documents/Verdure — the app's default save location, created on demand.
// Untitled documents are auto-saved here so nothing silently disappears.
fn ensure_default_dir(app: &AppHandle) -> Option<PathBuf> {
    let d = app.path().document_dir().ok()?.join("Verdure");
    fs::create_dir_all(&d).ok()?;
    Some(d)
}

fn sanitize_name(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) { ' ' } else { c })
        .collect();
    let t = t.trim().to_string();
    if t.is_empty() { "제목없음".into() } else { t.chars().take(60).collect() }
}

// Give a path-less document a real file in ~/Documents/Verdure (named from the
// title/heading hint, uniquified). After this, plain save() keeps it updated.
#[tauri::command]
fn autosave(state: State<SharedState>, app: AppHandle, text: String, hint: String) -> Value {
    if state.lock().unwrap().path.is_some() {
        return json!({ "skipped": "has-path" });
    }
    let dir = match ensure_default_dir(&app) {
        Some(d) => d,
        None => return json!({ "error": "Documents 폴더를 찾을 수 없습니다" }),
    };
    let base = sanitize_name(&hint);
    let mut path = dir.join(format!("{base}.qmd"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{base} {n}.qmd"));
        n += 1;
    }
    if let Err(e) = fs::write(&path, &text) {
        return json!({ "error": e.to_string() });
    }
    let mut st = state.lock().unwrap();
    st.path = Some(path.clone());
    st.mtimes
        .insert(path.to_string_lossy().to_string(), mtime_of(&path.to_string_lossy()));
    json!({ "saved": true, "title": title_of(&path), "path": path.to_string_lossy() })
}

#[tauri::command]
async fn save_as(state: State<'_, SharedState>, app: AppHandle, text: String) -> Result<Value, ()> {
    let (dir, default) = {
        let st = state.lock().unwrap();
        // Default location: the active file's folder → the sidebar folder →
        // ~/Documents. Never the OS's "last used" (it drifts to random spots).
        let dir = st
            .path
            .as_ref()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .or_else(|| st.folder.as_ref().map(PathBuf::from))
            .or_else(|| ensure_default_dir(&app));
        let default = st
            .path
            .as_ref()
            .map(|p| title_of(p))
            .unwrap_or_else(|| "untitled.qmd".into());
        (dir, default)
    };
    let mut builder = app.dialog().file().set_file_name(&default);
    if let Some(d) = dir {
        builder = builder.set_directory(d);
    }
    match builder.blocking_save_file() {
        Some(fp) => {
            let path = match fp.into_path() {
                Ok(p) => p,
                Err(_) => return Ok(json!({ "cancelled": true })),
            };
            if let Err(e) = fs::write(&path, &text) {
                return Ok(json!({ "error": e.to_string() }));
            }
            let mut st = state.lock().unwrap();
            st.path = Some(path.clone());
            st.mtimes
                .insert(path.to_string_lossy().to_string(), mtime_of(&path.to_string_lossy()));
            Ok(json!({ "saved": true, "title": title_of(&path), "path": path.to_string_lossy() }))
        }
        None => Ok(json!({ "cancelled": true })),
    }
}

#[tauri::command]
async fn open_file(state: State<'_, SharedState>, app: AppHandle) -> Result<Value, ()> {
    // No extension filter: macOS classifies .qmd as "Markdown", which doesn't
    // match a ".qmd" UTI filter and greys the files out. Show everything.
    match app.dialog().file().blocking_pick_file() {
        Some(fp) => match fp.into_path() {
            Ok(p) => {
                let mut st = state.lock().unwrap();
                st.path = Some(p.clone());
                Ok(state_of(&mut st, &p))
            }
            Err(_) => Ok(Value::Null),
        },
        None => Ok(Value::Null),
    }
}

#[tauri::command]
async fn open_folder(state: State<'_, SharedState>, app: AppHandle) -> Result<Value, ()> {
    match app.dialog().file().blocking_pick_folder() {
        Some(fp) => match fp.into_path() {
            Ok(p) => {
                let s = p.to_string_lossy().to_string();
                state.lock().unwrap().folder = Some(s.clone());
                Ok(json!({ "folder": s }))
            }
            Err(_) => Ok(Value::Null),
        },
        None => Ok(Value::Null),
    }
}

#[tauri::command]
fn resolve_asset(state: State<SharedState>, src: String) -> Value {
    if src.is_empty()
        || src.starts_with("http://")
        || src.starts_with("https://")
        || src.starts_with("data:")
    {
        return Value::Null;
    }
    let base = {
        let st = state.lock().unwrap();
        st.path
            .as_ref()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
    };
    let cand = {
        let c = PathBuf::from(&src);
        if c.is_absolute() {
            c
        } else {
            base.join(&c)
        }
    };
    match fs::read(&cand) {
        Ok(bytes) => {
            let mime = match cand
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_lowercase())
                .as_deref()
            {
                Some("png") => "image/png",
                Some("jpg") | Some("jpeg") => "image/jpeg",
                Some("gif") => "image/gif",
                Some("svg") => "image/svg+xml",
                Some("webp") => "image/webp",
                _ => "application/octet-stream",
            };
            Value::String(format!("data:{};base64,{}", mime, B64.encode(bytes)))
        }
        Err(_) => Value::Null,
    }
}

fn save_attachment(state: &State<SharedState>, bytes: &[u8], prefix: &str) -> Value {
    let active = { state.lock().unwrap().path.clone() };
    let p = match active {
        Some(p) => p,
        None => return json!({ "error": "이미지를 저장하려면 먼저 문서를 저장하세요 (⌘S)" }),
    };
    let dir = match p.parent() {
        Some(d) => d.join("attachments"),
        None => return json!({ "error": "저장 경로를 찾을 수 없습니다" }),
    };
    if let Err(e) = fs::create_dir_all(&dir) {
        return json!({ "error": e.to_string() });
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let name = format!("{prefix}-{stamp}.png");
    if let Err(e) = fs::write(dir.join(&name), bytes) {
        return json!({ "error": e.to_string() });
    }
    json!({ "path": format!("attachments/{name}") })
}

#[tauri::command]
fn save_drawing(state: State<SharedState>, dataurl: String) -> Value {
    let b64 = match dataurl.split_once(',') {
        Some((h, b)) if h.contains("base64") => b,
        _ => return json!({ "error": "잘못된 이미지 데이터" }),
    };
    match B64.decode(b64) {
        Ok(bytes) => save_attachment(&state, &bytes, "draw"),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

#[tauri::command]
fn paste_image(state: State<SharedState>) -> Value {
    let mut cb = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(e) => return json!({ "error": e.to_string() }),
    };
    // Text on the clipboard → this is a normal text paste; don't interfere.
    if let Ok(t) = cb.get_text() {
        if !t.trim().is_empty() {
            return json!({ "skipped": "text" });
        }
    }
    let img = match cb.get_image() {
        Ok(i) => i,
        Err(_) => return json!({ "skipped": "no-image" }),
    };
    // Encode the RGBA pixels to PNG.
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut buf, img.width as u32, img.height as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut w = match enc.write_header() {
            Ok(w) => w,
            Err(e) => return json!({ "error": e.to_string() }),
        };
        if let Err(e) = w.write_image_data(&img.bytes) {
            return json!({ "error": e.to_string() });
        }
    }
    save_attachment(&state, &buf, "paste")
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Value {
    use tauri_plugin_opener::OpenerExt;
    if url.starts_with("http://") || url.starts_with("https://") {
        let _ = app.opener().open_url(url, None::<&str>);
        return json!({ "opened": true });
    }
    json!({ "opened": false })
}

#[tauri::command]
fn open_export(app: AppHandle, html: String) -> Value {
    use tauri_plugin_opener::OpenerExt;
    let mut dir = std::env::temp_dir();
    dir.push("verdure-export");
    if let Err(e) = fs::create_dir_all(&dir) {
        return json!({ "error": e.to_string() });
    }
    let file = dir.join("_export.html");
    if let Err(e) = fs::write(&file, html) {
        return json!({ "error": e.to_string() });
    }
    let _ = app.opener().open_path(file.to_string_lossy().to_string(), None::<&str>);
    json!({ "opened": true })
}

// Route a launch argv (file / --folder DIR / --new-blank) to the running window.
fn route_args(app: &AppHandle, args: &[String]) {
    let mut folder: Option<String> = None;
    let mut want_new = false;
    let mut file: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a == "--new-blank" {
            want_new = true;
        } else if a == "--folder" {
            if i + 1 < args.len() {
                folder = Some(args[i + 1].clone());
                i += 1;
            }
        } else if !a.starts_with("--") && Path::new(a).is_file() {
            file = Some(a.clone());
        }
        i += 1;
    }
    if let Some(f) = file {
        let _ = app.emit("qv-open", f);
    } else if let Some(d) = folder {
        let _ = app.emit("qv-folder", d);
    } else if want_new {
        let _ = app.emit("qv-new", ());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Capture launch args for the initial document / folder.
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut init = AppState::default();
    {
        let mut i = 0;
        while i < argv.len() {
            let a = &argv[i];
            if a == "--folder" && i + 1 < argv.len() {
                if Path::new(&argv[i + 1]).is_dir() {
                    init.folder = Some(argv[i + 1].clone());
                }
                i += 1;
            } else if !a.starts_with("--") && Path::new(a).is_file() {
                init.path = Some(PathBuf::from(a));
            }
            i += 1;
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            let extra: Vec<String> = args.into_iter().skip(1).collect();
            route_args(&app.app_handle(), &extra);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(init))
        .invoke_handler(tauri::generate_handler![
            get_state,
            read_path,
            help_doc,
            list_dir,
            set_active,
            set_folder,
            track,
            poll,
            save_doc,
            save_as,
            autosave,
            open_file,
            open_folder,
            resolve_asset,
            save_drawing,
            paste_image,
            open_url,
            open_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
