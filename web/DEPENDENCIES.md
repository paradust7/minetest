# Dependency Handling for Web Build

This document explains how Luanti's dependencies are handled when building for the web with Emscripten.

## TL;DR

**You don't need to install the Linux dependencies!** Emscripten provides its own WebAssembly-compatible versions.

## How Emscripten Dependencies Work

Emscripten includes a "ports" system that provides pre-compiled WebAssembly libraries. When you use a flag like `-sUSE_SDL=2`, Emscripten automatically downloads and links the SDL2 port.

## Dependency Mapping

### ✅ Provided by Emscripten Ports

These are downloaded and compiled by Emscripten automatically:

| Linux Package | Emscripten Equivalent | How it's enabled |
|---------------|----------------------|------------------|
| libsdl2-dev | SDL2 port (v2.28.5) | `-sUSE_SDL=2` compile flag |
| zlib1g-dev | Built-in zlib | `-sUSE_ZLIB=1` compile flag |
| libpng-dev | Built-in libpng | `-sUSE_LIBPNG=1` compile flag |
| libjpeg-dev | Built-in libjpeg | `-sUSE_LIBJPEG=1` compile flag |
| libfreetype6-dev | Freetype port | `-sUSE_FREETYPE=1` compile flag |
| libsqlite3-dev | Built-in sqlite3 | `-sUSE_SQLITE3=1` compile flag |

### 🔧 Custom Compiled in Dockerfile

These are **not** available as Emscripten ports and must be compiled manually:

| Linux Package | Solution | Where it's built |
|---------------|----------|------------------|
| libzstd-dev | Compiled with emcc | `web/Dockerfile` (v1.5.6) |

The Dockerfile compiles zstd from source and installs it to `/emsdk/upstream/emscripten/cache/sysroot/`.

### ✅ Bundled in Luanti Source

These are in the `lib/` directory:

| Dependency | Location | Notes |
|------------|----------|-------|
| Lua | `lib/lua/` | Vanilla Lua 5.1 (LuaJIT disabled) |
| GMP | `lib/gmp/` | mini-GMP implementation |
| JsonCPP | `lib/jsoncpp/` | Full implementation |
| BitOp | `lib/bitop/` | Lua bit operations |
| sha256 | `lib/sha256/` | Hashing library |
| Catch2 | `lib/catch2/` | Testing (disabled for web) |

### ❌ Disabled for Web Build

These features are **disabled** because they're not suitable for browser environment:

| Linux Package | Why Disabled | CMake Flag |
|---------------|--------------|------------|
| libgl1-mesa-dev | Uses WebGL instead of OpenGL | `ENABLE_OPENGL=OFF` |
| libx11-dev, libxrandr-dev | No X11 in browser | N/A (automatic) |
| libopenal-dev, libvorbis-dev, libogg-dev | Sound disabled for now | `ENABLE_SOUND=OFF` |
| libluajit-5.1-dev | LuaJIT not supported in WASM | `ENABLE_LUAJIT=OFF` |
| libcurl4-*-dev | HTTP disabled for initial build | `ENABLE_CURL=OFF` |
| gettext | I18n disabled for web build | `ENABLE_GETTEXT=OFF` |
| libpq-dev (PostgreSQL) | Database backends not needed | `ENABLE_POSTGRESQL=OFF` |
| libhiredis-dev (Redis) | Database backends not needed | `ENABLE_REDIS=OFF` |
| libleveldb-dev | Database backends not needed | `ENABLE_LEVELDB=OFF` |

## What You Actually Need to Install

For **Docker build**: Nothing! The `emscripten/emsdk` image has everything.

For **local build**:
```bash
# Just the Emscripten SDK
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

Optional for faster builds:
```bash
# Debian/Ubuntu
sudo apt install ninja-build

# Fedora
sudo dnf install ninja-build

# macOS
brew install ninja
```

## How Emscripten Finds Libraries

When you run `emcmake cmake`, Emscripten's CMake wrapper:

1. **Intercepts find_package()** calls
2. **Provides Emscripten-specific versions** of libraries
3. **Downloads ports** on-demand (cached in `~/.emscripten_cache/`)
4. **Links WebAssembly versions** instead of native libraries

Example: When CMake runs `find_package(SDL2)`, Emscripten:
- Returns success with Emscripten's SDL2 port paths
- Downloads SDL2 WASM if not cached (happens once)
- Links it as WebAssembly module

## Checking Available Ports

To see what's available in Emscripten:

```bash
# After activating emsdk
emcc --show-ports

# You'll see:
# Available ports:
#   sdl2
#   freetype
#   zlib
#   libpng
#   libjpeg
#   ... and many more
```

## When Ports Are Downloaded

Ports download **automatically** during the first build:

```
INFO:root:Downloading port: sdl2
INFO:root:Downloading: https://github.com/emscripten-ports/SDL2/archive/...
INFO:root:Unpacking to: /home/user/.emscripten_cache/ports/sdl2-...
```

This is **normal** and only happens once. Subsequent builds use the cache.

## Cache Location

Emscripten caches everything in `~/.emscripten_cache/`:
- Downloaded ports
- Compiled libraries  
- System headers

This can grow to ~500MB-1GB. You can clear it with:
```bash
emcc --clear-cache
```

## Troubleshooting

### "Cannot find SDL2"

**Solution**: Make sure you're using `emcmake`:
```bash
emcmake cmake ..  # Correct
cmake ..          # Wrong - won't find Emscripten libs
```

### Port download fails

**Solution**: Check your internet connection. Ports are downloaded from GitHub.

### Library version mismatch

**Solution**: Update Emscripten SDK:
```bash
cd emsdk
./emsdk update
./emsdk install latest
./emsdk activate latest
```

## Advanced: Using System Libraries

In theory, you could build dependencies yourself and link them, but **don't do this**. Emscripten ports are:
- Pre-configured for WebAssembly
- Tested to work together
- Optimized for size
- Automatically updated with Emscripten

## Summary

**For Luanti web build, you only need:**
1. ✅ Emscripten SDK (provides all libraries)
2. ✅ Ninja (optional, for faster builds)
3. ❌ NO Linux development libraries needed
4. ❌ NO manual library compilation needed

Emscripten handles everything! 🎉

