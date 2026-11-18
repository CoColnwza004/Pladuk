#!/usr/bin/env bash
# Renders all frames, generates the soundtrack and encodes the final video.
# Usage: ./build.sh            (full 1920x1080, ~2-3 h on a 4-core CPU with SwiftShader)
#        W=960 H=540 Q=low ./build.sh   (fast draft)
set -euo pipefail
cd "$(dirname "$0")"
W=${W:-1920}; H=${H:-1080}; Q=${Q:-high}
FRAMES=${FRAMES:-frames}
OUT=${OUT:-../output/pladuk_dam_cinematic.mp4}

[ -d node_modules/three ] || npm install
node render.cjs --out "$FRAMES" --w "$W" --h "$H" --q "$Q" --fps 24 --start 0 --end 1200
python3 audio.py soundtrack.wav
mkdir -p "$(dirname "$OUT")"
ffmpeg -y -framerate 24 -i "$FRAMES/f%05d.jpg" -i soundtrack.wav \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high \
  -c:a aac -b:a 256k -movflags +faststart -shortest "$OUT"
echo "done: $OUT"
