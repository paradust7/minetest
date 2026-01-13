# Dockerfile for Luanti Web Builder
# This extends the official Emscripten image with ninja-build for faster compilation
#
# Build this image once:
#   docker build -f web/Dockerfile -t luanti-web-builder .
#
# Then use with build-with-docker.sh script

FROM emscripten/emsdk:4.0.22

LABEL description="Luanti web build environment with Emscripten and Ninja"
LABEL maintainer="Luanti contributors"

# Install ninja-build for faster compilation
# The emscripten image already has: cmake, python3, node, git, make
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ninja-build \
        wget \
    && rm -rf /var/lib/apt/lists/*

# Build zstd for Emscripten with pthread support (not available as a built-in port)
# Install to /usr/local so it persists even if Emscripten cache is cleared
RUN wget -q https://github.com/facebook/zstd/releases/download/v1.5.6/zstd-1.5.6.tar.gz && \
    tar -xzf zstd-1.5.6.tar.gz && \
    cd zstd-1.5.6/lib && \
    emmake make -j$(nproc) CC=emcc AR=emar CFLAGS="-O3 -pthread" libzstd.a && \
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
        -DCMAKE_CXX_FLAGS="-O3 -pthread" \
        -DCMAKE_C_FLAGS="-O3 -pthread" && \
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

# Make cache directories writable for non-root users (needed for -u flag in docker run)
RUN chmod -R 777 /emsdk/upstream/emscripten/cache

# Set working directory
WORKDIR /src

# This image is meant to be used with volume mounts
# See web/build-with-docker.sh for usage

