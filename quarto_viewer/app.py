"""푸르름 — a native, backend-free editor + reader for Quarto (.qmd).

Rendering happens entirely client-side (no `quarto render`, no server): the
window shows a CodeMirror editor and a live preview of Markdown, math, tables,
code, Quarto callouts and tabsets. Python's job is file I/O — open, save, watch
for external changes, inline local images, and hand a print-optimized page to
the browser for PDF export.

Not rendered (needs real Quarto): executed code chunks, cross-references,
citations/bibliography. The document text and fenced code are shown as-is.
"""

from __future__ import annotations

import base64
import datetime
import fcntl
import json
import mimetypes
import os
import socket
import sys
import tempfile
import threading
import time
import unicodedata
import webbrowser
from pathlib import Path
from urllib.parse import unquote

import webview

# Single-instance control channel: a second launch (e.g. double-clicking another
# .qmd in Finder) hands its file to the already-running window as a new tab
# instead of spawning a separate window. A Unix-domain socket (not TCP) avoids
# macOS's "wants to find devices on your local network" permission prompt.
CONTROL_SOCK = Path(tempfile.gettempdir()) / f"pureureum-{os.getuid()}.sock"

# pywebview 6 renamed the dialog constants; keep working on both.
try:  # pragma: no cover - depends on installed version
    _OPEN = webview.FileDialog.OPEN
    _SAVE = webview.FileDialog.SAVE
    _FOLDER = webview.FileDialog.FOLDER
except AttributeError:  # pragma: no cover
    _OPEN = webview.OPEN_DIALOG
    _SAVE = webview.SAVE_DIALOG
    _FOLDER = webview.FOLDER_DIALOG

APP_NAME = "푸르름"


def _resource_base() -> Path:
    """Directory holding bundled resources (static/, appicon). When frozen by
    PyInstaller these live under sys._MEIPASS; in dev they sit next to this file."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return Path(__file__).resolve().parent


HERE = _resource_base()
STATIC = HERE / "static"
# The export page is written at runtime, so it must live somewhere writable —
# the bundle's static dir is read-only once installed in /Applications.
if getattr(sys, "frozen", False):
    _EXPORT_DIR = Path(tempfile.gettempdir()) / "verdure-export"
    EXPORT_HTML = _EXPORT_DIR / "_export.html"
else:
    EXPORT_HTML = STATIC / "_export.html"
# appicon.icns: bundled next to static when frozen, at the project root in dev.
_ICON_FROZEN = HERE / "appicon.icns"
APP_ICON = _ICON_FROZEN if _ICON_FROZEN.exists() else HERE.parent / "appicon.icns"


def _brand_menu() -> None:
    """The window is hosted by a bare `python` process (launched by the applet),
    so macOS labels the menu bar "Python" and the Dock tile "python3.10".
    Override the bundle display name (menu bar) *and* the process name (Dock
    tile) before the NSApplication is built so both read 푸르름."""
    try:  # pragma: no cover - macOS/pyobjc only
        from Foundation import NSBundle, NSProcessInfo

        bundle = NSBundle.mainBundle()
        info = bundle.localizedInfoDictionary() or bundle.infoDictionary()
        if info is not None:
            info["CFBundleName"] = APP_NAME
            info["CFBundleDisplayName"] = APP_NAME
        # The Dock tile / app switcher label comes from the process name.
        NSProcessInfo.processInfo().setProcessName_(APP_NAME)
    except Exception:
        pass


def _set_dock_icon() -> None:
    """Replace the generic python Dock icon with our feather icon."""
    try:  # pragma: no cover - macOS/pyobjc only
        from AppKit import NSApplication, NSImage

        if APP_ICON.exists():
            img = NSImage.alloc().initByReferencingFile_(str(APP_ICON))
            if img is not None:
                NSApplication.sharedApplication().setApplicationIconImage_(img)
    except Exception:
        pass


def _install_open_handler(window):
    """Handle 'open documents' Apple Events for the lifetime of the app, so
    opening more files while the window is up (Finder double-click, `open`,
    OpenInVerdure) routes them into new tabs instead of erroring. argv_emulation
    only covers the launch file; this covers everything after."""
    try:  # pragma: no cover - macOS/pyobjc only
        import objc
        from Foundation import NSObject, NSAppleEventManager, NSURL

        def four(s: str) -> int:
            return int.from_bytes(s.encode("ascii"), "big")

        k_core, k_open = four("aevt"), four("odoc")
        key_direct, type_furl = four("----"), four("furl")

        def route(path: str) -> None:
            try:
                window.evaluate_js("window.QV && QV.openPath(" + json.dumps(path) + ")")
            except Exception:
                pass

        class _OpenHandler(NSObject):
            def handleOpen_withReply_(self, event, reply):
                try:
                    direct = event.paramDescriptorForKeyword_(key_direct)
                    if direct is None:
                        return
                    for i in range(1, direct.numberOfItems() + 1):
                        item = direct.descriptorAtIndex_(i)
                        furl = item.coerceToDescriptorType_(type_furl)
                        if furl is None:
                            continue
                        s = bytes(furl.data()).decode("utf-8", "replace")
                        url = NSURL.URLWithString_(s)
                        p = url.path() if url is not None else None
                        if p:
                            route(str(p))
                except Exception:
                    pass

        handler = _OpenHandler.alloc().init()
        mgr = NSAppleEventManager.sharedAppleEventManager()
        mgr.setEventHandler_andSelector_forEventClass_andEventID_(
            handler, "handleOpen:withReply:", k_core, k_open)
        return handler  # caller keeps a ref so it isn't collected
    except Exception:
        return None

WELCOME = """\
---
title: "푸르름"
author: "환영합니다 👋"
---

## 사용법

- **열기…**(⌘O)로 `.qmd` / `.md` 파일을 엽니다.
- 왼쪽 **에디터**에서 편집하면 오른쪽 미리보기가 **즉시** 갱신됩니다.
- **⌘S** 로 실제 파일에 저장합니다. **PDF** 버튼으로 내보낼 수 있어요.
- 외부 에디터에서 파일을 저장해도 자동으로 반영됩니다.

- **굵게**, *기울임*, `인라인 코드`
- 인라인 수식 $e^{i\\pi}+1=0$ 과 블록 수식:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

| 기능       | 지원 |
|------------|:----:|
| 마크다운   |  ✅  |
| 수식(LaTeX)|  ✅  |
| 코드 강조  |  ✅  |
| Quarto 콜아웃 | ✅ |

```python
import numpy as np
print(np.arange(5))
```

Quarto 콜아웃도 실제처럼 렌더링됩니다:

::: {.callout-note}
`.callout-note` 는 이렇게 파란 박스로 나옵니다.
:::

::: {.callout-tip title="유용한 팁"}
`title="..."` 로 제목도 바꿀 수 있어요. 안에서 **마크다운**과 수식 $a^2+b^2=c^2$ 도 됩니다.
:::

탭셋(`::: {.panel-tabset}`)도 됩니다:

::: {.panel-tabset}
## Python
```python
print("hello")
```

## R
```r
print("hello")
```

## 설명
`##` 헤딩이 각 탭이 됩니다.
:::

> 다만 코드 **실행**·cross-ref·참고문헌은 실제 `quarto render`가 필요합니다.
"""


class Api:
    """File access exposed to the window's JavaScript.

    The window is multi-tab: `self.path` is the *active* tab's file (used by
    resolve_asset/paste_image/save), while `self._mtimes` watches every open
    tab's file for external changes.
    """

    def __init__(self, initial: Path | None = None) -> None:
        self.path: Path | None = initial
        self.folder: str | None = None   # sidebar root, if launched on a folder
        # str(path) -> last-seen mtime, for every open document.
        self._mtimes: dict[str, float | None] = {}
        if initial:
            self._mtimes[str(initial)] = self._mtime_of(initial)

    # -- helpers -----------------------------------------------------------
    @staticmethod
    def _mtime_of(p: Path | str) -> float | None:
        try:
            return Path(p).stat().st_mtime
        except OSError:
            return None

    @staticmethod
    def _title_of(p: Path | str | None) -> str:
        # macOS returns filenames in NFD (decomposed Hangul); compose to NFC so
        # Korean names render as syllables instead of separated jamo.
        return unicodedata.normalize("NFC", Path(p).name) if p else "환영합니다"

    def _read_path(self, p: Path | str) -> str:
        path = Path(p)
        if path.exists():
            try:
                return path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as exc:
                return f"> **파일을 읽을 수 없습니다:** {exc}"
        return WELCOME

    def _state_of(self, p: Path | str) -> dict:
        self._mtimes[str(p)] = self._mtime_of(p)
        return {"text": self._read_path(p), "title": self._title_of(p), "path": str(p)}

    def get_state(self) -> dict:
        """Initial document for the first tab (the launch file, or welcome)."""
        if self.path:
            state = self._state_of(self.path)
        else:
            state = {"text": WELCOME, "title": "환영합니다", "path": ""}
        state["folder"] = self.folder  # sidebar root (None unless launched on a folder)
        return state

    def list_dir(self, path: str) -> dict:
        """List a folder's subfolders and .qmd/.md/.markdown files for the
        sidebar tree (one level; folders are expanded lazily)."""
        try:
            p = Path(path).expanduser()
            entries = []
            for child in sorted(p.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower())):
                if child.name.startswith("."):
                    continue
                name = unicodedata.normalize("NFC", child.name)
                if child.is_dir():
                    entries.append({"name": name, "path": str(child), "is_dir": True})
                elif child.suffix.lower() in (".qmd", ".md", ".markdown"):
                    entries.append({"name": name, "path": str(child), "is_dir": False})
            return {"path": str(p), "name": unicodedata.normalize("NFC", p.name), "entries": entries}
        except OSError as exc:
            return {"path": path, "name": path, "entries": [], "error": str(exc)}

    def read_path(self, path: str) -> dict:
        """Read an arbitrary file into a new tab (used for Finder-opened files)."""
        return self._state_of(path)

    def help_doc(self) -> dict:
        """The welcome / help document, shown on demand (not at startup)."""
        return {"text": WELCOME, "title": "푸르름 도움말", "path": ""}

    def set_active(self, path: str) -> dict:
        """Frontend tells us which tab is focused so relative image paths and
        clipboard pastes resolve against the right document."""
        self.path = Path(path) if path else None
        return {"ok": True}

    def track(self, paths: list[str]) -> dict:
        """Sync the set of watched files to the currently open tabs."""
        keep: dict[str, float | None] = {}
        for p in paths or []:
            keep[p] = self._mtimes.get(p, self._mtime_of(p))
        self._mtimes = keep
        return {"ok": True}

    # -- open / save -------------------------------------------------------
    def open_file(self) -> dict | None:
        result = webview.windows[0].create_file_dialog(
            _OPEN,
            allow_multiple=False,
            file_types=("Quarto and Markdown (*.qmd;*.md;*.markdown)", "All files (*.*)"),
        )
        if not result:
            return None
        self.path = Path(result[0])
        return self._state_of(self.path)

    def open_folder(self) -> dict | None:
        """Pick a folder to show in the sidebar tree."""
        result = webview.windows[0].create_file_dialog(_FOLDER)
        if not result:
            return None
        path = result if isinstance(result, str) else result[0]
        self.folder = str(Path(path))
        return {"folder": self.folder}

    def save(self, text: str) -> dict:
        """Write the editor text to the active tab's file. Falls back to Save As
        when the active tab has no file yet (the welcome document)."""
        if not self.path:
            return self.save_as(text) or {"cancelled": True}
        try:
            self.path.write_text(text, encoding="utf-8")
        except OSError as exc:
            return {"error": str(exc)}
        # Remember the mtime we just wrote so the watcher doesn't treat our own
        # save as an external change and reload over the editor.
        self._mtimes[str(self.path)] = self._mtime_of(self.path)
        return {"saved": True, "title": self._title_of(self.path), "path": str(self.path)}

    def set_folder(self, path: str) -> dict:
        """Frontend tells us the sidebar's current folder, so Save defaults there."""
        self.folder = str(Path(path)) if path else None
        return {"ok": True}

    def save_as(self, text: str) -> dict | None:
        default = self._title_of(self.path) if self.path else "untitled.qmd"
        # Default the dialog to the active file's folder, else the open sidebar
        # folder, else wherever the OS last was.
        if self.path:
            directory = str(self.path.parent)
        elif self.folder:
            directory = self.folder
        else:
            directory = ""
        result = webview.windows[0].create_file_dialog(
            _SAVE, directory=directory, save_filename=default,
            file_types=("Quarto (*.qmd)", "All files (*.*)"),
        )
        if not result:
            return None
        dest = result if isinstance(result, str) else result[0]
        self.path = Path(dest)
        try:
            self.path.write_text(text, encoding="utf-8")
        except OSError as exc:
            return {"error": str(exc)}
        self._mtimes[str(self.path)] = self._mtime_of(self.path)
        return {"saved": True, "title": self._title_of(self.path), "path": str(self.path)}

    def poll(self) -> list[dict] | None:
        """Return fresh state for every open file that changed on disk."""
        changed = []
        for p in list(self._mtimes):
            current = self._mtime_of(p)
            if current != self._mtimes[p]:
                self._mtimes[p] = current
                if current is not None:  # ignore deletes; keep the tab as-is
                    changed.append(self._state_of(p))
        return changed or None

    # -- assets / export ---------------------------------------------------
    def resolve_asset(self, src: str) -> str | None:
        """Resolve an image path (relative to the open file) to a data: URI.

        Local files can't be loaded directly from the http-served page, so we
        read the bytes and inline them. Remote/data URIs are left untouched.
        """
        if not src or src.startswith(("http://", "https://", "data:")):
            return None
        base = self.path.parent if self.path else Path.cwd()
        candidate = Path(unquote(src)).expanduser()
        if not candidate.is_absolute():
            candidate = base / candidate
        try:
            candidate = candidate.resolve()
            if not candidate.is_file():
                return None
            data = candidate.read_bytes()
        except OSError:
            return None
        mime = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"

    def paste_image(self) -> dict:
        """If the system clipboard holds an image (and no text), save it as a
        PNG next to the open document and return its relative path.

        Read via NSPasteboard — WKWebView's web clipboard API is unreliable
        for images pasted from macOS screenshots.
        """
        try:
            from AppKit import (  # pyobjc, ships with pywebview
                NSBitmapImageFileTypePNG,
                NSBitmapImageRep,
                NSPasteboard,
                NSPasteboardTypePNG,
                NSPasteboardTypeString,
                NSPasteboardTypeTIFF,
            )
        except ImportError as exc:  # pragma: no cover
            return {"error": f"AppKit 불가: {exc}"}

        pb = NSPasteboard.generalPasteboard()
        # Text on the clipboard → this is a normal text paste; don't interfere.
        if pb.stringForType_(NSPasteboardTypeString):
            return {"skipped": "text"}
        data = pb.dataForType_(NSPasteboardTypePNG)
        if data is None:
            tiff = pb.dataForType_(NSPasteboardTypeTIFF)
            if tiff is not None:
                rep = NSBitmapImageRep.imageRepWithData_(tiff)
                if rep is not None:
                    data = rep.representationUsingType_properties_(NSBitmapImageFileTypePNG, {})
        if data is None:
            return {"skipped": "no-image"}
        return self._save_attachment(bytes(data), "paste")

    def save_drawing(self, data_url: str) -> dict:
        """Save a canvas drawing (a data:image/png;base64 URL from the in-app
        paint popup) into attachments/ next to the active document."""
        try:
            header, _, b64 = str(data_url).partition(",")
            if "base64" not in header:
                return {"error": "잘못된 이미지 데이터"}
            raw = base64.b64decode(b64)
        except (ValueError, TypeError) as exc:
            return {"error": str(exc)}
        return self._save_attachment(raw, "draw")

    def _save_attachment(self, data: bytes, prefix: str) -> dict:
        """Write PNG bytes to attachments/<prefix>-<timestamp>.png next to the
        active document and return the relative path."""
        if not self.path:
            return {"error": "이미지를 저장하려면 먼저 문서를 저장하세요 (⌘S)"}
        img_dir = self.path.parent / "attachments"
        try:
            img_dir.mkdir(exist_ok=True)
            name = datetime.datetime.now().strftime(f"{prefix}-%Y%m%d-%H%M%S.png")
            (img_dir / name).write_bytes(data)
        except OSError as exc:
            return {"error": str(exc)}
        return {"path": f"attachments/{name}"}

    def open_url(self, url: str) -> dict:
        """Open an external link in the default browser (links inside rendered
        widgets must never navigate the app window itself)."""
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            webbrowser.open(url)
            return {"opened": True}
        return {"opened": False}

    def open_export(self, html: str) -> dict:
        """Write a standalone print page and open it in the default browser so
        the user can print → Save as PDF.

        The page's relative asset URLs (fonts, css, highlight) must resolve
        against the bundled static dir, but the page itself has to be written
        somewhere writable (the bundle is read-only once installed). So inject a
        <base> pointing at STATIC and drop the file in a writable location."""
        base_tag = '<base href="' + STATIC.as_uri() + '/">'
        html = html.replace("<head>", "<head>" + base_tag, 1)
        try:
            EXPORT_HTML.parent.mkdir(parents=True, exist_ok=True)
            EXPORT_HTML.write_text(html, encoding="utf-8")
        except OSError as exc:
            return {"error": str(exc)}
        webbrowser.open(EXPORT_HTML.as_uri())
        return {"opened": True}


def _connect_primary(timeout: float = 0.6) -> socket.socket | None:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(str(CONTROL_SOCK))
        return s
    except OSError:
        s.close()
        return None


def _bind_control() -> socket.socket | None:
    """Elect this process as the primary by binding the Unix-domain control
    socket. Returns the listening socket, or None if another instance owns it.
    A stale socket file (crashed primary) is detected via connect and removed."""
    # Serialize election with an exclusive file lock so simultaneous launches
    # (e.g. opening several files at once, or reclaiming a stale socket left by a
    # crashed primary) can't each become their own window.
    lock_fd = None
    try:
        lock_fd = open(str(CONTROL_SOCK) + ".lock", "w")
        fcntl.flock(lock_fd.fileno(), fcntl.LOCK_EX)
    except OSError:
        lock_fd = None
    try:
        # A primary already listening? (connect to a stale socket fails fast.)
        probe = _connect_primary(0.4)
        if probe is not None:
            probe.close()
            return None
        # Absent or stale → reclaim the socket and become primary.
        try:
            os.unlink(CONTROL_SOCK)
        except OSError:
            pass
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            srv.bind(str(CONTROL_SOCK))
            srv.listen(8)   # listen before releasing the lock so the next
        except OSError:     # process's probe connects instead of re-electing
            srv.close()
            return None
        return srv
    finally:
        if lock_fd is not None:
            try:
                fcntl.flock(lock_fd.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
            lock_fd.close()


def _talk_to_primary(msg: dict, *, retries: int = 12, delay: float = 0.15) -> bool:
    """Send a message to the primary, retrying briefly: it may have won the bind
    race but not yet reached listen(). Returns True once delivered."""
    payload = (json.dumps(msg) + "\n").encode("utf-8")
    for _ in range(retries):
        s = _connect_primary()
        if s is not None:
            try:
                s.sendall(payload)
                return True
            except OSError:
                pass
            finally:
                s.close()
        time.sleep(delay)
    return False


def _serve_control(srv: socket.socket, on_request) -> None:
    """Run the primary's accept loop: hand each request dict to ``on_request``."""

    def loop() -> None:
        while True:
            try:
                conn, _ = srv.accept()
            except OSError:
                break
            with conn:
                conn.settimeout(1.0)
                data = b""
                try:
                    while b"\n" not in data and len(data) < 65536:
                        chunk = conn.recv(4096)
                        if not chunk:
                            break
                        data += chunk
                except OSError:
                    continue
                for line in data.decode("utf-8", "replace").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        req = json.loads(line)
                    except ValueError:
                        continue
                    on_request(req)

    threading.Thread(target=loop, daemon=True).start()


def main() -> int:
    args = sys.argv[1:]
    want_new = "--new-blank" in args
    folder = None
    if "--folder" in args:
        i = args.index("--folder")
        if i + 1 < len(args):
            cand = Path(args[i + 1]).expanduser()
            if cand.is_dir():
                folder = str(cand.resolve())
    initial = None
    for arg in args:
        if arg.startswith("--"):
            continue
        candidate = Path(arg).expanduser()
        if candidate.is_file():   # a real file, not a directory
            initial = candidate.resolve()
            break

    # Elect a single primary by binding the control socket. If we lose the bind,
    # another instance owns the window — hand it our request and exit.
    srv = _bind_control()
    if srv is None:
        if initial:
            msg = {"open": str(initial)}
        elif folder:
            msg = {"folder": folder}  # show this folder in the running window's sidebar
        elif want_new:
            msg = {"new": True}       # open a fresh blank tab in the running window
        else:
            msg = {"ping": True}
        if _talk_to_primary(msg):
            return 0
        # Couldn't reach the owner (port held by something unrelated): fall back
        # to opening our own window without a control server.

    _brand_menu()  # must run before the NSApplication menu is created
    api = Api(initial)
    api.folder = folder
    window = webview.create_window(
        APP_NAME,
        url=str(STATIC / "index.html"),
        js_api=api,
        width=1280,
        height=860,
        min_size=(640, 420),
        text_select=True,
    )

    def on_request(req: dict) -> None:
        # Called from the control-server thread; evaluate_js marshals to the UI.
        try:
            if req.get("open"):
                window.evaluate_js("window.QV && QV.openPath(" + json.dumps(req["open"]) + ")")
            elif req.get("folder"):
                window.evaluate_js("window.QV && QV.openFolder && QV.openFolder(" + json.dumps(req["folder"]) + ")")
            elif req.get("new"):
                window.evaluate_js("window.QV && QV.newBlank && QV.newBlank()")
        except Exception:  # pragma: no cover - window may be tearing down
            pass

    if srv is not None:
        api._server = srv  # keep a ref alive
        _serve_control(srv, on_request)

    def _post_start() -> None:
        # Runs once the Cocoa app is up (live NSApplication).
        _set_dock_icon()
        api._open_handler = _install_open_handler(window)  # keep ref alive

    # http_server=True serves local files over http so the vendored scripts and
    # the (blob-free) rendering pipeline load without file:// restrictions.
    webview.start(_post_start, http_server=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
