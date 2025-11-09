# Luanti Web Build

This directory contains all files necessary to build Luanti for the web using Emscripten/WebAssembly.

## Overview

The web build allows Luanti to run directly in modern web browsers without installation. It uses:

- **Emscripten** - Compiler toolchain for WebAssembly
- **WebAssembly (WASM)** - High-performance binary format for the web
- **WebGL 2.0** - Hardware-accelerated 3D graphics
- **SDL2** - Cross-platform input/windowing (via Emscripten)

## Directory Contents

- `Dockerfile` - Docker image with Emscripten + custom zstd compilation
- `Dockerfile.serve` - nginx server for serving the web build
- `build-with-docker.sh` - Automated Docker build script (recommended)
- `serve-with-docker.sh` - Serve the build with proper WASM headers
- `emscripten-toolchain.cmake` - CMake toolchain configuration for Emscripten
- `nginx.conf` - nginx configuration with CORS headers for WASM
- `shell.html` - HTML template for the game interface
- `pre.js` - JavaScript pre-initialization code (feature detection, logging)
- `post.js` - JavaScript post-initialization helpers (currently unused)
- `README.md` - This file
- `DEPENDENCIES.md` - Detailed dependency handling documentation

## Quick Start

**Everything uses Docker** - no need to install Emscripten locally!

```bash
# 1. Build the web version (from project root)
./web/build-with-docker.sh

# 2. Serve with proper WASM headers
./web/serve-with-docker.sh

# 3. Open browser to http://localhost:8080
```

That's it! The Docker image is built automatically on first run.

### What These Scripts Do

**`build-with-docker.sh`**:
- Builds `luanti-web-builder` Docker image (includes Emscripten 4.0.18 + zstd)
- Compiles Luanti to WebAssembly
- Outputs to `build-web/output/`: `index.html`, `luanti.js`, `luanti.wasm`, `luanti.data`

**`serve-with-docker.sh`**:
- Builds `luanti-web-server` Docker image (nginx)
- Serves files with proper CORS headers for SharedArrayBuffer/WASM
- No caching during development (always serves fresh files)

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

### Debug vs Production Builds

The build mode is controlled in `web/emscripten-toolchain.cmake`.

#### 🐛 **Debug Build** (Current Default)

**Output Size:**
- WASM: ~104 MB (with full debug symbols)
- JavaScript: ~573 KB

**Features:**
- Full C++ symbols in stack traces
- Detailed error messages and assertions
- Heap safety checking (`-sSAFE_HEAP=1`)
- Stack overflow detection (`-sSTACK_OVERFLOW_CHECK=2`)
- WebGL error tracking
- Exception catching enabled

**Configuration in `emscripten-toolchain.cmake`:**
```cmake
# Compile flags - KEEP the -g flag
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -g -sUSE_SDL=2 ...")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -g -sUSE_SDL=2 ...")

# Debug settings in EMSCRIPTEN_COMMON_FLAGS
"-sASSERTIONS=2"              # Maximum assertions
"-sSTACK_OVERFLOW_CHECK=2"    # Full stack checking
"-sSAFE_HEAP=1"               # Heap safety (slower but catches bugs)
"-sGL_DEBUG=1"                # GL debugging
"-sGL_ASSERTIONS=1"           # GL assertions
"-sGL_TRACK_ERRORS=1"         # Track GL errors

# In CMAKE_EXE_LINKER_FLAGS
"-sDISABLE_EXCEPTION_CATCHING=0"  # Enable C++ exceptions
```

#### 🚀 **Production Build**

**Output Size:**
- WASM: ~7-8 MB (optimized)
- JavaScript: ~340 KB

**Changes needed in `emscripten-toolchain.cmake`:**
```cmake
# 1. Remove -g flag from compile flags
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -sUSE_SDL=2 ...")    # No -g
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -sUSE_SDL=2 ...") # No -g

# 2. Change debug settings to production
"-sASSERTIONS=0"              # Disable assertions
"-sSTACK_OVERFLOW_CHECK=0"    # Disable (or use =1 for minimal)
# Remove: -sSAFE_HEAP=1
# Remove: -sGL_DEBUG=1
# Remove: -sGL_ASSERTIONS=1  
# Remove: -sGL_TRACK_ERRORS=1

# 3. Disable exception catching (smaller + faster)
"-sDISABLE_EXCEPTION_CATCHING=1"  # In linker flags
```

### Rebuilding

**Clean rebuild** (recommended after toolchain changes):
```bash
rm -rf build-web/
./web/build-with-docker.sh
```

**Incremental rebuild:**
```bash
./web/build-with-docker.sh
```

### Testing

1. Build and serve:
```bash
./web/build-with-docker.sh
./web/serve-with-docker.sh
```

2. Open http://localhost:8080 in browser

3. Check browser console (F12) for:
   - Initialization messages
   - Any error output
   - Performance metrics

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

## Embedding as an iframe

You can embed the Luanti web build in any page via an iframe. The `shell.html` and `luanti-init.js` are responsive and will render at the iframe's "native" size and track browser resizes automatically.

Minimal example:

```html
<style>
	html, body, #app { height: 100%; margin: 0; }
	/* The container determines the playable area */
	#play-area { position: fixed; inset: 0; } /* full viewport */
	/* Make the iframe fill its container and avoid layout gaps */
	iframe.luanti { width: 100%; height: 100%; border: 0; display: block; }
</style>
<div id="app">
	<div id="play-area">
		<iframe
			class="luanti"
			src="/build-web/output/index.html"
			allow="fullscreen; gamepad; cross-origin-isolated"
			referrerpolicy="no-referrer"
		></iframe>
	</div>
	<!-- Optional: If you have a header/footer, replace #play-area with a flex layout and keep the iframe container flex:1 -->
	<!--
	<style>
		body, #app { margin:0; height:100%; display:flex; flex-direction:column; }
		header { height:48px; }
		main { flex:1; min-height:0; }
	</style>
	<header>My Site Header</header>
	<main><iframe class="luanti" ...></iframe></main>
	-->
</div>
```

Notes:
- The iframe will automatically resize with the page. No host-side JavaScript is required if the container is sized with CSS.
- Inside the iframe, the canvas resolution matches the iframe size and device pixel ratio for crisp rendering.
- For non-fullscreen layouts, size the iframe’s container (e.g., via flexbox) and the game will adapt.

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

