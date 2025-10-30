# Getting Started with Luanti Web Build

Welcome! This guide will help you understand what has been set up and how to proceed with building Luanti for the web.

## 🎉 What's Been Done

We've created a complete foundation for building Luanti as a WebAssembly application:

### 1. **Web Build Infrastructure** (`web/` directory)
   - ✅ `Dockerfile` - Multi-stage Docker build (Debian + Emscripten)
   - ✅ `build.sh` - Convenient build script for local development
   - ✅ `emscripten-toolchain.cmake` - CMake configuration for Emscripten
   - ✅ `shell.html` - Beautiful HTML interface for the game
   - ✅ `pre.js` / `post.js` - JavaScript initialization code
   - ✅ `README.md` - Comprehensive web build documentation

### 2. **Documentation**
   - ✅ `doc/compiling/web.md` - Detailed compilation instructions
   - ✅ Updated `.gitignore` for web artifacts

### 3. **CMake Integration**
   - ✅ Root `CMakeLists.txt` now detects Emscripten
   - ✅ Automatically disables incompatible features (LuaJIT, Redis, PostgreSQL, etc.)
   - ✅ Sets proper platform paths for web
   - ✅ IrrlichtMt graphics engine **already has Emscripten support built-in!**

### 4. **Source Code Updates**
   - ✅ Added SDL2 include directories for Emscripten
   - ✅ Platform detection in place

## 🚀 Next Steps - Getting Your First Build

Now comes the exciting part - actually building and testing! Here's what you should do:

### Step 1: Install Emscripten SDK

```bash
# Clone emsdk
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk

# Install latest version
./emsdk install latest
./emsdk activate latest

# Activate for current terminal
source ./emsdk_env.sh
```

Add to your `~/.bashrc` for permanent activation:
```bash
echo 'source /path/to/emsdk/emsdk_env.sh' >> ~/.bashrc
```

### Step 2: Try the Docker Build (Easiest)

```bash
cd /home/jan/projects/luanti

# Build with Docker (this will take a while first time)
docker build -f web/Dockerfile -t luanti-web .

# Run the web server
docker run -p 8080:80 luanti-web

# Open http://localhost:8080 in your browser
```

### Step 3: Or Try Local Build

```bash
cd /home/jan/projects/luanti

# Run the build script
./web/build.sh

# If successful, output will be in build-web/output/
# Test with a simple server:
cd build-web/output
python3 -m http.server 8080
```

## ⚠️ Expected Challenges

You **will** encounter issues on the first build. This is normal! Here's what to expect:

### 1. **Dependency Issues**
The Emscripten environment provides most dependencies (SDL2, zlib, etc.) but some may need configuration:
- **Solution**: Check `web/emscripten-toolchain.cmake` and adjust library paths
- Look for Emscripten ports: `emcc --show-ports`

### 2. **Compilation Errors**
Some C++ code may not be compatible with Emscripten:
- **Threading primitives** - Emscripten has limited pthreads support
- **Filesystem operations** - Need virtual filesystem
- **Network code** - WebSockets only, no raw TCP/UDP

### 3. **Linker Errors**
Common issues:
- Missing symbols from unsupported libraries
- Memory settings too low (adjust in `emscripten-toolchain.cmake`)
- Asset preloading failures (check file paths)

### 4. **Runtime Issues**
Even if it compiles:
- **Black screen** - WebGL context initialization failed
- **Memory errors** - Need to increase MAXIMUM_MEMORY
- **Loading forever** - Check browser console for errors

## 🔍 Debugging Strategy

### When Build Fails:

1. **Read the error carefully** - Emscripten errors can be verbose but informative

2. **Check the error type:**
   - **CMake error** → Problem in toolchain configuration
   - **Compiler error** → Code incompatibility with Emscripten
   - **Linker error** → Missing library or symbol

3. **Search for the error** - Many Emscripten issues are documented:
   - https://emscripten.org/docs/
   - https://github.com/emscripten-core/emscripten/issues

4. **Simplify:**
   - Try disabling features in `web/emscripten-toolchain.cmake`
   - Start with minimal build, add features incrementally

### When Runtime Fails:

1. **Open browser developer console** (F12)
   - Look for JavaScript errors
   - Check Network tab for loading issues

2. **Check the error message:**
   - "Out of memory" → Increase MAXIMUM_MEMORY
   - "WebGL context lost" → GPU/driver issue
   - "Abort()" → Check stdout for C++ error

3. **Enable debug build:**
   ```cmake
   # In emscripten-toolchain.cmake
   set(CMAKE_BUILD_TYPE Debug)
   -sASSERTIONS=2
   -g
   -gsource-map
   ```

## 📋 Common Fixes Cheat Sheet

### Fix 1: Library Not Found
```cmake
# In web/emscripten-toolchain.cmake, add:
set(USE_SDL2 TRUE)
set(SDL2_INCLUDE_DIRS ${EMSCRIPTEN_ROOT_PATH}/system/include/SDL2)
```

### Fix 2: Memory Issues
```cmake
# Increase memory allocation:
"-sINITIAL_MEMORY=512MB"
"-sMAXIMUM_MEMORY=4GB"
```

### Fix 3: Threading Errors
```cmake
# Disable threading for initial build:
# Comment out:
# "-pthread"
# "-sPTHREAD_POOL_SIZE=4"
```

### Fix 4: File Not Found (Runtime)
```cmake
# Add to preload in toolchain:
"--preload-file=${CMAKE_SOURCE_DIR}/missing-dir@/missing-dir"
```

### Fix 5: WebGL Errors
```javascript
// In shell.html, add more verbose errors:
Module.printErr = function(text) {
    console.error('WebGL Error:', text);
};
```

## 🎓 Learning Resources

### Emscripten Basics
- [Official Docs](https://emscripten.org/docs/)
- [Porting Guide](https://emscripten.org/docs/porting/index.html)
- [File System API](https://emscripten.org/docs/api_reference/Filesystem-API.html)

### WebAssembly
- [WebAssembly.org](https://webassembly.org/)
- [MDN WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly)

### Game Development with Emscripten
- [SDL2 with Emscripten](https://wiki.libsdl.org/SDL2/README/emscripten)
- [WebGL Reference](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API)

## 💡 Tips for Success

1. **Start Simple** - Get a basic build working before optimizing
2. **Iterate Quickly** - Use `-DCMAKE_BUILD_TYPE=Debug` for faster compile times
3. **Test in Multiple Browsers** - Chrome, Firefox, and Safari may behave differently
4. **Monitor Memory** - Check browser task manager during gameplay
5. **Use Docker** - Provides consistent environment, easier than local setup
6. **Read Logs** - Both compile-time and browser console logs are your friends
7. **Ask for Help** - The Emscripten and Luanti communities are helpful!

## 🐛 When You Hit a Wall

If you get completely stuck:

1. **Document the error:**
   - Full error message
   - Build command used
   - Emscripten version
   - Browser version (if runtime error)

2. **Try to isolate:**
   - Does Docker build work but local doesn't?
   - Does it build but not run?
   - Which specific file/library is failing?

3. **Check similar projects:**
   - Search GitHub for "emscripten game engine"
   - Look at other voxel engines ported to web
   - Check Emscripten showcase projects

4. **I'm here to help!** 
   - Share the specific error and I can guide you through it
   - We can iterate on the configuration together

## 🎯 Success Criteria

You'll know you're making progress when:

- ✅ **CMake configures** without errors
- ✅ **Compilation completes** (may take 20-60 minutes first time)
- ✅ **Files generated** - `luanti.js`, `luanti.wasm`, `luanti.data`
- ✅ **Loads in browser** - Shows loading screen
- ✅ **Displays graphics** - Even if buggy, seeing something is progress!
- ✅ **Main menu appears** - Huge milestone!
- ✅ **Game runs** - May be slow initially, optimization comes later

## 🔄 Iterative Development

Remember: **You don't need everything working at once!**

Good progression:
1. Get it to compile ✓
2. Get it to load in browser ✓
3. Get main menu working ✓
4. Get basic gameplay working ✓
5. Fix bugs ✓
6. Optimize performance ✓
7. Add nice-to-haves ✓

Each step is an achievement. Don't rush!

## 📞 What to Tell Me

When you try building and hit an issue, share:
1. Which method you used (Docker or local)
2. The complete error message (paste it)
3. Where it failed (CMake, compile, link, or runtime)
4. What you've already tried

I'll help you through each obstacle!

---

## Ready to Build?

```bash
# Quick start:
cd /home/jan/projects/luanti
docker build -f web/Dockerfile -t luanti-web .
```

Good luck! 🚀 This is going to be an awesome learning experience!

