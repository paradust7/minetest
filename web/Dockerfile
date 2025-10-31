# Dockerfile for Luanti Web Builder
# This extends the official Emscripten image with ninja-build for faster compilation
#
# Build this image once:
#   docker build -f web/Dockerfile -t luanti-web-builder .
#
# Then use with build-with-docker.sh script

FROM emscripten/emsdk:4.0.18

LABEL description="Luanti web build environment with Emscripten and Ninja"
LABEL maintainer="Luanti contributors"

# Install ninja-build for faster compilation
# The emscripten image already has: cmake, python3, node, git, make
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ninja-build \
        wget \
    && rm -rf /var/lib/apt/lists/*

# Build zstd for Emscripten (not available as a built-in port)
# Download, compile, and install zstd
RUN wget -q https://github.com/facebook/zstd/releases/download/v1.5.6/zstd-1.5.6.tar.gz && \
    tar -xzf zstd-1.5.6.tar.gz && \
    cd zstd-1.5.6/lib && \
    emmake make -j$(nproc) CC=emcc AR=emar CFLAGS="-O3" libzstd.a && \
    mkdir -p /emsdk/upstream/emscripten/cache/sysroot/include && \
    mkdir -p /emsdk/upstream/emscripten/cache/sysroot/lib && \
    cp libzstd.a /emsdk/upstream/emscripten/cache/sysroot/lib/ && \
    cp zstd.h zdict.h zstd_errors.h /emsdk/upstream/emscripten/cache/sysroot/include/ && \
    cd ../.. && \
    rm -rf zstd-1.5.6 zstd-1.5.6.tar.gz

# Verify installation
RUN ninja --version && echo "Ninja installed successfully" && \
    ls -lh /emsdk/upstream/emscripten/cache/sysroot/lib/libzstd.a && \
    echo "Zstd compiled and installed"

# Make cache directories writable for non-root users (needed for -u flag in docker run)
RUN chmod -R 777 /emsdk/upstream/emscripten/cache

# Set working directory
WORKDIR /src

# This image is meant to be used with volume mounts
# See web/build-with-docker.sh for usage

