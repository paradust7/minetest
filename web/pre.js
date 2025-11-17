// Pre-initialization JavaScript for Luanti
// This runs before the main Emscripten module loads

console.log('Luanti Web - Pre-initialization');

// Detect if we're in a worker thread (PROXY_TO_PTHREAD runs main() in worker)
var isMainThread = typeof window !== 'undefined';
var isWorker = typeof importScripts === 'function';

// Initialize SharedArrayBuffer for socket proxy on MAIN THREAD ONLY
// Workers will receive the buffer via postMessage when they are created
if (isMainThread && typeof SharedArrayBuffer !== 'undefined') {
    console.log('[pre.js] Creating shared socket buffer on main thread');
    var SOCKET_SHARED_MEMORY_SIZE = 1024 * 1024; // 1MB
    var _luantiSocketSharedBuffer = new SharedArrayBuffer(SOCKET_SHARED_MEMORY_SIZE);
    var _luantiSocketSharedInt32 = new Int32Array(_luantiSocketSharedBuffer);
    
    // Initialize the buffer
    var OFFSET_NEXT_FD = 0;
    var OFFSET_LOCK = 1;
    var OFFSET_PACKET_WRITE_IDX = 2;
    var OFFSET_PACKET_READ_IDX = 3;
    var OFFSET_PACKET_LOCK = 4;
    var OFFSET_SOCKET_DATA = 5;
    var MAX_SOCKETS = 32; // Reduced to make more room for packet buffer
    var SOCKET_ENTRY_SIZE = 16;
    var PACKET_BUFFER_START = OFFSET_SOCKET_DATA + (MAX_SOCKETS * SOCKET_ENTRY_SIZE);
    var PACKET_ENTRY_SIZE = 520;
    var MAX_PACKETS = Math.floor((SOCKET_SHARED_MEMORY_SIZE / 4 - PACKET_BUFFER_START) / PACKET_ENTRY_SIZE); // Calculate from available space
    
    console.log('[pre.js] Calculated MAX_PACKETS=' + MAX_PACKETS + ' from 1MB SharedArrayBuffer');
    
    // Initialize control variables
    Atomics.store(_luantiSocketSharedInt32, OFFSET_NEXT_FD, 100);
    Atomics.store(_luantiSocketSharedInt32, OFFSET_LOCK, 0);
    Atomics.store(_luantiSocketSharedInt32, OFFSET_PACKET_WRITE_IDX, 0);
    Atomics.store(_luantiSocketSharedInt32, OFFSET_PACKET_READ_IDX, 0);
    Atomics.store(_luantiSocketSharedInt32, OFFSET_PACKET_LOCK, 0);
    
    // Initialize socket entries
    for (var i = 0; i < MAX_SOCKETS; i++) {
        var offset = OFFSET_SOCKET_DATA + (i * SOCKET_ENTRY_SIZE);
        Atomics.store(_luantiSocketSharedInt32, offset, -1);
    }
    
    // Initialize packet buffer entries
    for (var i = 0; i < MAX_PACKETS; i++) {
        var offset = PACKET_BUFFER_START + (i * PACKET_ENTRY_SIZE);
        Atomics.store(_luantiSocketSharedInt32, offset, 0); // valid flag = 0 (empty)
    }
    
    // Store in a global location accessible to worker initialization
    // We'll use 'self' which works in both window and worker contexts
    self._luantiSocketSharedBuffer = _luantiSocketSharedBuffer;
    self._luantiSocketSharedInt32 = _luantiSocketSharedInt32;
    
    console.log('[pre.js] Shared socket buffer initialized and stored in self');
    
    // Hook Worker constructor to pass SharedArrayBuffer AND packet queues to workers
    // This ensures workers have access to the SAME packet queue object
    var OriginalWorker = self.Worker;
    self.Worker = function(scriptURL, options) {
        console.log('[pre.js] Creating worker, will inject SharedArrayBuffer and packet queues');
        var worker = new OriginalWorker(scriptURL, options);
        
        // Immediately send the SharedArrayBuffer AND packet queues reference to the worker
        // Note: Regular objects can't be transferred, but we can use a workaround
        // by storing the packet queues in a way that's accessible via Atomics.notify/wait
        worker.postMessage({
            cmd: '_luantiSocketInit',  // Use underscore prefix to avoid conflicts
            sharedBuffer: self._luantiSocketSharedBuffer,
            // We can't actually send the packet queues object reference across threads
            // Each thread will need its own copy, but we'll use the SharedArrayBuffer
            // to coordinate packet delivery
        });
        
        return worker;
    };
    // Copy static properties from original Worker constructor
    for (var prop in OriginalWorker) {
        if (OriginalWorker.hasOwnProperty(prop)) {
            self.Worker[prop] = OriginalWorker[prop];
        }
    }
    
    console.log('[pre.js] Worker constructor hooked to inject SharedArrayBuffer');
}

// Worker thread: Receive the SharedArrayBuffer from main thread
if (isWorker) {
    console.log('[pre.js] Worker thread setting up SharedArrayBuffer listener');
    
    // Listen for our custom initialization message
    // This will arrive before Emscripten's pthread initialization
    self.addEventListener('message', function(e) {
        if (e.data && e.data.cmd === '_luantiSocketInit' && e.data.sharedBuffer) {
            console.log('[pre.js] Worker received SharedArrayBuffer via postMessage');
            self._luantiSocketSharedBuffer = e.data.sharedBuffer;
            self._luantiSocketSharedInt32 = new Int32Array(e.data.sharedBuffer);
            console.log('[pre.js] SharedArrayBuffer initialized in worker');
        }
    });
}

// Only run browser checks on main thread
if (isMainThread) {
    // Check for required browser features
    (function checkBrowserSupport() {
        var errors = [];
        
        if (!window.WebAssembly) {
            errors.push('WebAssembly is not supported');
        }
        
        if (!window.WebGLRenderingContext) {
            errors.push('WebGL is not supported');
        }
        
        // Check for WebGL 2.0
        var canvas = document.createElement('canvas');
        // var gl = canvas.getContext('webgl2');
        // if (!gl) {
        //     errors.push('WebGL 2.0 is not supported');
        // }
        
        if (errors.length > 0) {
            console.error('Browser compatibility errors:', errors);
            alert('Your browser does not support the required features to run Luanti:\n\n' + errors.join('\n') + '\n\nPlease use a modern browser like Chrome, Firefox, or Edge.');
        }
    })();
}

// WORKAROUND for Emscripten bug: https://github.com/emscripten-core/emscripten/issues/24792
// EGL calls are hardcoded to proxy to main thread, which breaks OFFSCREENCANVAS_SUPPORT
// This is a known bug in Emscripten as of January 2025
// We need to patch the proxying mechanism to skip EGL functions when using OffscreenCanvas
(function applyEGLProxyWorkaround() {
    console.log('[pre.js] Preparing EGL proxy workaround for OffscreenCanvas support');
    
    // This will be called after the module loads
    // We'll intercept the proxy mechanism and skip EGL functions
    if (typeof self !== 'undefined') {
        self._luanti_skipEGLProxy = true;
        console.log('[pre.js] EGL proxy skip flag set');
    }
})();

// NOTE: FS operations moved to shell.html's Module.preRun
// This file just does feature detection and logging

// Main thread only: Performance monitoring, event handlers, etc.
if (isMainThread) {
    // Performance monitoring
    var perfStats = {
        startTime: Date.now(),
        frameCount: 0,
        lastFpsUpdate: Date.now()
    };

    // Log performance stats periodically (optional, can be disabled)
    if (typeof Module !== 'undefined' && typeof Module.enablePerfStats !== 'undefined' && Module.enablePerfStats) {
        setInterval(function() {
            var now = Date.now();
            var elapsed = (now - perfStats.lastFpsUpdate) / 1000;
            var fps = perfStats.frameCount / elapsed;
            
            console.log('Performance: ' + fps.toFixed(1) + ' FPS');
            
            perfStats.frameCount = 0;
            perfStats.lastFpsUpdate = now;
        }, 5000);
    }

    // Handle beforeunload - save state if possible
    window.addEventListener('beforeunload', function(e) {
        console.log('Page unloading, attempting to save state...');
        // Emscripten's IDBFS can be used here to persist filesystem changes
        // This would be implemented later for saved games
    });

    // Disable right-click context menu globally for game area
    // This needs to work in both locked and unlocked pointer modes
    function preventContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }

    function preventKeyDefault(e) {
        // Only prevent defaults for keys that cause unwanted browser actions
        // Allow normal typing keys to work in text fields
        
        // Prevent function keys (F1-F12)
        if (e.key && e.key.startsWith('F') && e.key.length > 1 && e.key.length <= 3 && e.key !== 'F11') {
            e.preventDefault();
            return;
        }
        
        // Prevent browser shortcuts (Ctrl/Cmd + key)
        if (e.ctrlKey || e.metaKey) {
            // Allow common text editing shortcuts
            const allowedKeys = ['a', 'c', 'v', 'x', 'z', 'y'];
            if (!allowedKeys.includes(e.key?.toLowerCase())) {
                e.preventDefault();
                return;
            }
        }
    }
    
    function attachContextMenuPrevention() {
        var canvas = document.getElementById('canvas');
        if (canvas) {
            // Prevent context menu on canvas (capture phase to catch it early)
            canvas.addEventListener('contextmenu', preventContextMenu, true);
            
            // Also prevent on mousedown for right button (extra safety)
            canvas.addEventListener('mousedown', function(e) {
                if (e.button === 2) { // Right mouse button
                    e.preventDefault();
                }
            }, true);
            
            // Monitor pointer lock changes to ensure context menu stays disabled
            document.addEventListener('pointerlockchange', function() {
                console.log('Pointer lock changed. Locked:', !!document.pointerLockElement);
            });

            document.addEventListener('keydown', preventKeyDefault);
            document.addEventListener('keyup', preventKeyDefault);
            document.addEventListener('keypress', preventKeyDefault);

            console.log('Right-click context menu prevention attached to canvas');
            return true;
        }
        return false;
    }
    
    // Try to attach immediately
    if (!attachContextMenuPrevention()) {
        // If canvas doesn't exist yet, wait for DOMContentLoaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', attachContextMenuPrevention);
        } else {
            // DOM already loaded, try polling a few times
            var attempts = 0;
            var pollInterval = setInterval(function() {
                attempts++;
                if (attachContextMenuPrevention() || attempts > 10) {
                    clearInterval(pollInterval);
                }
            }, 100);
        }
    }

    // Mobile/touch detection
    var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
        console.log('Mobile device detected');
        if (typeof Module !== 'undefined') {
            Module.isMobile = true;
        }
    }
}

// Log browser info (safe in both main thread and workers - navigator is available in both)
console.log('Browser:', navigator.userAgent);
console.log('Platform:', navigator.platform);
console.log('Language:', navigator.language);
console.log('Cores:', navigator.hardwareConcurrency || 'unknown');

// Memory info if available (main thread only - performance.memory not available in workers)
if (isMainThread && performance && performance.memory) {
    console.log('Memory:', {
        used: (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
        total: (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
        limit: (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB'
    });
}

