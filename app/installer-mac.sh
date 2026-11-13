#!/bin/sh
# Installe AppartHunt.app (par défaut dans ~/Applications) : l'Electron du projet, renommé, avec son icône.
# L'appli charge le code de ce dépôt : une modification du code s'applique sans réinstaller.
# À relancer seulement après une mise à jour d'Electron (npm install).
#   sh app/installer-mac.sh [dossier]
set -e
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-$HOME/Applications}/AppartHunt.app"
SRC="$APP_DIR/node_modules/electron/dist/Electron.app"
[ -d "$SRC" ] || { echo "Electron est absent : lance d'abord « npm install » dans $APP_DIR"; exit 1; }

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -R "$SRC" "$DEST"

# nom, identifiant et icône
P="$DEST/Contents/Info.plist"
plist() { /usr/libexec/PlistBuddy -c "Set :$1 \"$2\"" "$P" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :$1 string \"$2\"" "$P"; }
plist CFBundleName AppartHunt
plist CFBundleDisplayName AppartHunt
plist CFBundleIdentifier fr.apparthunt.app
plist CFBundleIconFile AppartHunt.icns
# sans ces phrases, macOS refuse en silence l'accès au Bureau ou aux Documents (là où est souvent le projet) au lieu de te demander
plist NSDesktopFolderUsageDescription "AppartHunt lit son code et tes données de recherche dans le dossier du projet."
plist NSDocumentsFolderUsageDescription "AppartHunt lit son code et tes données de recherche dans le dossier du projet."
cp "$APP_DIR/icon/AppartHunt.icns" "$DEST/Contents/Resources/AppartHunt.icns"

# l'appli à charger : le code de ce dépôt (même nom que package.json, donc mêmes réglages et mêmes chats)
mkdir -p "$DEST/Contents/Resources/app"
cat > "$DEST/Contents/Resources/app/package.json" <<EOF
{ "name": "apparthunt", "productName": "AppartHunt", "main": "index.js" }
EOF
cat > "$DEST/Contents/Resources/app/index.js" <<EOF
// AppartHunt.app : charge le code du dépôt ; si macOS en refuse l'accès, dit quoi faire au lieu de rester muet
try { require("$APP_DIR/main.js"); }
catch (e) {
  const { app, dialog } = require("electron");
  app.whenReady().then(() => {
    dialog.showErrorBox("AppartHunt ne peut pas lire le projet",
      e.code === "EPERM" ? "macOS bloque l'accès au dossier du projet ($APP_DIR).\\n\\nOuvre Réglages Système › Confidentialité et sécurité › Fichiers et dossiers, autorise AppartHunt pour ce dossier (Bureau ou Documents), puis relance l'appli."
        : String(e.stack || e));
    app.quit();
  });
}
EOF

# signature locale (le paquet a été modifié) et rafraîchissement de l'icône dans le Finder et le Dock
codesign --force --deep --sign - "$DEST" >/dev/null 2>&1
touch "$DEST"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST" >/dev/null 2>&1 || true
echo "AppartHunt est installée : $DEST"
echo "Lance-la depuis Launchpad, Spotlight (« AppartHunt ») ou garde-la dans le Dock."
