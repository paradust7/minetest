// Pre-initialization JavaScript for Luanti
// This runs before the main Emscripten module loads

console.log('Luanti Web - Pre-initialization');

// Detect if we're in a worker thread (PROXY_TO_PTHREAD runs main() in worker)
var isMainThread = typeof window !== 'undefined';
var isWorker = typeof importScripts === 'function';

// Shared memory layout
var SHARED_MEMORY_SIZE = 2 * 1024 * 1024; // 2MB
var FD_IDX = 0; // Index of the file descriptor counter

// Capture device pixel ratio early on main thread (before any workers are created)
// Workers don't have access to window, so we must capture this value here
if (isMainThread) {
	self._luantiDevicePixelRatio = window.devicePixelRatio || 1.0;
	console.log('[pre.js] Captured devicePixelRatio on main thread:', self._luantiDevicePixelRatio);
}

// Initialize SharedArrayBuffer for socket proxy on MAIN THREAD ONLY
// Workers will receive the buffer via postMessage when they are created
if (isMainThread && typeof SharedArrayBuffer !== 'undefined') {
    console.log('[pre.js] Creating shared socket buffer on main thread');
    var _luantiSocketSharedBuffer = new SharedArrayBuffer(SHARED_MEMORY_SIZE);
    var _luantiSocketSharedInt32 = new Int32Array(_luantiSocketSharedBuffer);
    
    // Initialize control variables
    _luantiSocketSharedInt32.set(new Int32Array(100).fill(0)); // Set up to 100 Int32s to 0 for control variables - more than enough for now
    _luantiSocketSharedInt32[FD_IDX] = 100; // Set the initial file descriptor counter to 100
    self._luantiSocketSharedBuffer = _luantiSocketSharedBuffer;
    self._luantiSocketSharedInt32 = _luantiSocketSharedInt32;
    
    console.log('[pre.js] Shared socket buffer initialized and stored in self');
    
	var OriginalWorker = self.Worker;
	self.Worker = function(scriptURL, options) {
		console.log('[pre.js] Creating worker, will inject SharedArrayBuffer and devicePixelRatio');
		var worker = new OriginalWorker(scriptURL, options);
		
		worker.postMessage({
			customCmd: '_luantiSocketInit',  // Use underscore prefix to avoid conflicts
			sharedBuffer: self._luantiSocketSharedBuffer,
			devicePixelRatio: self._luantiDevicePixelRatio || 1.0,
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

// Worker thread: Receive the SharedArrayBuffer and devicePixelRatio from main thread
if (isWorker) {
	console.log('[pre.js] Worker thread setting up SharedArrayBuffer and DPR listener');
	
	// Listen for our custom initialization message
	// This will arrive before Emscripten's pthread initialization
	self.addEventListener('message', function(e) {
		if (e.data && e.data.customCmd === '_luantiSocketInit') {
			if (e.data.sharedBuffer) {
				console.log('[pre.js] Worker received SharedArrayBuffer via postMessage');
				self._luantiSocketSharedBuffer = e.data.sharedBuffer;
				console.log('[pre.js] SharedArrayBuffer initialized in worker');
			}
			if (e.data.devicePixelRatio) {
				console.log('[pre.js] Worker received devicePixelRatio:', e.data.devicePixelRatio);
				self._luantiDevicePixelRatio = e.data.devicePixelRatio;
			}
		}
	});
}

// Only run browser checks on main thread
if (isMainThread) {
    // Patch querySelector to handle Emscripten's numeric target specifiers
    // When PROXY_TO_PTHREAD is used, Emscripten's findEventTarget function may receive
    // numeric targets (0=canvas, 1=window, 2=document) that get incorrectly passed
    // to querySelector as strings. This patch intercepts those invalid selectors.
    (function patchQuerySelector() {
        var originalQuerySelector = document.querySelector.bind(document);
        document.querySelector = function(selector) {
            // Handle numeric string selectors that Emscripten might pass
            if (selector === '0' || selector === 0) {
                // 0 means "the default canvas element"
                return document.getElementById('canvas');
            }
            if (selector === '1' || selector === 1) {
                // 1 means window - return null, let caller handle it
                console.warn('[pre.js] querySelector called with "1" (window) - returning null');
                return null;
            }
            if (selector === '2' || selector === 2) {
                // 2 means document - return documentElement as closest match
                console.warn('[pre.js] querySelector called with "2" (document) - returning documentElement');
                return document.documentElement;
            }
            return originalQuerySelector(selector);
        };
        console.log('[pre.js] Patched document.querySelector to handle Emscripten numeric targets');
    })();
    
    // Check for required browser features
    (function checkBrowserSupport() {
        var errors = [];
        
        if (!window.WebAssembly) {
            errors.push('WebAssembly is not supported');
        } else {
            // Check for JSPI support (required by ASYNCIFY=2)
            if (typeof WebAssembly.promising !== 'function') {
                console.warn('[pre.js] WebAssembly.promising is NOT available. JSPI (ASYNCIFY=2) will fail!');
                // We don't push to errors yet, just warn, but it's likely the cause
            } else {
                console.log('[pre.js] WebAssembly.promising is available (JSPI supported)');
            }
        }
        
        if (!window.WebGLRenderingContext) {
            errors.push('WebGL is not supported');
        }
        
        // Check for WebGL 2.0
        var canvas = document.createElement('canvas');
        
        if (errors.length > 0) {
            console.error('Browser compatibility errors:', errors);
            alert('Your browser does not support the required features to run Luanti:\n\n' + errors.join('\n') + '\n\nPlease use a modern browser like Chrome, Firefox, or Edge.');
        }
    })();
}

(function applyEGLProxyWorkaround() {
    console.log('[pre.js] Preparing EGL proxy workaround for OffscreenCanvas support');

    if (typeof self !== 'undefined') {
        self._luanti_skipEGLProxy = true;
        console.log('[pre.js] EGL proxy skip flag set');
    }
})();

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

    // Disable right-click context menu globally for game area
    // This needs to work in both locked and unlocked pointer modes
    function preventContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();
        return false;
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
            
            // Prevent page scrolling when using scroll wheel over the canvas
            // Using window-level capture to catch events in all pointer lock states:
            // - When pointer is locked: events go to window, not canvas
            // - When not locked: events go to canvas (e.target === canvas)
            // IMPORTANT: { passive: false } is required to allow preventDefault()
            window.addEventListener('wheel', function(e) {
                if (document.pointerLockElement === canvas || e.target === canvas) {
                    e.preventDefault();
                }
            }, { passive: false, capture: true });
            
            // Monitor pointer lock changes to ensure context menu stays disabled
            document.addEventListener('pointerlockchange', function() {
                console.log('Pointer lock changed. Locked:', !!document.pointerLockElement);
            });

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
                if (attachContextMenuPrevention() || attempts > 100) {
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

