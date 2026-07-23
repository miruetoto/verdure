cask "pururum" do
  version "2.1.0"
  sha256 "ed485a4d7a8a39df6014943117205043aaa2bbadaf5b488ccec8a83a77978acd"

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
