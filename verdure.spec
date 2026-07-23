# -*- mode: python ; coding: utf-8 -*-
# Build the self-contained 푸르름.app:  pyinstaller verdure.spec
from PyInstaller.utils.hooks import collect_submodules

datas = [
    ("quarto_viewer/static", "static"),
    ("appicon.icns", "."),
]

# pywebview loads its Cocoa backend + pyobjc bridges dynamically. It also does a
# lazy `import bottle` inside its http server (for http_server=True) that
# PyInstaller can't see — bundle it explicitly or the page never loads.
hiddenimports = (
    collect_submodules("webview")
    + ["bottle", "proxy_tools"]
    + ["objc", "Foundation", "AppKit", "WebKit", "Quartz", "CoreFoundation"]
)

a = Analysis(
    ["run_app.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Trim modules we never use to shrink the bundle / speed startup a touch.
    excludes=[
        "tkinter", "test", "unittest", "lib2to3", "pydoc_data",
        "distutils", "setuptools", "pip", "wheel", "pdb", "doctest",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Verdure",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=True,   # deliver double-clicked files to sys.argv on macOS
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="Verdure",
)

app = BUNDLE(
    coll,
    name="Verdure.app",           # ASCII folder name avoids Korean NFC/NFD path issues
    icon="appicon.icns",
    bundle_identifier="com.local.pureureum.viewer",
    info_plist={
        "CFBundleName": "푸르름",   # display name — shows in Dock / menu / Launchpad
        "CFBundleDisplayName": "푸르름",
        "CFBundleShortVersionString": "0.3.0",
        "CFBundleVersion": "0.3.0",
        "NSHighResolutionCapable": True,
        "LSMinimumSystemVersion": "11.0",
        "CFBundleDocumentTypes": [
            {
                "CFBundleTypeName": "Quarto or Markdown Document",
                "CFBundleTypeRole": "Editor",
                "LSHandlerRank": "Alternate",
                "CFBundleTypeExtensions": ["qmd", "md", "markdown"],
                "LSItemContentTypes": ["public.plain-text", "net.daringfireball.markdown"],
            }
        ],
    },
)
