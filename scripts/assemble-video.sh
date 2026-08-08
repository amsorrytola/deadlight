#!/usr/bin/env bash
# Normalise every recorded clip to identical h264 params, top and tail with the
# title/closing cards, and concatenate into the final demo.
set -euo pipefail

DIR="${1:?usage: assemble-video.sh <clips-dir> [out.mp4]}"
OUT="${2:-$DIR/demo.mp4}"
WORK="$DIR/norm"
mkdir -p "$WORK"
rm -f "$WORK"/*.mp4 "$DIR/list.txt"

V="scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=#07080a,fps=30,format=yuv420p"
ENC=(-c:v libx264 -preset veryfast -crf 20 -profile:v high -level 4.0
     -c:a aac -b:a 96k -ar 48000 -shortest -movflags +faststart)

card() { # png, seconds, index
  ffmpeg -y -loglevel error -loop 1 -t "$2" -i "$1" \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
    -vf "$V,fade=t=in:st=0:d=0.4,fade=t=out:st=$(echo "$2 - 0.5" | bc):d=0.5" \
    "${ENC[@]}" "$WORK/$3.mp4"
}

i=0
[ -f "$DIR/card-title.png" ] && { card "$DIR/card-title.png" 5 "$(printf '%03d' $i)"; i=$((i+1)); }

for f in "$DIR"/[0-9]*.webm; do
  [ -s "$f" ] || { echo "skip empty $(basename "$f")" >&2; continue; }
  ffmpeg -y -loglevel error -i "$f" \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
    -vf "$V" "${ENC[@]}" "$WORK/$(printf '%03d' $i).mp4"
  i=$((i+1))
done

[ -f "$DIR/card-closing.png" ] && { card "$DIR/card-closing.png" 6 "$(printf '%03d' $i)"; i=$((i+1)); }

for f in "$WORK"/*.mp4; do echo "file '$f'"; done > "$DIR/list.txt"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$DIR/list.txt" -c copy "$OUT"

echo "built  : $OUT"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$OUT"
