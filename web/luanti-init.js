// Luanti Web Initialization
// This file runs BEFORE luanti.js loads and sets up the environment

console.log('***** Luanti Web Init Script Loaded *****');

// Global Module configuration for Emscripten
// This will be read by LuantiModule() when it loads
var Module = {
    canvas: (function() {
        var canvas = document.getElementById('canvas');
        canvas.addEventListener('webglcontextlost', function(e) {
            alert('WebGL context lost. Reload the page.');
            e.preventDefault();
        }, false);
        return canvas;
    })(),
    arguments: ["--info"],
    printErr: function(text) {
        console.error('stderr:', text);
        var errorText = document.getElementById('error-text');
        if (errorText) {
            errorText.textContent += text + '\n';
        }
    },
    print: function(text) {
        console.log('stdout:', text);
    },
    preRun: [
        function(mod) {
            console.log('***** MODULE PRERUN EXECUTING *****');
            
            // In preRun, we receive the module instance as a parameter
            var module = mod || this || Module;
            var userDataDir = '/userdata';
            
            // Set environment variable (safe to do in preRun)
            if (module.ENV) {
                module.ENV.MINETEST_USER_PATH = userDataDir;
                console.log('preRun: Set MINETEST_USER_PATH to:', userDataDir);
            }
            
            // NOTE: With WASMFS, we CANNOT use FS operations here in preRun!
            // WASMFS native functions are not initialized until onRuntimeInitialized
            // All FS operations moved to onRuntimeInitialized instead
            console.log('preRun: Filesystem operations deferred to onRuntimeInitialized (WASMFS requirement)');
        }
    ],
    postRun: [
        function() {
            console.log('***** MODULE POSTRUN EXECUTING *****');
            console.log('main() has completed!');
            
            // Force hide loading screen if postRun executes
            var loadingScreen = document.getElementById('loading-screen');
            if (loadingScreen && !loadingScreen.classList.contains('hidden')) {
                console.log('Hiding loading screen from postRun');
                loadingScreen.classList.add('hidden');
                var controlsInfoEl = document.getElementById('controls-info');
                if (controlsInfoEl) {
                    controlsInfoEl.classList.remove('hidden');
                }
            }
        }
    ],
    setStatus: function(text) {
        var loadingScreen = document.getElementById('loading-screen');
        var loadingStatus = document.getElementById('loading-status');
        var loadingProgressBar = document.getElementById('loading-progress-bar');
        var controlsInfo = document.getElementById('controls-info');
        
        // If required UI elements are not present (clean shell), just log and return
        if (!loadingScreen || !loadingStatus || !loadingProgressBar) {
            if (typeof text !== 'undefined') {
                console.log('Status:', text);
            }
            return;
        }
        
        if (!text) {
            console.log('***** HIDING LOADING SCREEN *****');
            loadingScreen.classList.add('hidden');
            if (controlsInfo) {
                controlsInfo.classList.remove('hidden');
            }
            return;
        }
        if (typeof text !== 'string' || (
            !text.startsWith('Loading dependencies:') && !text.startsWith('Downloading data...'))) {
            console.log('Status:', text);
        }
        loadingStatus.textContent = text;
        
        // Parse progress if available
        var m = text.match(/([^(]+)\((\d+(\.\d+)?)\/(\d+)\)/);
        if (m) {
            var current = parseFloat(m[2]);
            var total = parseFloat(m[4]);
            if (total > 0) {
                loadingProgressBar.style.width = (current / total * 100) + '%';
            }
        }
        // Don't change progress bar if there's no progress info - let it stay at current value
    },
    totalDependencies: 0,
    monitorRunDependencies: function(left) {
        this.totalDependencies = Math.max(this.totalDependencies, left);
        Module.setStatus(left ? 'Loading dependencies: ' + (this.totalDependencies - left) + '/' + this.totalDependencies : 'All downloads complete.');
    },
    onRuntimeInitialized: function() {
        Module.printErr('***** RUNTIME INITIALIZED *****');
        console.error('***** RUNTIME INITIALIZED *****');
        
        // Trigger canvas resize now that GL context is ready
        if (typeof window.scheduleResize === 'function') {
            try { window.scheduleResize(); } catch (e) { console.warn('Resize failed:', e); }
        }
        
        Module.printErr('Canvas element exists: ' + !!document.getElementById('canvas'));
        Module.printErr('Creating virtual filesystem directories...');
        Module.printErr('this.FS available: ' + !!this.FS);
        Module.printErr('Module.FS available: ' + !!Module.FS);
        
        // IMPORTANT: With MODULARIZE=1, FS is on 'this' (the Module instance)
        var FS = this.FS || Module.FS;
        
        if (!FS) {
            Module.printErr('CRITICAL ERROR: FS object not available in onRuntimeInitialized!');
            alert('CRITICAL: Filesystem not available!');
            return;
        }
        
        Module.printErr('FS object acquired, proceeding with filesystem setup...');
        
        // Create writable directories for Luanti
        // With WASMFS=1, files are preloaded directly to /userdata, so no symlinks needed
        try {
            var userDataDir = '/userdata';
            
            // CRITICAL: Create /userdata and set it as working directory
            // This must happen FIRST, before any other FS operations
            // With WASMFS, we can only do this after runtime initialization
            // Note: Preloading to /userdata/* might have already created /userdata
            Module.printErr('Step 1: Creating /userdata directory...');
            try {
                FS.mkdir(userDataDir);
                Module.printErr('Created ' + userDataDir);
            } catch (e) {
                // Directory might already exist (created by preload), that's OK
                Module.printErr(userDataDir + ' already exists (expected with preload)');
            }
            
            // IMPORTANT: Change working directory to /userdata
            // With RUN_IN_PLACE=TRUE, Luanti uses cwd as the user data directory
            Module.printErr('Step 2: Changing working directory to /userdata...');
            try {
                FS.chdir(userDataDir);
                Module.printErr('Changed working directory to: ' + FS.cwd());
            } catch (e) {
                Module.printErr('CRITICAL ERROR: Failed to chdir to ' + userDataDir + ': ' + e);
                alert('CRITICAL: Cannot change to /userdata directory!');
                throw e;
            }
            
            // Verify preloaded directories exist
            // Note: With WASMFS, FS.analyzePath() seems problematic, so we use readdir instead
            Module.printErr('Step 3: Verifying preloaded assets...');
            try {
                var entries = FS.readdir(userDataDir);
                Module.printErr('Contents of ' + userDataDir + ': ' + JSON.stringify(entries));
                
                var preloadedDirs = ['builtin', 'fonts', 'games', 'textures', 'client'];
                var missingDirs = [];
                preloadedDirs.forEach(function(dir) {
                    if (entries.indexOf(dir) !== -1) {
                        Module.printErr('  ✓ ' + dir + ' exists');
                    } else {
                        Module.printErr('  ✗ ' + dir + ' NOT FOUND - preload may have failed');
                        missingDirs.push(dir);
                    }
                });
                
                if (missingDirs.length > 0) {
                    Module.printErr('CRITICAL ERROR: Missing required directories: ' + missingDirs.join(', '));
                    alert('CRITICAL: Missing game files!\nMissing: ' + missingDirs.join(', ') + '\n\nFiles were not preloaded correctly.');
                }
            } catch (e) {
                Module.printErr('CRITICAL ERROR: Could not verify preloaded assets: ' + e.message);
                alert('CRITICAL: Cannot read /userdata directory!');
            }
            
            Module.printErr('Step 4: Preparing writable directories (will set permissions next)...');
            Module.printErr('Current directory: ' + FS.cwd());
            Module.printErr('Root contents: ' + JSON.stringify(FS.readdir('/')));
            
            // CRITICAL FIX FOR WASMFS: Set permissions on writable directories
            // WASMFS creates directories with r-x permissions, but we need rwx for writing
            Module.printErr('Setting permissions on writable directories...');
            var writableDirs = [
                '/userdata',
                '/userdata/cache',
                '/userdata/cache/cdb',
                '/userdata/worlds',
                '/userdata/mods',
                '/userdata/client',
                '/userdata/client/serverlist'
            ];
            
            writableDirs.forEach(function(dir) {
                try {
                    // First create if doesn't exist
                    try {
                        FS.mkdir(dir);
                        Module.printErr('  Created: ' + dir);
                    } catch (mkdirErr) {
                        // Already exists, that's OK
                    }
                    
                    // Now set permissions to rwx (0o777)
                    FS.chmod(dir, 0o777);
                    Module.printErr('  chmod 0o777: ' + dir);
                } catch (e) {
                    Module.printErr('  ERROR setting permissions on ' + dir + ': ' + e);
                }
            });

            // Recursively add write permissions to all files and subdirectories in /userdata/worlds
            Module.printErr('Step 7: Recursively adding write permissions to /userdata/worlds...');
            try {
                FS.chmod('/userdata/worlds', 0o777);
                Module.printErr('  chmod 0o777: /userdata/worlds');
                const subdirs = FS.readdir('/userdata/worlds');
                subdirs.forEach(function(subdir) {
                    if (subdir === '.' || subdir === '..') return;
                    FS.chmod('/userdata/worlds/' + subdir, 0o777);
                    Module.printErr('  chmod 0o777: /userdata/worlds/' + subdir);
                    const items = FS.readdir('/userdata/worlds/' + subdir);
                    items.forEach(function(item) {
                        if (item === '.' || item === '..') return;
                        FS.chmod('/userdata/worlds/' + subdir + '/' + item, 0o777);
                        Module.printErr('  chmod 0o777: /userdata/worlds/' + subdir + '/' + item);
                    });
                });
            } catch (e) {
                Module.printErr('  ERROR setting permissions on /userdata/worlds: ' + e.message);
            }
            
            // Debug font loading
            Module.printErr('Step 5: Verifying fonts...');
            try {
                var userdataFonts = FS.readdir('/userdata/fonts');
                Module.printErr('  /userdata/fonts contains: ' + userdataFonts.length + ' entries');
                Module.printErr('  Files: ' + JSON.stringify(userdataFonts.filter(f => f !== '.' && f !== '..')));
            } catch (e) {
                Module.printErr('  Font directory check failed: ' + e);
            }
            
            // Test write permission
            Module.printErr('Step 6: Testing write permission...');
            try {
                FS.writeFile('/test_write.txt', 'test');
                FS.unlink('/test_write.txt');
                Module.printErr('Write permission: OK');
            } catch (e) {
                Module.printErr('Write permission test FAILED: ' + e);
            }
        } catch (e) {
            Module.printErr('CRITICAL ERROR: Failed to set up filesystem: ' + e);
            alert('CRITICAL: Filesystem setup failed!\n\n' + e);
            throw e;
        }
        
        Module.printErr('===== onRuntimeInitialized complete! =====');
        Module.printErr('About to call main()...');
        Module.setStatus('Starting Luanti...');
        
        // Monitor runtime after main() completes (minimal logging)
        Module.postRun.push(function() {
            console.log('✅ main() completed, SDL event loop is now active');
            console.log('Main menu should be interactive. Check CPU usage - should be 10-20%!');
        });
    },
    onAbort: function(what) {
        console.error('***** ABORT CALLED *****');
        console.error('Abort reason:', what);
        console.trace('Abort stack trace');
        var errorMessage = document.getElementById('error-message');
        var errorText = document.getElementById('error-text');
        if (errorText && errorMessage) {
            errorText.textContent = 'ABORT: ' + (what || 'Unknown error');
            errorMessage.classList.add('show');
        }
        var loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.classList.add('hidden');
        }
    }
};

// Catch all uncaught errors
window.addEventListener('error', function(e) {
    console.error('***** UNCAUGHT ERROR *****');
    console.error('Message:', e.message);
    console.error('Filename:', e.filename);
    console.error('Line:', e.lineno, 'Col:', e.colno);
    console.error('Error object:', e.error);
    var errorMessage = document.getElementById('error-message');
    var errorText = document.getElementById('error-text');
    if (errorText && errorMessage) {
        errorText.textContent = 'ERROR: ' + e.message;
        errorMessage.classList.add('show');
    }
});

window.addEventListener('unhandledrejection', function(e) {
    console.error('***** UNHANDLED PROMISE REJECTION *****');
    console.error('Reason:', e.reason);
    var errorMessage = document.getElementById('error-message');
    var errorText = document.getElementById('error-text');
    if (errorText && errorMessage) {
        errorText.textContent = 'PROMISE REJECTED: ' + e.reason;
        errorMessage.classList.add('show');
    }
});

// Log that Module is configured
console.log('***** MODULE CONFIGURED *****');
console.log('Module.arguments:', Module.arguments);

// Initial status
Module.setStatus('Downloading Luanti...');

// Resize handling: keep canvas CSS size in sync with its container
// 
// IMPORTANT: With OFFSCREENCANVAS_SUPPORT + OFFSCREENCANVASES_TO_PTHREAD:
// - The HTMLCanvasElement becomes a "placeholder" after being transferred to OffscreenCanvas
// - The OffscreenCanvas lives in the worker thread and can ONLY be resized from that thread
// - From JavaScript (main thread), we can ONLY set the CSS size (display size)
// - The C/C++ code (running in the worker) detects CSS size changes and resizes the backing store
// 
// This is the correct architecture:
//   Main Thread (JS):   Sets canvas.style.width/height → Controls display size
//   Worker Thread (C++): Reads CSS size, resizes OffscreenCanvas → Controls render resolution
(function() {
	// Debounce to avoid rapid resizes
	var resizeScheduled = false;
	
	function resizeCanvasToContainer() {
		if (!Module || !Module.canvas) return;
		var canvas = Module.canvas;
		var container = document.getElementById('game-container') || canvas.parentElement || document.body;
		var displayWidth = Math.max(1, Math.floor(container.clientWidth));
		var displayHeight = Math.max(1, Math.floor(container.clientHeight));
		
		// Set CSS size to match container - this controls the display size in the browser
		// This works for both regular canvas AND placeholder canvas after OffscreenCanvas transfer
		canvas.style.width = displayWidth + 'px';
		canvas.style.height = displayHeight + 'px';
		
		// NOTE: We do NOT set canvas.width/height or call any resize APIs here!
		// With OffscreenCanvas, the backing store size MUST be set from the worker thread.
		// The game's render loop (running in the worker) will detect the CSS size change
		// and update the OffscreenCanvas dimensions accordingly using emscripten_set_canvas_element_size()
		// or via SDL/Irrlicht's automatic canvas size handling.
	}
	
	function scheduleResize() {
		if (resizeScheduled) return;
		resizeScheduled = true;
		requestAnimationFrame(function() {
			resizeScheduled = false;
			try { resizeCanvasToContainer(); } catch (e) { console.warn('resizeCanvasToContainer failed:', e); }
		});
	}
	
	// Make scheduleResize globally accessible for onRuntimeInitialized
	window.scheduleResize = scheduleResize;
	
	// Observe container size changes
	try {
		var container = document.getElementById('game-container') || (Module && Module.canvas ? Module.canvas.parentElement : null);
		if (container && typeof ResizeObserver !== 'undefined') {
			var ro = new ResizeObserver(scheduleResize);
			ro.observe(container);
		}
	} catch (e) {
		console.warn('ResizeObserver unavailable:', e);
	}
	
	// Window and fullscreen events
	window.addEventListener('resize', scheduleResize);
	window.addEventListener('orientationchange', scheduleResize);
	document.addEventListener('fullscreenchange', scheduleResize);
	
	// Initial sizing on load
	scheduleResize();
	
	// Note: Don't wrap Module.onRuntimeInitialized here - it breaks MODULARIZE=1
	// Instead, we call scheduleResize() inside onRuntimeInitialized directly
})();

// Initialize Luanti after luanti.js loads
window.initializeLuanti = function() {
    if (typeof LuantiModule === 'undefined') {
        // Script not loaded yet, wait a bit
        console.log('Waiting for LuantiModule to load...');
        setTimeout(window.initializeLuanti, 50);
        return;
    }
    
    console.log('Initializing LuantiModule factory...');
    LuantiModule(Module).then(function(instance) {
        console.log('LuantiModule initialized successfully');
        // The instance is the final Module object with all Emscripten features
        window.Module = instance; // Make it globally available for debugging
    }).catch(function(err) {
        console.error('Failed to initialize LuantiModule:', err);
        var errorMessage = document.getElementById('error-message');
        var errorText = document.getElementById('error-text');
        if (errorText && errorMessage) {
            errorText.textContent = 'Failed to initialize: ' + err;
            errorMessage.classList.add('show');
        }
    });
};

// Start the initialization process
// This will poll until luanti.js loads and LuantiModule is available
console.log('Starting Luanti initialization...');
window.initializeLuanti();

