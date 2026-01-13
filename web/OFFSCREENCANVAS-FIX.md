# OffscreenCanvas Resize Fix

## Problem

When using Emscripten's OffscreenCanvas support (`OFFSCREENCANVASES_TO_PTHREAD`), the canvas is transferred from the main thread to a worker thread. After this transfer:

- The original HTML canvas becomes a "placeholder" that only displays the rendered output
- You **cannot** set `canvas.width` or `canvas.height` on the placeholder (throws `DOMException`)
- You **cannot** resize the OffscreenCanvas from the main thread using JavaScript APIs
- You **cannot** call `canvas.getContext()` on the placeholder (throws `InvalidStateError`)

Error messages encountered:
```
InvalidStateError: Failed to set the 'width' property on 'HTMLCanvasElement': 
Cannot resize canvas after call to transferControlToOffscreen().

InvalidStateError: Failed to execute 'getContext' on 'HTMLCanvasElement': 
Cannot get context from a canvas that has transferred its control to offscreen.
```

### Critical: Emscripten Bug with EGL Proxying

**Known Issue:** [Emscripten Issue #24792](https://github.com/emscripten-core/emscripten/issues/24792)

Emscripten has a bug where **all EGL functions are hardcoded to proxy to the main thread**, even when using `OFFSCREENCANVASES_TO_PTHREAD`. This causes the error:

```
InvalidStateError: Cannot get context from a canvas that has transferred its control to offscreen
```

**The Problem:**
1. `OFFSCREENCANVASES_TO_PTHREAD` transfers the canvas to the worker thread
2. EGL functions (`_eglCreateContext`, etc.) are still proxied back to main thread
3. Main thread tries to call `canvas.getContext()` on the transferred canvas
4. **→ Error!**

**The Workaround:**

We use a post-build script (`web/fix-egl-proxy.sh`) that patches the generated JavaScript to prevent EGL functions from being proxied. This script:
- Finds all `_egl*` functions in the generated `luanti.js`
- Removes/comments out the `if (ENVIRONMENT_IS_PTHREAD) return proxyToMainThread(...)` lines
- Allows EGL calls to execute directly on the worker thread where the OffscreenCanvas lives

This workaround is automatically applied by the build script (`01-build-luanti.sh`).

## Solution

The solution is a two-part architecture:

### Part 1: Main Thread (JavaScript) - Display Size Only

From the **main thread**, we only set the **CSS size** of the canvas, which controls how large it appears in the browser:

```javascript
canvas.style.width = displayWidth + 'px';
canvas.style.height = displayHeight + 'px';
```

This works for both regular canvas and placeholder canvas after OffscreenCanvas transfer.

### Part 2: Worker Thread (C++) - Backing Store Size

From the **worker thread** (where the game runs), we resize the **OffscreenCanvas backing store**, which controls the actual pixel resolution:

```cpp
emscripten_set_canvas_element_size("#canvas", width, height);
```

This function works correctly with OffscreenCanvas because it executes in the worker thread where the OffscreenCanvas lives.

## Changes Made

### 1. `/web/luanti-init.js`

**Removed**: All backing store resize logic from JavaScript
**Changed**: Only set CSS size from the resize handler
**Why**: JavaScript on the main thread cannot resize the OffscreenCanvas

### 2. `/irr/src/CIrrDeviceSDL.cpp`

**Changed**: Updated from deprecated API to new API:

| Old (Deprecated) | New (OffscreenCanvas-compatible) |
|-----------------|----------------------------------|
| `emscripten_set_canvas_size(w, h)` | `emscripten_set_canvas_element_size("#canvas", w, h)` |
| `emscripten_get_canvas_size(&w, &h, &fs)` | `emscripten_get_canvas_element_size("#canvas", &w, &h)` |

**Why**: The old API doesn't support OffscreenCanvas and throws errors when the canvas is transferred to a worker.

### 3. `/web/emscripten-toolchain.cmake`

**Removed**: `setCanvasSize` from `EXPORTED_RUNTIME_METHODS`
**Why**: No longer needed since C++ code handles resizing directly

**Removed**: `-sOFFSCREEN_FRAMEBUFFER=1` flag
**Added**: `-sOFFSCREEN_FRAMEBUFFER=0` flag (explicitly disable)
**Added**: `-sGL_WORKAROUND_SAFARI_GETCONTEXT_BUG=0` flag
**Why**: 
- `OFFSCREEN_FRAMEBUFFER=1` is incompatible with `OFFSCREENCANVASES_TO_PTHREAD`
- Even without the flag, Emscripten may proxy GL context creation to the main thread by default
- We must **explicitly disable** both the old framebuffer mechanism and Safari workaround
- Note: These flags alone are NOT sufficient due to Emscripten bug #24792

### 4. `/web/fix-egl-proxy.sh` (NEW FILE)

**Created**: Post-build script to patch EGL proxying
**Why**: Workaround for Emscripten bug #24792 where EGL calls are hardcoded to proxy to main thread
**What it does**: Finds and patches all `_egl*` functions to remove proxy calls

### 5. `/web/01-build-luanti.sh`

**Modified**: Added automatic execution of `fix-egl-proxy.sh` after successful build
**Why**: Ensures the EGL workaround is always applied without manual intervention

## How It Works

### The Resize Flow:

```
1. Browser window resizes
   ↓
2. JavaScript resize handler fires (main thread)
   ↓
3. Set canvas.style.width/height (CSS display size)
   ↓
4. SDL detects CSS size change (worker thread)
   ↓
5. SDL fires SDL_WINDOWEVENT_RESIZED event
   ↓
6. Irrlicht handles event, calls updateSizeAndScale()
   ↓
7. Irrlicht calls VideoDriver->OnResize()
   ↓
8. Rendering continues at new resolution
```

### Architecture:

```
┌─────────────────────────────────────────────────────────┐
│ Main Thread (Browser/JavaScript)                        │
│                                                          │
│ - Detects window resize events                          │
│ - Updates canvas.style.width/height (CSS size)          │
│ - Cannot touch canvas backing store (OffscreenCanvas)   │
└─────────────────────────────────────────────────────────┘
                         ↓
              CSS size change detected
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Worker Thread (C++/WASM)                                │
│                                                          │
│ - SDL polls canvas CSS size                             │
│ - Generates SDL_WINDOWEVENT_RESIZED                     │
│ - Calls emscripten_set_canvas_element_size()            │
│ - Resizes OffscreenCanvas backing store                 │
│ - Updates WebGL viewport                                │
└─────────────────────────────────────────────────────────┘
```

## Device Pixel Ratio (High-DPI) Handling

SDL is configured with `SDL_WINDOW_ALLOW_HIGHDPI` which should automatically handle high-DPI displays. However, on Emscripten with OffscreenCanvas, `SDL_GL_GetDrawableSize()` doesn't automatically account for `devicePixelRatio`.

**Implementation** (✅ FIXED):

1. **JavaScript side** (`luanti-init.js`):
   - Stores `window.devicePixelRatio` in `window._luantiDevicePixelRatio` during resize
   - Sets CSS size to match container (controls display size)

2. **C++ side** (`CIrrDeviceSDL.cpp`):
   - Added `emscripten_get_device_pixel_ratio()` helper function
   - Modified `updateSizeAndScale()` to:
     - Read DPR from JavaScript
     - Get CSS size from canvas element
     - Multiply CSS size by DPR to get physical pixel size
     - Set canvas backing store to physical pixel size
   - Modified `createWindowWithContext()` to apply DPR during initial setup

**Result**: Canvas backing store is properly scaled for high-DPI displays (e.g., 2x on Retina, 1.5x on some Windows displays), providing crisp rendering on all platforms.

## Testing

After rebuilding with these changes:

1. ✅ The `DOMException` error should be gone
2. ✅ The canvas should correctly resize when you resize the browser window
3. ✅ The game should render at the correct resolution accounting for device pixel ratio
4. ✅ High-DPI rendering (Retina, 4K) should display crisp, non-blurry graphics
5. ✅ macOS Retina displays should show the game at proper resolution (not low-res)

## Troubleshooting

### If you still see "Cannot get context from canvas that has transferred control to offscreen"

Check the browser console for `__emscripten_receive_on_main_thread_js` in the stack trace. If you see it, it means GL operations are still being proxied to the main thread.

**Causes:**
1. **Old build artifacts** - Do a clean rebuild: `rm -rf build-web/* && emcmake cmake .. && emmake make`
2. **Missing flags** - Ensure both `-sOFFSCREEN_FRAMEBUFFER=0` and `-sGL_WORKAROUND_SAFARI_GETCONTEXT_BUG=0` are in your cmake file
3. **Wrong Emscripten version** - OffscreenCanvas support improved significantly in Emscripten 3.1.8+. Update if needed.

### If GL context is still proxied after rebuild

Verify the generated JavaScript doesn't proxy EGL:
```bash
grep -c "__emscripten_receive_on_main_thread_js.*egl" build-web/bin/luanti.js
```
This should return 0. If it returns a number > 0, GL operations are still being proxied.

## References

- [Emscripten Canvas API Documentation](https://emscripten.org/docs/api_reference/html5.h.html#c.emscripten_set_canvas_element_size)
- [OffscreenCanvas MDN Documentation](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [Emscripten PROXY_TO_PTHREAD](https://emscripten.org/docs/porting/pthreads.html#additional-flags)

