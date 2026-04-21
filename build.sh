#!/usr/bin/env bash
# build.sh — Package Tabpus extension for Chrome Web Store submission
#
# Usage:  ./build.sh
# Output: extension.zip (in project root, gitignored)
#
# What's included:  Everything under extension/ that ships to users.
# What's excluded:  tests/, config.local.js, .DS_Store, icon.svg (source asset)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

ZIP_NAME="extension.zip"
SRC_DIR="extension"

# Sanity checks
if [ ! -d "$SRC_DIR" ]; then
  echo "❌ Error: '$SRC_DIR/' directory not found. Run from project root." >&2
  exit 1
fi

if [ ! -f "$SRC_DIR/manifest.json" ]; then
  echo "❌ Error: manifest.json not found in '$SRC_DIR/'." >&2
  exit 1
fi

# Read version from manifest.json (no jq dependency — pure grep/sed)
VERSION=$(grep '"version"' "$SRC_DIR/manifest.json" | sed 's/.*"version".*"\([^"]*\)".*/\1/')
echo "📦 Building Tabpus v${VERSION}..."

# Remove previous build
rm -f "$ZIP_NAME"

# Create zip, excluding dev-only files
cd "$SRC_DIR"
zip -r "../$ZIP_NAME" . \
  -x "tests/*" \
  -x "config.local.js" \
  -x "icons/icon.svg" \
  -x ".DS_Store" \
  -x "*/.DS_Store"
cd ..

# Report
SIZE=$(du -h "$ZIP_NAME" | cut -f1 | xargs)
FILE_COUNT=$(zipinfo -1 "$ZIP_NAME" | wc -l | xargs)
echo ""
echo "✅ Built: $ZIP_NAME ($SIZE, $FILE_COUNT files)"
echo "   Version: $VERSION"
echo ""
echo "Next steps:"
echo "  1. Test: Load unpacked from extension/ in chrome://extensions"
echo "  2. Upload: $ZIP_NAME → Chrome Web Store Developer Dashboard"
echo "     https://chrome.google.com/webstore/devconsole"
