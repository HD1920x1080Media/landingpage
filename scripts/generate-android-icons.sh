#!/usr/bin/env bash
# Erzeugt alle Android-Launcher-Icons + das Play-Store-Icon (512x512) aus einem Quellbild.
# Benötigt ImageMagick (convert). Für den Play Store ein Quellbild >= 1024x1024 verwenden.
#   ./scripts/generate-android-icons.sh pfad/zum/logo.png
set -euo pipefail

SRC="${1:-public/img/logos/HDProfile.webp}"
RES="android/app/src/main/res"
STORE="android/store"
mkdir -p "$STORE"

# Dichte:Launcher-Größe:Adaptive-Foreground-Größe (108dp)
for spec in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  IFS=: read -r density size fg <<<"$spec"
  dir="$RES/mipmap-$density"
  mkdir -p "$dir"
  convert "$SRC" -resize "${size}x${size}^" -gravity center -extent "${size}x${size}" "$dir/ic_launcher.png"
  convert "$SRC" -resize "${size}x${size}^" -gravity center -extent "${size}x${size}" \
    \( +clone -alpha extract -fill black -colorize 100 -fill white -draw "circle $((size/2)),$((size/2)) $((size/2)),0" \) \
    -alpha off -compose CopyOpacity -composite "$dir/ic_launcher_round.png"
  # Adaptive Icon: Foto füllt die komplette 108dp-Ebene, Android maskiert selbst
  convert "$SRC" -resize "${fg}x${fg}^" -gravity center -extent "${fg}x${fg}" "$dir/ic_launcher_foreground.png"
done

convert "$SRC" -resize "512x512^" -gravity center -extent 512x512 -alpha remove "$STORE/play-store-icon-512.png"
echo "Icons erzeugt aus $SRC"
