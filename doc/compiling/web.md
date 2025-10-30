# Compiling for the Web (WebAssembly)

This guide explains how to compile Luanti for the web using Emscripten.

## Overview

Luanti can be compiled to WebAssembly (WASM) to run in modern web browsers. This enables playing Luanti without installation, directly in the browser.

## Prerequisites

### System Requirements

- Linux, macOS, or Windows with WSL2
- 8 GB RAM minimum (16 GB recommended)
- 5 GB free disk space
- Stable internet connection (for downloading Emscripten SDK)

### Software Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| Emscripten SDK | 3.1.52+ | WebAssembly compiler |
| CMake | 3.12+ | Build system |
| Python | 3.6+ | Required by Emscripten |
| Node.js | 16+ | Required by Emscripten |
| Ninja | - | Build tool (recommended) |

## Installing Emscripten SDK

### Linux / macOS

```bash
# Clone the Emscripten SDK repository
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk

# Install and activate the latest stable version
./emsdk install latest
./emsdk activate latest

# Add to current shell
source ./emsdk_env.sh

# Verify installation
emcc --version
```

To make Emscripten available in all terminal sessions, add this to your `~/.bashrc` or `~/.zshrc`:

```bash
source /path/to/emsdk/emsdk_env.sh
```

### Windows (WSL2)

Follow the Linux instructions above within your WSL2 environment.

## Downloading Source Code

If you haven't already cloned Luanti:

```bash
git clone --depth 1 https://github.com/luanti-org/luanti
cd luanti
```

## Building

### Method 1: Using the Build Script (Recommended)

The easiest way to build:

```bash
# From the project root
./web/build.sh
```

This script will:
1. Check for Emscripten installation
2. Configure CMake with appropriate settings
3. Build the web version
4. Copy output files to `build-web/output/`

For a clean rebuild:

```bash
./web/build.sh clean
```

### Method 2: Manual CMake Build

For more control over the build process:

```bash
# Create build directory
mkdir -p build-web
cd build-web

# Configure with Emscripten
emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_TOOLCHAIN_FILE=../web/emscripten-toolchain.cmake \
    -DBUILD_CLIENT=TRUE \
    -DBUILD_SERVER=FALSE \
    -DBUILD_UNITTESTS=FALSE \
    -DBUILD_BENCHMARKS=FALSE \
    -DENABLE_GETTEXT=FALSE \
    -DRUN_IN_PLACE=TRUE \
    -GNinja

# Build (use -j for parallel compilation)
ninja -j$(nproc)

# Or with make:
# make -j$(nproc)
```

### Method 3: Docker Build

Using Docker ensures a consistent build environment:

```bash
# Build the Docker image
docker build -f web/Dockerfile -t luanti-web .

# Run container with web server
docker run -p 8080:80 luanti-web

# Access at http://localhost:8080
```

To extract built files from Docker:

```bash
# Build and copy files out
docker build -f web/Dockerfile --target builder -t luanti-web-build .
docker create --name luanti-temp luanti-web-build
docker cp luanti-temp:/output ./web-output
docker rm luanti-temp
```

## Output Files

After building, you'll find these files in `build-web/output/` (or `bin/` if built manually):

- `luanti.js` - JavaScript loader
- `luanti.wasm` - WebAssembly binary
- `luanti.data` - Preloaded game assets (textures, games, etc.)
- `index.html` - Game interface (from `web/shell.html`)

## Running Locally

To test the web build, you need a web server. Here are several options:

### Python HTTP Server

Simple but lacks proper CORS headers:

```bash
cd build-web/output
python3 -m http.server 8080
# Open http://localhost:8080
```

### Node.js http-server

Supports CORS headers:

```bash
npm install -g http-server
cd build-web/output
http-server -p 8080 --cors
# Open http://localhost:8080
```

### PHP Built-in Server

```bash
cd build-web/output
php -S localhost:8080
# Open http://localhost:8080
```

### Using Docker Nginx (Recommended)

The Dockerfile includes a production-ready nginx server:

```bash
docker build -f web/Dockerfile -t luanti-web .
docker run -p 8080:80 luanti-web
# Open http://localhost:8080
```

## Browser Compatibility

### Minimum Versions

| Browser | Minimum Version | Notes |
|---------|----------------|-------|
| Chrome | 56 | Best performance |
| Firefox | 51 | Good performance |
| Safari | 15 | macOS/iOS |
| Edge | 79 | Chromium-based |
| Opera | 43 | Chromium-based |

### Required Features

- WebAssembly support
- WebGL 2.0 support
- ES6 JavaScript support
- SharedArrayBuffer (if threading enabled)

Check browser support at: https://caniuse.com/wasm

## Build Configuration

### CMake Options

Web-specific options in `web/emscripten-toolchain.cmake`:

```cmake
# Memory settings
-sINITIAL_MEMORY=256MB      # Starting memory
-sMAXIMUM_MEMORY=2GB        # Maximum allowed
-sALLOW_MEMORY_GROWTH=1     # Enable dynamic growth

# Graphics
-sFULL_ES3=1                # Full OpenGL ES 3.0
-sUSE_WEBGL2=1              # WebGL 2.0

# Threading (experimental)
# -pthread                   # Enable threads
# -sPTHREAD_POOL_SIZE=4     # Thread pool size
```

### Optimizing Build Size

For smaller WASM files:

```bash
emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=MinSizeRel \
    -DCMAKE_CXX_FLAGS="-Os" \
    ...
```

Additional size optimizations in toolchain file:
```cmake
-sELIMINATE_DUPLICATE_FUNCTIONS=1
-sMALLOC=emmalloc
```

### Debug Builds

For debugging with source maps:

```bash
emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Debug \
    ...
```

Add to toolchain file:
```cmake
-sASSERTIONS=2
-sSAFE_HEAP=1
-sSTACK_OVERFLOW_CHECK=2
```

## Troubleshooting

### Build Errors

**"emcc: command not found"**
```bash
# Activate Emscripten SDK
source /path/to/emsdk/emsdk_env.sh
```

**"Emscripten SDK not found"**
```bash
# Reinstall Emscripten
cd emsdk
./emsdk install latest
./emsdk activate latest
```

**CMake configuration fails**
```bash
# Clean build directory
rm -rf build-web
mkdir build-web
# Try again
```

### Runtime Errors

**"WebAssembly validation error"**
- Update your browser to the latest version
- Check WebAssembly support: https://webassembly.org/roadmap/

**"WebGL context lost"**
- Close other GPU-intensive applications
- Try a different browser
- Check GPU drivers are up to date

**"Out of memory"**
- Close other browser tabs
- Increase MAXIMUM_MEMORY in toolchain file
- Reduce game settings (viewing distance, etc.)

**Black screen / no rendering**
- Check browser console for errors
- Verify WebGL 2.0 support
- Try disabling browser extensions
- Check GPU hardware acceleration is enabled

### Performance Issues

- Enable hardware acceleration in browser settings
- Close unnecessary browser tabs
- Reduce in-game graphics settings
- Use Chrome or Firefox for best performance
- Check CPU/GPU usage in browser task manager

## Advanced Topics

### Enabling Threading

Threading is experimental but can improve performance:

```cmake
# In emscripten-toolchain.cmake, uncomment:
"-pthread"
"-sPTHREAD_POOL_SIZE=4"
```

Note: Requires proper CORS headers:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### Custom Asset Packing

To include custom games or mods:

```cmake
# In emscripten-toolchain.cmake, add:
"--preload-file=${CMAKE_SOURCE_DIR}/mymods@/mods"
```

### Persistent Storage

To save game data between sessions, use IndexedDB:

```javascript
// In pre.js
FS.mkdir('/saves');
FS.mount(IDBFS, {}, '/saves');
```

## Deployment

### Production Checklist

- [ ] Build with Release or MinSizeRel
- [ ] Enable gzip/brotli compression on web server
- [ ] Configure MIME types for `.wasm` files
- [ ] Set long cache headers for static assets
- [ ] Add CSP headers for security
- [ ] Test in all target browsers

### Example Nginx Configuration

```nginx
server {
    listen 80;
    root /var/www/luanti;
    
    # MIME types
    types {
        application/wasm wasm;
        application/javascript js;
        text/html html;
    }
    
    # Compression
    gzip on;
    gzip_types application/wasm application/javascript;
    
    # CORS for SharedArrayBuffer (if using threading)
    add_header Cross-Origin-Opener-Policy "same-origin";
    add_header Cross-Origin-Embedder-Policy "require-corp";
    
    # Cache static assets
    location ~* \.(wasm|js|data)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

## See Also

- [Web Build README](../../web/README.md) - Detailed web build documentation
- [Emscripten Documentation](https://emscripten.org/docs/)
- [WebAssembly Website](https://webassembly.org/)
- [Luanti Developer Docs](../developing/)

## Getting Help

If you encounter issues:

1. Check the [Luanti Forum](https://forum.luanti.org/)
2. Open an issue on [GitHub](https://github.com/luanti-org/luanti/issues)
3. Join the [Discord/IRC](https://www.luanti.org/community/) community

