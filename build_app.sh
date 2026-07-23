#!/usr/bin/env bash
# Build a macOS "푸르름.app" that launches this project.
#
# Two bundles working together:
#  1. The OUTER bundle (푸르름.app) is an AppleScript applet. Only an applet
#     receives Apple "open document" events, so double-clicking / drag-dropping
#     a .qmd works. It does no rendering itself — it just forwards the file(s).
#  2. The applet launches a NESTED bundle (Contents/Resources/launcher.app)
#     via `open -n -a … --args FILE`. Because the window-owning python process
#     is launched *as* that bundle, macOS shows it in the Dock/menu as "푸르름"
#     with our icon — not "python3.10". `--args` passes the file through argv,
#     and our single-instance IPC routes extra files into tabs.
#
# Re-run this after moving the project, then copy the new bundle to /Applications.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$PROJECT_DIR/푸르름.app"
PYTHON="$PROJECT_DIR/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  echo "venv Python이 없습니다: $PYTHON" >&2
  echo "먼저 'uv sync'를 실행하세요." >&2
  exit 1
fi

rm -rf "$APP"

# ---- 1) outer AppleScript applet (document receiver) -----------------------
SCPT="$(mktemp -t qv-applet).applescript"
cat > "$SCPT" <<'APPLESCRIPT'
-- Launch the nested identity bundle so the window process shows as 푸르름.
on launchViewer(argLine)
  set nested to (POSIX path of (path to me)) & "Contents/Resources/푸르름.app"
  do shell script "open -n -a " & quoted form of nested & argLine & " >/dev/null 2>&1"
end launchViewer

on run
  launchViewer("")
  tell me to quit
end run

on open theItems
  repeat with f in theItems
    launchViewer(" --args " & quoted form of POSIX path of f)
  end repeat
  tell me to quit
end open
APPLESCRIPT

osacompile -o "$APP" "$SCPT"
rm -f "$SCPT"

PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleName -string "푸르름" "$PLIST"
plutil -replace CFBundleIdentifier -string "com.local.pureureum" "$PLIST"
plutil -replace CFBundleShortVersionString -string "0.3.0" "$PLIST"
plutil -replace LSUIElement -bool true "$PLIST"   # applet is a transient launcher; no Dock tile of its own
plutil -replace CFBundleDocumentTypes -json '[
  {
    "CFBundleTypeName": "Quarto or Markdown Document",
    "CFBundleTypeRole": "Editor",
    "LSHandlerRank": "Alternate",
    "LSItemContentTypes": ["public.plain-text", "net.daringfireball.markdown"],
    "CFBundleTypeExtensions": ["qmd", "md", "markdown"]
  }
]' "$PLIST"

if [[ -f "$PROJECT_DIR/appicon.icns" ]]; then
  cp "$PROJECT_DIR/appicon.icns" "$APP/Contents/Resources/applet.icns"
fi

# ---- 2) nested identity bundle (owns the window → Dock name "푸르름") -------
# Named 푸르름.app so the Dock label is right even from the bundle filename.
NESTED="$APP/Contents/Resources/푸르름.app"
mkdir -p "$NESTED/Contents/MacOS" "$NESTED/Contents/Resources"

cat > "$NESTED/Contents/MacOS/푸르름" <<EOF
#!/bin/bash
# The window-owning process. Running it from inside this bundle makes macOS
# label it "푸르름"; exec keeps that identity even though the binary is python.
cd $(printf '%q' "$PROJECT_DIR")
exec $(printf '%q' "$PYTHON") -m quarto_viewer.app "\$@"
EOF
chmod +x "$NESTED/Contents/MacOS/푸르름"

if [[ -f "$PROJECT_DIR/appicon.icns" ]]; then
  cp "$PROJECT_DIR/appicon.icns" "$NESTED/Contents/Resources/app.icns"
fi

cat > "$NESTED/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>푸르름</string>
  <key>CFBundleName</key><string>푸르름</string>
  <key>CFBundleDisplayName</key><string>푸르름</string>
  <key>CFBundleIdentifier</key><string>com.local.pureureum.viewer</string>
  <key>CFBundleIconFile</key><string>app</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.3.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

# Sign inside-out, WITHOUT --deep (it bus-errors on the nested bundle here).
# The nested sign is intermittently flaky (occasional bus error), so retry
# until it verifies. Ad-hoc signing is best-effort; the app runs unsigned too.
sign_until_valid() {
  local target="$1"
  for _ in 1 2 3 4 5; do
    codesign --force -s - "$target" >/dev/null 2>&1 || true
    codesign -v "$target" >/dev/null 2>&1 && return 0
  done
  return 1
}
sign_until_valid "$NESTED/Contents/MacOS/푸르름" || true
sign_until_valid "$NESTED" || echo "⚠ nested 서명 실패 (unsigned로도 실행됨)"
sign_until_valid "$APP" || echo "⚠ outer 서명 실패 (unsigned로도 실행됨)"

echo "✅ 생성됨: $APP"
echo "   설치:  cp -R \"$APP\" /Applications/  (기존 것 교체)"
