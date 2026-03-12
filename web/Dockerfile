# Dockerfile for Luanti Web Builder
# This extends the official Emscripten image with ninja-build for faster compilation
#
# Build this image once:
#   docker build -f web/Dockerfile -t luanti-web-builder .
#
# Then use with build-with-docker.sh script

FROM emscripten/emsdk:5.0.0

LABEL description="Luanti web build environment with Emscripten and Ninja"
LABEL maintainer="Jan Hangebrauck"

# Install ninja-build for faster compilation
# The emscripten image already has: cmake, python3, node, git, make
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ninja-build \
        wget \
    && rm -rf /var/lib/apt/lists/*

# Build zstd for Emscripten with pthread support (not available as a built-in port)
# Install to /usr/local so it persists even if Emscripten cache is cleared
# Using -fwasm-exceptions (JS-based) for JSPI compatibility
RUN wget -q https://github.com/facebook/zstd/releases/download/v1.5.6/zstd-1.5.6.tar.gz && \
    tar -xzf zstd-1.5.6.tar.gz && \
    cd zstd-1.5.6/lib && \
    emmake make \
        -j$(nproc) \
        CC=emcc \
        AR=emar \
        CFLAGS="-O3 -pthread -fwasm-exceptions -flto" \
        CXXFLAGS="-O3 -pthread -fwasm-exceptions -flto" \
        libzstd.a && \
    mkdir -p /usr/local/include && \
    mkdir -p /usr/local/lib && \
    cp libzstd.a /usr/local/lib/ && \
    cp zstd.h zdict.h zstd_errors.h /usr/local/include/ && \
    cd ../.. && \
    rm -rf zstd-1.5.6 zstd-1.5.6.tar.gz

RUN wget -q https://github.com/libspatialindex/libspatialindex/releases/download/2.1.0/spatialindex-src-2.1.0.tar.gz && \
    tar -xzf spatialindex-src-2.1.0.tar.gz && \
    cd spatialindex-src-2.1.0 && \
    mkdir build && cd build && \
    emcmake cmake .. \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/usr/local \
        -DBUILD_SHARED_LIBS=OFF \
        -DCMAKE_CXX_FLAGS="-O3 -pthread -fwasm-exceptions -flto" \
        -DCMAKE_C_FLAGS="-O3 -pthread -fwasm-exceptions -flto" && \
    emmake make -j$(nproc) install && \
    cd ../.. && \
    rm -rf spatialindex-src-2.1.0 spatialindex-src-2.1.0.tar.gz

# Verify installation
RUN ninja --version && echo "Ninja installed successfully" && \
    ls -lh /usr/local/lib/libzstd.a && \
    ls -lh /usr/local/include/zstd.h && \
    echo "Zstd compiled and installed to /usr/local"

# Create dummy empty archive files for Emscripten ports
# These satisfy the linker while -sUSE_* flags provide the real implementation
RUN touch /tmp/empty.c && \
    emcc -c /tmp/empty.c -o /tmp/empty.o && \
    emar rcs /usr/local/lib/libEMSCRIPTEN_PORT.a /tmp/empty.o && \
    emar rcs /usr/local/lib/libEMSCRIPTEN_PORT_PNG.a /tmp/empty.o && \
    rm /tmp/empty.c /tmp/empty.o && \
    echo "Created dummy port libraries"

# CRITICAL: Clear and rebuild Emscripten ports with wasm-exceptions support
# All libraries (SDL2, SQLite3, libpng, freetype, zlib, ogg, vorbis, libjpeg) must be
# compiled with the SAME exception handling mode. Mixing -fwasm-exceptions code with
# non-wasm-exceptions code causes "unreachable" runtime errors when exceptions are thrown.
#
# We clear the cache and pre-build ports with consistent flags:
# - -fwasm-exceptions: Native WebAssembly exception handling
# - -pthread: Thread support
# - -sSUPPORT_LONGJMP=wasm: Use wasm exceptions for setjmp/longjmp (required for Lua)
#
# We must pre-build MULTIPLE variants to avoid race conditions during the actual build:
# 1. LTO variant (used by Release builds with -flto)
# 2. ThinLTO variant (used by CMake LTO capability tests with -flto=thin)
RUN emcc --clear-cache && \
    echo "Emscripten cache cleared"

# Pre-build all Emscripten ports - LTO variant (for Release builds)
# Using -fwasm-exceptions (JS-based) and -sSUPPORT_LONGJMP=wasm for JSPI compatibility
RUN echo 'int main(){}' > /tmp/prebuild.c && \
    emcc /tmp/prebuild.c -o /tmp/prebuild.html \
        -fwasm-exceptions \
        -pthread \
        -flto \
        -sUSE_SDL=2 \
        -sUSE_ZLIB=1 \
        -sUSE_LIBPNG=1 \
        -sUSE_LIBJPEG=1 \
        -sUSE_FREETYPE=1 \
        -sUSE_SQLITE3=1 \
        -sUSE_OGG=1 \
        -sUSE_VORBIS=1 && \
    rm -f /tmp/prebuild.c /tmp/prebuild.html /tmp/prebuild.js /tmp/prebuild.wasm && \
    echo "Emscripten ports pre-built (LTO variant)"

# Pre-build all Emscripten ports - ThinLTO variant (for CMake LTO tests)
RUN echo 'int main(){}' > /tmp/prebuild.c && \
    emcc /tmp/prebuild.c -o /tmp/prebuild.html \
        -fwasm-exceptions \
        -pthread \
        -flto=thin \
        -sUSE_SDL=2 \
        -sUSE_ZLIB=1 \
        -sUSE_LIBPNG=1 \
        -sUSE_LIBJPEG=1 \
        -sUSE_FREETYPE=1 \
        -sUSE_SQLITE3=1 \
        -sUSE_OGG=1 \
        -sUSE_VORBIS=1 && \
    rm -f /tmp/prebuild.c /tmp/prebuild.html /tmp/prebuild.js /tmp/prebuild.wasm && \
    echo "Emscripten ports pre-built (ThinLTO variant)"

# Pre-build non-LTO variant (for Debug builds and CMake feature tests)
RUN echo 'int main(){}' > /tmp/prebuild.c && \
    emcc /tmp/prebuild.c -o /tmp/prebuild.html \
        -fwasm-exceptions \
        -pthread \
        -sUSE_SDL=2 \
        -sUSE_ZLIB=1 \
        -sUSE_LIBPNG=1 \
        -sUSE_LIBJPEG=1 \
        -sUSE_FREETYPE=1 \
        -sUSE_SQLITE3=1 \
        -sUSE_OGG=1 \
        -sUSE_VORBIS=1 && \
    rm -f /tmp/prebuild.c /tmp/prebuild.html /tmp/prebuild.js /tmp/prebuild.wasm && \
    echo "Emscripten ports pre-built (non-LTO variant)"

# Make cache directories writable for non-root users (needed for -u flag in docker run)
RUN chmod -R 777 /emsdk/upstream/emscripten/cache

# Set working directory
WORKDIR /src

# This image is meant to be used with volume mounts
# See web/build-with-docker.sh for usage

