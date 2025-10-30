#!/usr/bin/env bash
# Build script for Luanti web version
# This script builds Luanti for the web using Emscripten

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo -e "${GREEN}=== Luanti Web Build Script ===${NC}"
echo ""

# Check if Emscripten is available
if ! command -v emcc &> /dev/null; then
    echo -e "${RED}Error: Emscripten not found!${NC}"
    echo "Please install the Emscripten SDK:"
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk"
    echo "  ./emsdk install latest"
    echo "  ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

echo -e "${GREEN}Found Emscripten:${NC} $(emcc --version | head -n1)"
echo ""

# Build directory
BUILD_DIR="${PROJECT_ROOT}/build-web"
OUTPUT_DIR="${PROJECT_ROOT}/build-web/output"

# Clean previous build if requested
if [[ "$1" == "clean" ]]; then
    echo -e "${YELLOW}Cleaning previous build...${NC}"
    rm -rf "$BUILD_DIR"
fi

# Create build directory
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Configure with CMake
echo -e "${GREEN}Configuring build with CMake...${NC}"
emcmake cmake "$PROJECT_ROOT" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_TOOLCHAIN_FILE="${SCRIPT_DIR}/emscripten-toolchain.cmake" \
    -DBUILD_CLIENT=TRUE \
    -DBUILD_SERVER=FALSE \
    -DBUILD_UNITTESTS=FALSE \
    -DBUILD_BENCHMARKS=FALSE \
    -DENABLE_GETTEXT=FALSE \
    -DENABLE_SOUND=TRUE \
    -DENABLE_CURL=TRUE \
    -DENABLE_FREETYPE=TRUE \
    -DRUN_IN_PLACE=TRUE \
    -GNinja

# Build
echo ""
echo -e "${GREEN}Building Luanti for web...${NC}"
cmake --build . --parallel $(nproc)

# Copy output files
echo ""
echo -e "${GREEN}Copying output files...${NC}"
mkdir -p "$OUTPUT_DIR"
cp bin/luanti.* "$OUTPUT_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/shell.html" "$OUTPUT_DIR/index.html" 2>/dev/null || true

echo ""
echo -e "${GREEN}=== Build complete! ===${NC}"
echo ""
echo "Output files are in: $OUTPUT_DIR"
echo ""
echo "To test locally, you can use Python's built-in HTTP server:"
echo "  cd $OUTPUT_DIR"
echo "  python3 -m http.server 8080"
echo ""
echo "Then open http://localhost:8080 in your browser"
echo ""
echo -e "${YELLOW}Note:${NC} For full functionality including SharedArrayBuffer,"
echo "you may need proper CORS headers. Consider using the Docker setup instead."

