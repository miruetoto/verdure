cask "pururum" do
  version "1.1.0"
  sha256 "5b3c0744a73926a573d05ede9c6b11340786f025ca9f271cc6ecbdd177a377b4"

  url "https://github.com/guebin/pururum/releases/latest/download/Pururum.dmg",
      verified: "github.com/guebin/pururum/"
  name "Pururum"
  desc "Backend-free macOS app that renders and edits Quarto/Markdown live"
  homepage "https://github.com/guebin/pururum"

  depends_on macos: :monterey

  app "Pururum.app"

  # The build is ad-hoc signed, so macOS would refuse to open it while the
  # download flag is set. Homebrew adds that flag; take it back off.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Pururum.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/pururum",
    "~/Library/Preferences/com.local.pururum.plist",
    "~/Library/Saved Application State/com.local.pururum.savedState",
  ]
end
