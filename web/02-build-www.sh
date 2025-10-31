#!/bin/bash
set -e

# Script: 02-build-www.sh
# Purpose: Fast rebuild of web assets (JS/HTML only, no C++ recompilation)
# Usage: Run this after making changes to web/*.js or web/*.html

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_ROOT/build-web"
OUTPUT_DIR="$BUILD_DIR/output"
WWW_DIR="$BUILD_DIR/www"

echo -e "\033[0;32m=== Fast Web Build ===$\033[0m"
echo "Project root: $PROJECT_ROOT"
echo "WWW output: $WWW_DIR"

# Check if the C++ build exists
if [ ! -f "$OUTPUT_DIR/luanti.js" ] || [ ! -f "$OUTPUT_DIR/luanti.wasm" ]; then
    echo -e "\033[1;31mError: Luanti build not found in $OUTPUT_DIR\033[0m"
    echo "Please run ./web/01-build-luanti.sh first!"
    exit 1
fi

# Create www directory
echo -e "\n\033[1;33mPreparing www directory...\033[0m"
rm -rf "$WWW_DIR"
mkdir -p "$WWW_DIR"

# Copy all built assets from output (Emscripten already processed shell.html -> index.html)
echo "Copying built assets..."
cp "$OUTPUT_DIR/index.html" "$WWW_DIR/"
cp "$OUTPUT_DIR/luanti.js" "$WWW_DIR/"
cp "$OUTPUT_DIR/luanti.wasm" "$WWW_DIR/"
cp "$OUTPUT_DIR/luanti.data" "$WWW_DIR/"

# Copy our custom initialization script (referenced in shell.html)
echo "Copying luanti-init.js..."
cp "$SCRIPT_DIR/luanti-init.js" "$WWW_DIR/"

echo "All assets copied successfully!"

echo -e "\n\033[0;32m=== Fast Build Complete ===$\033[0m"
ls -lh "$WWW_DIR"

echo -e "\n\033[1;32m✓ Fast build successful!\033[0m"
echo ""
echo "Output files in: $WWW_DIR"
echo ""
echo "To test, run:"
echo "  ./web/serve-with-docker.sh"
echo ""
echo "Or serve directly:"
echo "  cd $WWW_DIR"
echo "  python3 -m http.server 8080"

