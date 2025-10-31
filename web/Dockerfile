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
    && rm -rf /var/lib/apt/lists/*

# Verify installation
RUN ninja --version && echo "Ninja installed successfully"

# Set working directory
WORKDIR /src

# This image is meant to be used with volume mounts
# See web/build-with-docker.sh for usage

