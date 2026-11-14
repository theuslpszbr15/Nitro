#!/bin/bash
# Nitro installer for macOS: ./install/install.sh   (or --uninstall)
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/Nitro"

if [ "$1" = "--uninstall" ]; then rm -rf "$DEST"; echo "Nitro removido."; exit 0; fi

for v in 9 10 11 12; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
mkdir -p "$DEST"
cp -R "$SRC/CSXS" "$SRC/client" "$SRC/host" "$SRC/scripts" "$DEST/"
echo "Nitro instalado. Reinicie o After Effects e abra Window > Extensions > Nitro"
command -v brew >/dev/null && { command -v yt-dlp >/dev/null || brew install yt-dlp; command -v ffmpeg >/dev/null || brew install ffmpeg; }
