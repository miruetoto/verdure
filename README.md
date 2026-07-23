# Pururum

A backend-free macOS app that **renders and edits Quarto / Markdown with a live
preview** — Obsidian/Typora-style. Headings, tables, callouts, tabsets, images
(with drawing), code, and MathJax formulas render inline as you type, and every
object (table, callout, tabset, image, front matter) is edited through a small
popup. The document itself stays plain `.qmd` / `.md`, and you can export the
whole thing to a single self-contained `.html` file.

### ▶︎ [Try it in your browser — guebin.github.io/pururum](https://guebin.github.io/pururum/)

No install, no sign-in. The web version is the same editor as the app; it opens
and saves `.qmd` / `.md` files right from the browser.

## Install (macOS)

Apple Silicon, macOS 12 (Monterey) or later. The build is ad-hoc signed — there
is no Apple Developer certificate behind it — so macOS blocks it after a plain
download. Pick whichever route suits you.

### 1. Homebrew

Open **Terminal** and run:

```bash
brew tap guebin/pururum https://github.com/guebin/pururum
brew trust guebin/pururum          # personal taps ask for this once
brew install --cask pururum
```

Pururum lands in `/Applications` like any other app (Launchpad, Spotlight, Dock)
and opens straight away. Update later with `brew upgrade --cask pururum`.

No Homebrew on your Mac? Route 2 needs nothing installed first.

### 2. One command, without Homebrew

Open **Terminal** and paste all six lines at once — they run as one command
that downloads, installs and opens Pururum:

```bash
curl -sL https://github.com/guebin/pururum/releases/latest/download/Pururum.dmg -o /tmp/Pururum.dmg &&
hdiutil attach /tmp/Pururum.dmg -nobrowse -quiet -mountpoint /tmp/PururumVol &&
ditto /tmp/PururumVol/Pururum.app /Applications/Pururum.app &&
hdiutil detach /tmp/PururumVol -quiet &&
xattr -dr com.apple.quarantine /Applications/Pururum.app &&
open /Applications/Pururum.app
```

### 3. By hand

[Download Pururum.dmg](https://github.com/guebin/pururum/releases/latest/download/Pururum.dmg)
and drop **Pururum** onto **Applications**.

macOS will refuse to open it — press **Done**, never **Move to Trash** (that
empties the app bundle). Then open **Terminal** and run this once:

```bash
xattr -dr com.apple.quarantine /Applications/Pururum.app
```

Nothing to install at all: the
[web version](https://guebin.github.io/pururum/) is the same editor.

## Uninstall

There are only two, since **2** and **3** both just place the app in
`/Applications` by hand.

### If you used 1 (Homebrew)

Open **Terminal** and run:

```bash
brew uninstall --cask pururum      # removes /Applications/Pururum.app
brew untap guebin/pururum          # optional: forget the tap as well
```

Use `brew uninstall --zap --cask pururum` to drop Pururum's settings at the same time.

### If you used 2 or 3

Drag **Pururum** from **Applications** to the Trash. Untitled documents you let
the app auto-save live in `~/Documents/Pururum` — delete that folder too if you
don't want them.
