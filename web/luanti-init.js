// Luanti Web Initialization
// This file runs BEFORE luanti.js loads and sets up the environment

console.log('***** Luanti Web Init Script Loaded *****');
self._luantiDevicePixelRatio = window.devicePixelRatio || 1.0;
console.log('Captured devicePixelRatio:', self._luantiDevicePixelRatio);

// Global Module configuration for Emscripten
// This will be read by LuantiModule() when it loads
function createLuantiModuleConfiguration() {
    const preventKeyDefault = function(e) {
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
    };

    const Module = {
        // Preload everything but don't call main() until user clicks Run
        noInitialRun: true,
        // Store DPR in Module so it's available to worker threads
        devicePixelRatio: self._luantiDevicePixelRatio,
        canvas: (function() {
            const canvas = document.getElementById('canvas');
            canvas.addEventListener('webglcontextlost', function(e) {
                alert('WebGL context lost. Reload the page.');
                e.preventDefault();
            }, false);
            return canvas;
        })(),
        arguments: [],
        printErr: function(text) {
            console.error('stderr:', text);
        },
        print: function(text) {
            console.log('stdout:', text);
        },
        preRun: [
            function(mod) {
                console.log('***** MODULE PRERUN EXECUTING *****');
                
                // In preRun, we receive the module instance as a parameter
                const module = mod || this || Module;
                const userDataDir = '/userdata';
                
                // Set environment variable (safe to do in preRun)
                if (module.ENV) {
                    module.ENV.MINETEST_USER_PATH = userDataDir;
                    console.log('preRun: Set MINETEST_USER_PATH to:', userDataDir);
                }

                window.addEventListener('keydown', preventKeyDefault, true);
                window.addEventListener('keyup', preventKeyDefault, true);
                window.addEventListener('keypress', preventKeyDefault, true);

                document.addEventListener('paste', function(e) {
                    let text = '';
                    if (e.clipboardData && e.clipboardData.getData) {
                        text = e.clipboardData.getData('text/plain');
                    } else if (window.clipboardData && window.clipboardData.getData) {
                        text = window.clipboardData.getData('Text');
                    }
                    
                    if (text && text.length > 0) {
                        if (typeof Module !== 'undefined' && Module._SDL_SetClipboardText) {
                            const ptr = Module.stringToNewUTF8(text);
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
        postRun: [],
        totalDependencies: 0,
        monitorRunDependencies: function(left) {
            if (left >= this.totalDependencies) {
                this.totalDependencies = left;
            }
            else if (left > 0) {
                LuantiStateObject.setLoadingProgress(0.95 + (((this.totalDependencies - left) / this.totalDependencies) * 0.05));
            }
            else {
                LuantiStateObject.setLoadingProgress(1);
            }
        },
        setStatus: function(status) {
            const matches = /\((\d+)\/(\d+)\)/.exec(status);
            if (matches) {
                const total = parseInt(matches[2]);
                const loaded = parseInt(matches[1]);
                LuantiStateObject.setLoadingProgress((loaded / total) * 0.95);
            }
        },
        onRuntimeInitialized: function() {
            Module.printErr('***** RUNTIME INITIALIZED *****');
            console.error('***** RUNTIME INITIALIZED *****');
            
            Module.printErr('Canvas element exists: ' + !!document.getElementById('canvas'));
            Module.printErr('Creating virtual filesystem directories...');
            Module.printErr('this.FS available: ' + !!this.FS);
            Module.printErr('Module.FS available: ' + !!Module.FS);
            
            // IMPORTANT: With MODULARIZE=1, FS is on 'this' (the Module instance)
            const FS = this.FS || Module.FS;
            
            if (!FS) {
                Module.printErr('CRITICAL ERROR: FS object not available in onRuntimeInitialized!');
                alert('CRITICAL: Filesystem not available!');
                return;
            }
            
            Module.printErr('FS object acquired, proceeding with filesystem setup...');
            try {
                // IMPORTANT: Change working directory to /userdata
                // With RUN_IN_PLACE=TRUE, Luanti uses cwd as the user data directory
                const userDataDir = '/userdata';
                Module.printErr('Changing working directory to /userdata...');
                try {
                    FS.chdir(userDataDir);
                    Module.printErr('Changed working directory to: ' + FS.cwd());
                } catch (e) {
                    Module.printErr('CRITICAL ERROR: Failed to chdir to ' + userDataDir + ': ' + e);
                    alert('CRITICAL: Cannot change to /userdata directory!');
                    throw e;
                }
                
                Module.printErr('Preparing writable directories (will set permissions next)...');
                Module.printErr('Current directory: ' + FS.cwd());
                Module.printErr('Root contents: ' + JSON.stringify(FS.readdir('/')));
                
                Module.printErr('Setting permissions on writable directories...');
                const writableDirs = [
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
            
            // Signal that preloading is complete - show the Run button
            LuantiStateObject.setReady();
        },
        onAbort: function(what) {
            console.error('***** ABORT CALLED *****');
            console.error('Abort reason:', what);
            console.trace('Abort stack trace');
            LuantiStateObject.abortOccurred('ABORT: ' + (what || 'Unknown error'))
        }
    };

    // Catch all uncaught errors
    const errorHandler = function(e) {
        console.error('***** UNCAUGHT ERROR *****');
        console.error('Message:', e.message);
        console.error('Filename:', e.filename);
        console.error('Line:', e.lineno, 'Col:', e.colno);
        console.error('Error object:', e.error);
        LuantiStateObject.errorOccurred('UNCAUGHT ERROR: ' + e.message);
    };
    window.addEventListener('error', errorHandler);

    const unhandledRejectionHandler = function(e) {
        console.error('***** UNHANDLED PROMISE REJECTION *****');
        console.error('Reason:', e.reason);
        LuantiStateObject.errorOccurred('PROMISE REJECTED: ' + e.reason);
    };
    window.addEventListener('unhandledrejection', unhandledRejectionHandler);

    // Log that Module is configured
    console.log('***** MODULE CONFIGURED *****');
    console.log('Module.arguments:', Module.arguments);

    // Debounce to avoid rapid resizes
    let resizeScheduled = false;
    
    function resizeCanvasToContainer() {
        if (!Module || !Module.canvas) return;
        const canvas = Module.canvas;
        const container = document.getElementById('game-container') || canvas.parentElement || document.body;
        const displayWidth = Math.max(1, Math.floor(container.clientWidth));
        const displayHeight = Math.max(1, Math.floor(container.clientHeight));
        
        canvas.style.width = displayWidth + 'px';
        canvas.style.height = displayHeight + 'px';
        
        if (typeof window !== 'undefined') {
            const currentDPR = window.devicePixelRatio || 1.0;
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
        const container = document.getElementById('game-container') || (Module && Module.canvas ? Module.canvas.parentElement : null);
        if (container && typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(scheduleResize);
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

    // Luanti control object
    let __isReadyResolve = null;
    let __isReadyReject = null;
    const LuantiStateObject = {
        __ready: false,
        isReady: new Promise(function(resolve, reject) {
            __isReadyResolve = resolve;
            __isReadyReject = reject;
        }),
        isRunning: false,
        loadingProgress: 0,
        onProgressChangeListeners: new Set(),
        onAbortListeners: new Set(),

        run: function() {
            if (this.isRunning) {
                console.log('Luanti is already running');
                return;
            }
            if (!this.__ready) {
                console.log('Luanti not yet preloaded, please wait...');
                return;
            }
            this.isRunning = true;
            
            console.log('Starting Luanti main()...');
            // Call main() - this starts the actual game
            try {
                if (typeof Module.callMain === 'function') {
                    Module.callMain(Module.arguments);
                } else {
                    throw new Error('Neither callMain nor _main available - rebuild with callMain in EXPORTED_RUNTIME_METHODS');
                }
            } catch (err) {
                console.error('Failed to start Luanti:', err);
                this.isRunning = false;
            }
        },

        setReady: function() {
            console.log('Luanti is ready');
            this.__ready = true;
            __isReadyResolve(true);
        },

        setLoadingProgress: function(progress) {
            this.loadingProgress = progress;
            this.onProgressChangeListeners.forEach(listener => listener(this.loadingProgress));
        },

        errorOccurred: function(error) {
            console.error('Luanti error:', error);
        },

        abortOccurred: function(error) {
            console.error('Luanti abort:', error);
            this.onAbortListeners.forEach(listener => listener(error));
        },

        addAbortListener: function(listener) {
            this.onAbortListeners.add(listener);
        },

        removeAbortListener: function(listener) {
            this.onAbortListeners.delete(listener);
        },

        addProgressChangeListener: function(listener) {
            this.onProgressChangeListeners.add(listener);
        },

        removeProgressChangeListener: function(listener) {
            this.onProgressChangeListeners.delete(listener);
        },
    };

    const cleanUp = function() {
        window.removeEventListener('keydown', preventKeyDefault);
        window.removeEventListener('keyup', preventKeyDefault);
        window.removeEventListener('keypress', preventKeyDefault);
        window.removeEventListener('error', errorHandler);
        window.removeEventListener('unhandledrejection', unhandledRejectionHandler);
        window.removeEventListener('resize', scheduleResize);
        window.removeEventListener('orientationchange', scheduleResize);
    };

    return {
        Module,
        LuantiStateObject,
        cleanUp,
    };
}

// Preload Luanti after luanti.js loads (downloads WASM + assets, but doesn't run main())
window.createLuantiInstance = async () => {
    while (typeof window.LuantiModule === 'undefined') {
        console.log('Waiting for LuantiModule to load...');
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    try {
        const { Module, LuantiStateObject, cleanUp } = createLuantiModuleConfiguration();
        const instance = await LuantiModule(Module);
        console.log('LuantiModule preloaded successfully');
        return { instance, LuantiStateObject, cleanUp };
    } catch (err) {
        console.error('Failed to preload LuantiModule:', err);
        throw err;
    }
};
