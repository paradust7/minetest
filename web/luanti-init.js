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
            
            // Set environment variable
            if (module.ENV) {
                module.ENV.MINETEST_USER_PATH = userDataDir;
                console.log('preRun: Set MINETEST_USER_PATH to:', userDataDir);
            }
            
            // Create /userdata directory if it doesn't exist
            if (module.FS) {
                try {
                    if (!module.FS.analyzePath(userDataDir).exists) {
                        module.FS.mkdir(userDataDir);
                        console.log('preRun: Created', userDataDir);
                    }
                    
                    // IMPORTANT: Change working directory to /userdata
                    // With RUN_IN_PLACE=TRUE, Luanti uses cwd as the user data directory
                    module.FS.chdir(userDataDir);
                    console.log('preRun: Changed working directory to:', module.FS.cwd());
                } catch (e) {
                    console.error('preRun: Failed to setup userdata directory:', e);
                }
            }
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
                document.getElementById('controls-info').classList.remove('hidden');
            }
        }
    ],
    setStatus: function(text) {
        var loadingScreen = document.getElementById('loading-screen');
        var loadingStatus = document.getElementById('loading-status');
        var loadingProgressBar = document.getElementById('loading-progress-bar');
        var controlsInfo = document.getElementById('controls-info');
        
        if (!text) {
            console.log('***** HIDING LOADING SCREEN *****');
            loadingScreen.classList.add('hidden');
            controlsInfo.classList.remove('hidden');
            return;
        }
        console.log('Status:', text);
        loadingStatus.textContent = text;
        
        // Parse progress if available
        var m = text.match(/([^(]+)\((\d+(\.\d+)?)\/(\d+)\)/);
        if (m) {
            var current = parseInt(m[2]);
            var total = parseInt(m[4]);
            loadingProgressBar.style.width = (current / total * 100) + '%';
        } else {
            loadingProgressBar.style.width = '100%';
        }
        
        // Auto-hide after 10 seconds if stuck (emergency fallback)
        setTimeout(function() {
            if (!loadingScreen.classList.contains('hidden')) {
                console.warn('Loading screen still visible after 10s, force hiding...');
                loadingScreen.classList.add('hidden');
                controlsInfo.classList.remove('hidden');
            }
        }, 10000);
    },
    totalDependencies: 0,
    monitorRunDependencies: function(left) {
        this.totalDependencies = Math.max(this.totalDependencies, left);
        Module.setStatus(left ? 'Loading dependencies: ' + (this.totalDependencies - left) + '/' + this.totalDependencies : 'All downloads complete.');
    },
    onRuntimeInitialized: function() {
        console.log('***** RUNTIME INITIALIZED *****');
        console.log('Canvas element exists:', !!document.getElementById('canvas'));
        console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);
        console.log('Creating virtual filesystem directories...');
        
        // IMPORTANT: With MODULARIZE=1, FS is on 'this' (the Module instance)
        var FS = this.FS;
        
        // Create directories and symlinks needed by Luanti
        try {
            // DON'T change directory here - we already set it to /userdata in preRun!
            var userDataDir = '/userdata';
            
            // Create symlinks to preloaded read-only assets
            // With RUN_IN_PLACE, Luanti looks for assets relative to cwd (/userdata)
            // But our assets are preloaded at the root
            var symlinks = [
                { src: '/builtin', dst: userDataDir + '/builtin' },
                { src: '/fonts', dst: userDataDir + '/fonts' },
                { src: '/games', dst: userDataDir + '/games' },
                { src: '/textures', dst: userDataDir + '/textures' }
            ];
            
            symlinks.forEach(function(link) {
                try {
                    if (!FS.analyzePath(link.dst).exists) {
                        FS.symlink(link.src, link.dst);
                        console.log('Created symlink:', link.dst, '->', link.src);
                    }
                } catch (e) {
                    console.warn('Could not create symlink', link.dst, ':', e.message);
                }
            });
            
            // Create writable subdirectories
            // Note: /client needs to be a real directory, not a symlink, so we can write to it
            var dirsToCreate = [
                userDataDir + '/cache',           // Cache subdirectory
                userDataDir + '/worlds',          // Saved worlds
                userDataDir + '/client',          // Client-side data (writable)
                userDataDir + '/client/serverlist', // Server list cache
                userDataDir + '/mods'             // User mods
            ];
            
            dirsToCreate.forEach(function(dir) {
                try {
                    // Check parent exists first
                    var parts = dir.split('/').filter(Boolean);
                    var current = '/';
                    parts.forEach(function(part) {
                        current += (current === '/' ? '' : '/') + part;
                        if (!FS.analyzePath(current).exists) {
                            FS.mkdir(current);
                            console.log('Created directory:', current);
                        }
                    });
                } catch (e) {
                    console.warn('Could not create directory', dir, ':', e.message);
                }
            });
            
            // Now create symlinks inside /userdata/client to shaders (preloaded at /client/shaders)
            try {
                if (FS.analyzePath('/client/shaders').exists && !FS.analyzePath(userDataDir + '/client/shaders').exists) {
                    FS.symlink('/client/shaders', userDataDir + '/client/shaders');
                    console.log('Created symlink:', userDataDir + '/client/shaders', '-> /client/shaders');
                }
            } catch (e) {
                console.warn('Could not create client shaders symlink:', e.message);
            }
            
                console.log('Virtual filesystem setup complete');
                console.log('Current directory:', FS.cwd());
                console.log('Root contents:', FS.readdir('/'));
                
                // Debug font loading
                console.log('Checking fonts directory:');
                try {
                    var fontFiles = FS.readdir('/fonts');
                    console.log('  /fonts contains:', fontFiles.length, 'entries');
                    console.log('  Files:', fontFiles.filter(f => f !== '.' && f !== '..'));
                    var userdataFonts = FS.readdir('/userdata/fonts');
                    console.log('  /userdata/fonts contains:', userdataFonts.length, 'entries');
                } catch (e) {
                    console.error('  Font directory check failed:', e);
                }
            
            // Test write permission
            try {
                FS.writeFile('/test_write.txt', 'test');
                FS.unlink('/test_write.txt');
                console.log('Write permission: OK');
            } catch (e) {
                console.error('Write permission test FAILED:', e);
            }
        } catch (e) {
            console.error('Failed to set up filesystem:', e);
        }
        
        console.log('onRuntimeInitialized complete, about to call main()');
        Module.setStatus('Starting Luanti...');
        console.log('Returning from onRuntimeInitialized, main() starts now...');
        
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

