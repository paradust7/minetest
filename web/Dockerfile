# Dockerfile for building Luanti for the web using Emscripten
# Based on official Emscripten Docker image (Debian-based)

FROM emscripten/emsdk:3.1.52 AS builder

# Install additional dependencies needed for Luanti
RUN apt-get update && apt-get install -y \
    ninja-build \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /src

# Copy source files
COPY CMakeLists.txt /src/
COPY README.md /src/
COPY minetest.conf.example /src/
COPY builtin /src/builtin
COPY cmake /src/cmake
COPY doc /src/doc
COPY fonts /src/fonts
COPY games /src/games
COPY lib /src/lib
COPY misc /src/misc
COPY po /src/po
COPY src /src/src
COPY irr /src/irr
COPY textures /src/textures
COPY web /src/web

# Build Luanti for web
RUN mkdir -p build && cd build && \
    emcmake cmake .. \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_TOOLCHAIN_FILE=/src/web/emscripten-toolchain.cmake \
        -DBUILD_CLIENT=TRUE \
        -DBUILD_SERVER=FALSE \
        -DBUILD_UNITTESTS=FALSE \
        -DBUILD_BENCHMARKS=FALSE \
        -DENABLE_GETTEXT=FALSE \
        -DENABLE_SOUND=TRUE \
        -DENABLE_CURL=TRUE \
        -DENABLE_FREETYPE=TRUE \
        -DRUN_IN_PLACE=TRUE \
        -GNinja && \
    cmake --build . --parallel $(nproc)

# Output directory for web artifacts
RUN mkdir -p /output && \
    cp build/bin/luanti.* /output/ && \
    cp /src/web/shell.html /output/index.html

# Runtime stage - lightweight web server for testing
FROM nginx:alpine

COPY --from=builder /output /usr/share/nginx/html

# Configure nginx for proper MIME types and CORS
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    # Enable CORS for SharedArrayBuffer (needed for threading) \
    add_header Cross-Origin-Opener-Policy "same-origin" always; \
    add_header Cross-Origin-Embedder-Policy "require-corp" always; \
    \
    # Proper MIME types for WebAssembly \
    types { \
        application/wasm wasm; \
        application/javascript js; \
        text/html html; \
    } \
    \
    location / { \
        try_files $uri $uri/ =404; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

