# Luanti Web Build

This directory contains all files necessary to build Luanti for the web using Emscripten/WebAssembly.

## Overview

The web build allows Luanti to run directly in modern web browsers without installation. It uses:

- **Emscripten** - Compiler toolchain for WebAssembly
- **WebAssembly (WASM)** - High-performance binary format for the web
- **WebGL 2.0** - Hardware-accelerated 3D graphics
- **SDL2** - Cross-platform input/windowing (via Emscripten)

## Directory Contents

- `Dockerfile` - Multi-stage Docker build for web version
- `build.sh` - Shell script for building locally with Emscripten
- `emscripten-toolchain.cmake` - CMake toolchain configuration
- `shell.html` - HTML template for the game interface
- `pre.js` - JavaScript pre-initialization code
- `post.js` - JavaScript post-initialization code
- `README.md` - This file

## Quick Start

### Option 1: Docker Build (Recommended)

Build and run using Docker:

```bash
# From project root
docker build -f web/Dockerfile -t luanti-web .

# Run local web server
docker run -p 8080:80 luanti-web

# Open browser to http://localhost:8080
```

### Option 2: Local Build

Requirements:
- Emscripten SDK installed and activated
- CMake 3.12+
- Ninja build system (recommended)

```bash
# Install Emscripten SDK (first time only)
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh

# Build Luanti
cd /path/to/luanti
./web/build.sh

# Output files will be in build-web/output/
# Serve with any web server, e.g.:
cd build-web/output
python3 -m http.server 8080
```

## Browser Requirements

Minimum browser versions with WebGL 2.0 support:
- Chrome 56+
- Firefox 51+
- Safari 15+
- Edge 79+

Mobile browsers are supported but performance may vary.

## Configuration

### Memory Settings

The default configuration allocates:
- Initial memory: 256 MB
- Maximum memory: 2 GB (with growth enabled)
- Stack size: 5 MB

These can be adjusted in `emscripten-toolchain.cmake`.

### Graphics Settings

- WebGL 2.0 is required (OpenGL ES 3.0 equivalent)
- Full ES3 support is enabled
- Hardware acceleration is strongly recommended

### Preloaded Assets

The following directories are preloaded into the virtual filesystem:
- `/builtin` - Core Lua scripts
- `/games` - Game definitions (including devtest)
- `/textures` - Base texture pack
- `/fonts` - Font files

## Known Limitations

### Current Restrictions

- **LuaJIT not supported** - Uses vanilla Lua 5.1 instead
- **No gettext** - Internationalization disabled for now
- **Limited database backends** - Only SQLite3 supported
- **Network limitations** - WebSocket proxies required for multiplayer
- **Threading** - Currently disabled (can be enabled experimentally)

### Performance Considerations

- First load includes downloading ~50-100MB of assets
- Subsequent loads use browser cache
- Performance depends on client hardware and browser
- Memory usage higher than native builds due to WASM overhead

## Development

### Rebuilding

Clean rebuild:
```bash
./web/build.sh clean
```

### Debugging

For debug builds, modify `emscripten-toolchain.cmake`:
```cmake
set(CMAKE_BUILD_TYPE Debug)
set(CMAKE_CXX_FLAGS_DEBUG "-O0 -g -gsource-map")
```

Then add `-sASSERTIONS=2` to link flags for runtime checks.

### Testing

After building, test in a local browser:
1. Serve the output directory with a web server
2. Ensure proper CORS headers for SharedArrayBuffer (if using threading)
3. Check browser console for errors

## Deployment

### Production Checklist

- [ ] Build with Release configuration
- [ ] Optimize WASM size (`-Os` or `-Oz`)
- [ ] Enable compression (gzip/brotli) on web server
- [ ] Configure proper MIME types for `.wasm` files
- [ ] Set appropriate cache headers for static assets
- [ ] Configure CORS headers if using advanced features

### Web Server Configuration

Example nginx configuration:
```nginx
location / {
    # MIME types
    types {
        application/wasm wasm;
    }
    
    # CORS headers for SharedArrayBuffer
    add_header Cross-Origin-Opener-Policy "same-origin";
    add_header Cross-Origin-Embedder-Policy "require-corp";
    
    # Compression
    gzip on;
    gzip_types application/wasm application/javascript;
}
```

## Troubleshooting

### Build Fails

- Ensure Emscripten SDK is properly activated
- Check CMake version (3.12+ required)
- Verify all dependencies in `emscripten-toolchain.cmake`

### Runtime Errors

- Check browser console for detailed error messages
- Verify WebGL 2.0 support in your browser
- Ensure sufficient memory is available
- Try disabling browser extensions

### Performance Issues

- Check browser hardware acceleration is enabled
- Reduce viewing distance in game settings
- Lower graphics quality settings
- Close other tabs/applications

## Contributing

When contributing to the web build:

1. Test in multiple browsers (Chrome, Firefox, Safari)
2. Test on both desktop and mobile
3. Verify no new console warnings/errors
4. Check memory usage doesn't exceed limits
5. Update documentation for any new features

## Resources

- [Emscripten Documentation](https://emscripten.org/docs/)
- [WebAssembly Specification](https://webassembly.org/)
- [Luanti Developer Documentation](../doc/developing/)
- [Detailed Build Instructions](../doc/compiling/web.md)

## License

Same as Luanti: LGPL 2.1+ (see LICENSE.txt in project root)

