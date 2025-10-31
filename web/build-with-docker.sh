#!/usr/bin/env bash
# Simple script to build Luanti for web using Docker
# This follows the emscripten/emsdk pattern of mounting source directory

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Luanti Web Build with Docker ===${NC}"
echo ""

# Get script directory (should be /web)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Project root: $PROJECT_ROOT"
echo "Build output: $PROJECT_ROOT/build-web"
echo ""

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker not found!${NC}"
    echo "Please install Docker first."
    exit 1
fi

echo -e "${YELLOW}Checking for custom build image...${NC}"

# Check if our custom image exists, if not build it
if ! docker image inspect luanti-web-builder:latest >/dev/null 2>&1; then
    echo -e "${YELLOW}Building custom Docker image with ninja (one-time setup)...${NC}"
    docker build -f "${SCRIPT_DIR}/Dockerfile" -t luanti-web-builder:latest "$PROJECT_ROOT"
    echo ""
fi

echo -e "${YELLOW}Building Luanti with Emscripten 4.0.18...${NC}"
echo "This may take 20-60 minutes on first build."
echo ""

# Run the build in container
# Only mount project root - build-web will be inside it
docker run \
    --rm \
    -v "${PROJECT_ROOT}:/src" \
    -u $(id -u):$(id -g) \
    luanti-web-builder:latest \
    bash -c "
        set -e
        echo '=== Build Environment ==='
        emcc --version | head -n1
        echo \"Ninja: \$(ninja --version)\"
        echo ''
        
        # Clean previous build if it exists (to avoid cache issues)
        if [ -f /src/build-web/CMakeCache.txt ]; then
            echo 'Cleaning previous build...'
            rm -f /src/build-web/CMakeCache.txt
        fi
        
        # Build in /src/build-web (which is mounted from host)
        mkdir -p /src/build-web
        cd /src/build-web
        
        echo '=== Configuring CMake ==='
        emcmake cmake /src \
            -DCMAKE_BUILD_TYPE=Release \
            -DCMAKE_TOOLCHAIN_FILE=/src/web/emscripten-toolchain.cmake \
            -DBUILD_CLIENT=TRUE \
            -DBUILD_SERVER=FALSE \
            -DBUILD_UNITTESTS=FALSE \
            -DBUILD_BENCHMARKS=FALSE \
            -DENABLE_GETTEXT=FALSE \
            -DENABLE_SOUND=FALSE \
            -DENABLE_CURL=FALSE \
            -DENABLE_FREETYPE=TRUE \
            -DRUN_IN_PLACE=TRUE \
            -GNinja
        
        echo ''
        echo '=== Building (this will take a while) ==='
        cmake --build . --parallel \$(nproc)
        
        echo ''
        echo '=== Preparing output ==='
        mkdir -p /src/build-web/output
        
        # Copy Emscripten-generated files
        if [ -f bin/luanti.html ]; then
            cp bin/luanti.html /src/build-web/output/index.html
            echo 'Copied luanti.html -> index.html'
        fi
        if [ -f bin/luanti.js ]; then
            cp bin/luanti.js /src/build-web/output/
            echo 'Copied luanti.js'
        fi
        if [ -f bin/luanti.wasm ]; then
            cp bin/luanti.wasm /src/build-web/output/
            echo 'Copied luanti.wasm'
        fi
        if [ -f bin/luanti.data ]; then
            cp bin/luanti.data /src/build-web/output/
            echo 'Copied luanti.data (preloaded assets)'
        fi
        
        echo ''
        echo '=== Build Complete ==='
        ls -lh /src/build-web/output/ | tail -n +2
    "

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Build successful!${NC}"
    echo ""
    echo "Output files in: $PROJECT_ROOT/build-web/output"
    echo ""
    echo "To test locally, run:"
    echo "  cd $PROJECT_ROOT/build-web/output"
    echo "  python3 -m http.server 8080"
    echo ""
    echo "Then open: http://localhost:8080"
else
    echo ""
    echo -e "${RED}✗ Build failed${NC}"
    echo "Check the error messages above."
    exit 1
fi

