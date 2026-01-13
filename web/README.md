# Luanti Web Build

This directory contains all files necessary to build Luanti for the web using Emscripten/WebAssembly.

## Overview

The web build allows Luanti to run directly in modern web browsers without installation. It uses:

- **Emscripten** - Compiler toolchain for WebAssembly
- **WebAssembly (WASM)** - High-performance binary format for the web
- **WebGL 2.0** - Hardware-accelerated 3D graphics
- **SDL2** - Cross-platform input/windowing (via Emscripten)

## Directory Contents

- `Dockerfile` - Docker image with Emscripten 4.0.22 + ninja
- `Dockerfile.serve` - nginx server for serving the web build
- `01-build-luanti.sh` - Compiles Luanti to WebAssembly using Docker
- `02-build-www.sh` - Prepares the final web directory with assets and JS
- `serve-with-docker.sh` - Serve the build with proper WASM headers
- `emscripten-toolchain.cmake` - CMake toolchain configuration for Emscripten
- `nginx.conf` - nginx configuration with CORS headers for WASM
- `shell.html` - HTML template for the game interface
- `luanti-init.js` - Main JavaScript entry point and initialization
- `pre.js` - JavaScript pre-initialization code (feature detection, logging)
- `post.js` - JavaScript post-initialization helpers
- `README.md` - This file
- `OFFSCREENCANVAS-FIX.md` - Documentation for OffscreenCanvas support

## Quick Start

**Everything uses Docker** - no need to install Emscripten locally!

```bash
# 1. Build the WASM binary (from project root)
./web/01-build-luanti.sh

# 2. Prepare web assets and JS
./web/02-build-www.sh

# 3. Serve with proper WASM headers
./web/serve-with-docker.sh

# 4. Open browser to http://localhost:8080
```

That's it! The Docker image is built automatically on first run.

### What These Scripts Do

**`01-build-luanti.sh`**:
- Builds `luanti-web-builder` Docker image
- Compiles Luanti to WebAssembly
- Outputs to `build-web/output/`: `luanti.js`, `luanti.wasm`, `luanti.data`

**`02-build-www.sh`**:
- Creates `build-web/www/` directory
- Copies built artifacts from `output/`
- Copies `luanti-init.js` and other runtime dependencies
- This is where you run after modifying only JavaScript/HTML files

**`serve-with-docker.sh`**:
- Builds `luanti-web-server` Docker image (nginx)
- Serves files from `build-web/www/` with proper CORS headers
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
- Maximum memory: 4 GB (with growth enabled)
- Stack size: 10 MB
- Pthread stack size: 2 MB

These can be adjusted in `emscripten-toolchain.cmake` via `-sINITIAL_MEMORY`, `-sMAXIMUM_MEMORY`, and `-sSTACK_SIZE`.

### Performance Optimizations

The build uses several advanced Emscripten features for maximum performance:

- **JSPI (JavaScript Promise Integration)**: Uses `-sASYNCIFY=2` to allow synchronous C++ code to yield to the browser without the overhead of traditional Asyncify.
- **Multi-threading**: Enabled via `-pthread`. A pool of worker threads is pre-allocated for the server, network, and emerge threads.
- **Proxy to Pthread**: Enabled via `-sPROXY_TO_PTHREAD=1`. This moves the main Luanti execution off the main browser thread to a Web Worker, preventing UI freezes during heavy operations.
- **OffscreenCanvas**: Enabled via `-sOFFSCREENCANVAS_SUPPORT=1`. Allows rendering from the worker thread.
- **Mimalloc**: Uses the high-performance `mimalloc` allocator via `-sMALLOC=mimalloc`.
- **WASMFS**: Uses the modern WASMFS filesystem for faster I/O and better thread safety.
- **SIMD**: WebAssembly SIMD (`-msimd128`) is enabled for optimized vector operations.

### Graphics Settings

- WebGL 2.0 is required (OpenGL ES 3.0 equivalent)
- Full ES3 support is enabled
- Hardware acceleration is strongly recommended

### Preloaded Assets

The following directories are preloaded into the virtual filesystem at `/userdata`:
- `/userdata/builtin` - Core Lua scripts
- `/userdata/games` - Game definitions (including devtest)
- `/userdata/textures` - Base texture pack
- `/userdata/fonts` - Font files
- `/userdata/client` - Client configuration and shaders
- `/userdata/worlds` - World data

With `WASMFS=1`, files are preloaded directly to their target locations (no symlinks needed).

## Known Limitations

### Current Restrictions

- **LuaJIT not supported** - Uses vanilla Lua 5.1 instead
- **No gettext** - Internationalization disabled for now
- **Limited database backends** - Only SQLite3 supported
- **Network limitations** - WebSocket proxies required for multiplayer
- **Threading** - Fully enabled, but requires a browser with `SharedArrayBuffer` support (cross-origin isolated)

### Performance Considerations

- First load includes downloading ~50-100MB of assets
- Subsequent loads use browser cache
- Performance depends on client hardware and browser
- Memory usage higher than native builds due to WASM overhead

## Development

### Debug vs Production Builds

The build mode is controlled by passing the build type to `./web/01-build-luanti.sh`.

#### 🐛 **Debug Build**

**Target:** Development and debugging.

**Features:**
- Full C++ symbols with source maps (`-g -gsource-map`)
- Maximum assertions (`-sASSERTIONS=2`)
- Stack overflow detection (`-sSTACK_OVERFLOW_CHECK=2`)
- No optimizations (`-O0`)

**Usage:**
```bash
./web/01-build-luanti.sh Debug
```

#### 🚀 **Production Build** (Default)

**Target:** Deployment and performance.

**Features:**
- Maximum optimizations (`-O3`)
- Link Time Optimization (`-flto`)
- SIMD enabled (`-msimd128`)
- No debug symbols

**Usage:**
```bash
./web/01-build-luanti.sh Release
```

### Rebuilding

**Full clean rebuild** (after major changes or toolchain updates):
```bash
rm -rf build-web/
./web/01-build-luanti.sh
./web/02-build-www.sh
```

**Incremental C++ rebuild**:
```bash
./web/01-build-luanti.sh
```

**Fast web-only rebuild** (after changing `luanti-init.js` or `shell.html`):
```bash
./web/02-build-www.sh
```

### Testing

1. Build and serve:
```bash
./web/01-build-luanti.sh
./web/02-build-www.sh
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
			src="/index.html"
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

