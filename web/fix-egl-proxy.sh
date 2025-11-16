#!/bin/bash
# Workaround for Emscripten bug: https://github.com/emscripten-core/emscripten/issues/24792
# EGL calls are hardcoded to proxy to main thread, breaking OFFSCREENCANVAS_SUPPORT
# This script patches the generated luanti.js to skip proxying for EGL functions

set -e

LUANTI_JS="build-web/output/luanti.js"

if [ ! -f "$LUANTI_JS" ]; then
    echo "Error: $LUANTI_JS not found"
    exit 1
fi

echo "Applying EGL proxy workaround to $LUANTI_JS..."

# Backup original file
cp "$LUANTI_JS" "$LUANTI_JS.backup"

# Pattern: Find EGL function wrappers that have "if (ENVIRONMENT_IS_PTHREAD) return proxyToMainThread"
# and comment out or remove that line
# Create a sed script that will patch all EGL functions
# We'll look for patterns like:
#   function _eglCreateContext(...) {
#     if (ENVIRONMENT_IS_PTHREAD) return proxyToMainThread(...);
# And replace the proxy line with a comment

# Use perl for more powerful regex to match ALL _egl functions
# Match: function _eglXXX(...) { if (ENVIRONMENT_IS_PTHREAD) return proxyToMainThread(...); ... }
# Replace the proxy line with a comment

# Count occurrences before patching
PATCH_COUNT=$(grep -o -E 'function\s+_egl[a-zA-Z0-9_]+\([^)]*\)\{if\s*\(ENVIRONMENT_IS_PTHREAD\)[^;]+;' "$LUANTI_JS" | wc -l || echo "0")

# Apply the patch: comment out the if(ENVIRONMENT_IS_PTHREAD) block in all _egl functions
perl -i -p0e 's/(function\s+_egl[a-zA-Z0-9_]+\([^)]*\))\{(if\s*\(ENVIRONMENT_IS_PTHREAD\)[^;]+;)/$1\{\/*$2*\//gs' "$LUANTI_JS"

echo "Patched $PATCH_COUNT EGL function(s)"

if [ $PATCH_COUNT -eq 0 ]; then
    echo "Warning: No EGL proxy calls found to patch. Either:"
    echo "  1. Emscripten has fixed the bug, or"
    echo "  2. The code structure has changed"
    echo "Check the generated code manually."
else
    echo "EGL proxy workaround applied successfully!"
    echo "Backup saved to $LUANTI_JS.backup"
fi



