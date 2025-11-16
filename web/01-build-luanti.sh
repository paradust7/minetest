#!/usr/bin/env bash
# Simple script to build Luanti for web using Docker
# This follows the emscripten/emsdk pattern of mounting source directory
#
# Usage: ./01-build-luanti.sh [BUILD_TYPE]
#   BUILD_TYPE: Release (default), Debug, MinSizeRel, or RelWithDebInfo

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse build type parameter (default: Release)
BUILD_TYPE="${1:-Release}"

# Validate build type
case "$BUILD_TYPE" in
    Release|Debug|MinSizeRel|RelWithDebInfo)
        # Valid build type
        ;;
    *)
        echo -e "${RED}Error: Invalid build type '${BUILD_TYPE}'${NC}"
        echo ""
        echo "Valid build types:"
        echo -e "  ${GREEN}Release${NC}        - Maximum performance (default)"
        echo -e "  ${BLUE}MinSizeRel${NC}    - Minimum binary size"
        echo -e "  ${BLUE}RelWithDebInfo${NC} - Optimized with debug symbols"
        echo -e "  ${YELLOW}Debug${NC}          - No optimization, full debug info"
        echo ""
        echo "Usage: $0 [BUILD_TYPE]"
        echo "Example: $0 MinSizeRel"
        exit 1
        ;;
esac

echo -e "${GREEN}=== Luanti Web Build with Docker ===${NC}"
echo ""

# Get script directory (should be /web)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Project root: $PROJECT_ROOT"
echo "Build output: $PROJECT_ROOT/build-web"
echo -e "Build type:   ${GREEN}${BUILD_TYPE}${NC}"
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
echo "This may take a while on first build."
echo ""

# Run the build in container
# Only mount project root - build-web will be inside it
docker run \
    --rm \
    -v "${PROJECT_ROOT}:/src" \
    -u $(id -u):$(id -g) \
    -e BUILD_TYPE="${BUILD_TYPE}" \
    luanti-web-builder:latest \
    bash -c "
        set -e
        echo '=== Build Environment ==='
        emcc --version | head -n1
        echo \"Ninja: \$(ninja --version)\"
        echo \"Build type: \${BUILD_TYPE}\"
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
            -DCMAKE_BUILD_TYPE=\${BUILD_TYPE} \
            -DCMAKE_TOOLCHAIN_FILE=/src/web/emscripten-toolchain.cmake \
            -DBUILD_CLIENT=TRUE \
            -DBUILD_SERVER=FALSE \
            -DBUILD_UNITTESTS=FALSE \
            -DBUILD_BENCHMARKS=FALSE \
            -DENABLE_GETTEXT=FALSE \
            -DENABLE_SOUND=TRUE \
            -DENABLE_CURL=FALSE \
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
    echo -e "${GREEN}✓ Build successful! (${BUILD_TYPE})${NC}"
    echo ""
    echo "Output files in: $PROJECT_ROOT/build-web/output"
    
    # Apply EGL proxy workaround for OffscreenCanvas support
    # Workaround for: https://github.com/emscripten-core/emscripten/issues/24792
    echo ""
    echo "Applying EGL proxy workaround for OffscreenCanvas..."
    if bash "$PROJECT_ROOT/web/fix-egl-proxy.sh" "$PROJECT_ROOT/build-web/bin/luanti.js"; then
        echo -e "${GREEN}✓ EGL proxy workaround applied${NC}"
    else
        echo -e "${YELLOW}⚠ EGL proxy workaround failed (may not be needed)${NC}"
    fi
    echo ""
    
    # Show build type specific info
    case "$BUILD_TYPE" in
        Release)
            echo -e "${GREEN}Build type: Release${NC}"
            echo "  Optimizations: -O3 + LTO"
            echo "  Target: Maximum performance"
            ;;
        MinSizeRel)
            echo -e "${BLUE}Build type: MinSizeRel${NC}"
            echo "  Optimizations: -Oz + LTO"
            echo "  Target: Minimum binary size"
            ;;
        RelWithDebInfo)
            echo -e "${BLUE}Build type: RelWithDebInfo${NC}"
            echo "  Optimizations: -O2 + LTO + debug symbols"
            echo "  Target: Optimized with debugging"
            ;;
        Debug)
            echo -e "${YELLOW}Build type: Debug${NC}"
            echo "  Optimizations: None (-O0)"
            echo "  Target: Full debugging support"
            ;;
    esac
    echo ""
    
    echo "To test locally, run:"
    echo "  cd $PROJECT_ROOT/build-web/output"
    echo "  python3 -m http.server 8080"
    echo ""
    echo "Then open: http://localhost:8080"
else
    echo ""
    echo -e "${RED}✗ Build failed (${BUILD_TYPE})${NC}"
    echo "Check the error messages above."
    exit 1
fi

