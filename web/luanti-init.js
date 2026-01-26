// Luanti Web Initialization
// This file runs BEFORE luanti.js loads and sets up the environment

console.log('***** Luanti Web Init Script Loaded *****');
self._luantiDevicePixelRatio = window.devicePixelRatio || 1.0;
console.log('Captured devicePixelRatio:', self._luantiDevicePixelRatio);

// Global Module configuration for Emscripten
// This will be read by LuantiModule() when it loads
var Module = {
	// Store DPR in Module so it's available to worker threads
	devicePixelRatio: self._luantiDevicePixelRatio,
    canvas: (function() {
        var canvas = document.getElementById('canvas');
        canvas.addEventListener('webglcontextlost', function(e) {
            alert('WebGL context lost. Reload the page.');
            e.preventDefault();
        }, false);
        return canvas;
    })(),
    arguments: [],
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

            // Prevent default key behavior
            function preventKeyDefault(e) {
                // Only prevent defaults for keys that cause unwanted browser actions
                // Allow normal typing keys to work in text fields
                
                // Special handling for F11: Let browser handle fullscreen, but block game from seeing it
                if (e.key === 'F11') {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    // Do NOT call preventDefault() - let browser toggle fullscreen
                    return;
                }
                
                // Prevent Tab from moving focus outside the canvas
                // Luanti handles Tab internally for navigating between GUI elements
                if (e.key === 'Tab') {
                    e.preventDefault();
                    return;
                }
                
                // Prevent other function keys (F1-F12)
                if (e.key && e.key.startsWith('F') && e.key.length > 1 && e.key.length <= 3) {
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

            window.addEventListener('keydown', preventKeyDefault, true);
            window.addEventListener('keyup', preventKeyDefault, true);
            window.addEventListener('keypress', preventKeyDefault, true);

            document.addEventListener('paste', function(e) {
                var text = '';
                if (e.clipboardData && e.clipboardData.getData) {
                    text = e.clipboardData.getData('text/plain');
                } else if (window.clipboardData && window.clipboardData.getData) {
                    text = window.clipboardData.getData('Text');
                }
                
                if (text && text.length > 0) {
                    if (typeof Module !== 'undefined' && Module._SDL_SetClipboardText) {
                        var ptr = Module.stringToNewUTF8(text);
                        Module._SDL_SetClipboardText(ptr);
                        Module._free(ptr);
                        console.log('[clipboard] Stored paste text via SDL_SetClipboardText:', text.substring(0, 30) + (text.length > 30 ? '...' : ''));
                    } else if (typeof Module !== 'undefined' && Module.ccall) {
                        try {
                            Module.ccall('SDL_SetClipboardText', 'number', ['string'], [text]);
                            console.log('[clipboard] Stored paste text via ccall:', text.substring(0, 30) + (text.length > 30 ? '...' : ''));
                        } catch (err) {
                            console.warn('[clipboard] Failed to store paste text:', err);
                        }
                    }
                }
            });
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
            
            // Trigger another resize to ensure DPR is applied after main() starts
            if (typeof window.scheduleResize === 'function') {
                console.log('Triggering post-main resize for DPR');
                setTimeout(function() {
                    window.scheduleResize();
                }, 50);
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
        
        if (typeof window.scheduleResize === 'function') {
            try { 
                window.scheduleResize(); 
                setTimeout(function() {
                    window.scheduleResize();
                }, 100);
            } catch (e) { 
                console.warn('Resize failed:', e); 
            }
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
        try {
            var userDataDir = '/userdata';
            
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
            
            Module.printErr('Setting permissions on writable directories...');
            var writableDirs = [
                '/userdata',
                '/userdata/cache',
                '/userdata/cache/cdb',
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

(function() {
	// Debounce to avoid rapid resizes
	var resizeScheduled = false;
	
	function resizeCanvasToContainer() {
		if (!Module || !Module.canvas) return;
		var canvas = Module.canvas;
		var container = document.getElementById('game-container') || canvas.parentElement || document.body;
		var displayWidth = Math.max(1, Math.floor(container.clientWidth));
		var displayHeight = Math.max(1, Math.floor(container.clientHeight));
		
		canvas.style.width = displayWidth + 'px';
		canvas.style.height = displayHeight + 'px';
		
		if (typeof window !== 'undefined') {
			var currentDPR = window.devicePixelRatio || 1.0;
			if (self._luantiDevicePixelRatio !== currentDPR) {
				self._luantiDevicePixelRatio = currentDPR;
				if (Module) {
					Module.devicePixelRatio = currentDPR;
				}
				console.log('Updated devicePixelRatio:', currentDPR);
			}
		}
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
	
	try {
		resizeCanvasToContainer();
		console.log('Initial canvas resize complete');
	} catch (e) {
		console.warn('Initial resizeCanvasToContainer failed:', e);
	}
	scheduleResize();
})();

// Initialize Luanti after luanti.js loads
window.initializeLuanti = function() {
    if (typeof LuantiModule === 'undefined') {
        console.log('Waiting for LuantiModule to load...');
        setTimeout(window.initializeLuanti, 50);
        return;
    }
    
    console.log('Initializing LuantiModule factory...');
    LuantiModule(Module).then(function(instance) {
        console.log('LuantiModule initialized successfully');
        window.Module = instance;
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

console.log('Starting Luanti initialization...');
window.initializeLuanti();

