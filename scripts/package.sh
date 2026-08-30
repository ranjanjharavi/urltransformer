#!/usr/bin/env bash
# Builds a Chrome Web Store upload zip containing only the runtime extension files.
# Usage: ./scripts/package.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist"

# Everything the extension loads at runtime. Tests, docs, and tooling stay out.
RUNTIME_FILES=(
  manifest.json
  popup.html
  popup.css
  popup.js
  src
  images
)

cd "$ROOT_DIR"

command -v zip >/dev/null 2>&1 || {
  echo "error: 'zip' is not installed or not on PATH." >&2
  exit 1
}

for entry in "${RUNTIME_FILES[@]}"; do
  [ -e "$entry" ] || {
    echo "error: required extension file '$entry' is missing." >&2
    exit 1
  }
done

NAME="$(node -p "require('./manifest.json').name.toLowerCase().replace(/[^a-z0-9]+/g, '-')")"
VERSION="$(node -p "require('./manifest.json').version")"
ARCHIVE="$OUT_DIR/$NAME-$VERSION.zip"

mkdir -p "$OUT_DIR"
rm -f "$ARCHIVE"

# '*-master.*' skips the full-resolution design sources in images/ — they are
# not referenced by the manifest or the popup, and dwarf the shipped icons.
zip --recurse-paths --quiet "$ARCHIVE" "${RUNTIME_FILES[@]}" \
  --exclude '*.DS_Store' '*/.*' '*-master.*'

echo "Packaged $(du -h "$ARCHIVE" | cut -f1 | tr -d ' ') to ${ARCHIVE#"$ROOT_DIR"/}"
echo
unzip -l "$ARCHIVE"
