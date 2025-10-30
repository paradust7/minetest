// Pre-initialization JavaScript for Luanti
// This runs before the main Emscripten module loads

console.log('Luanti Web - Pre-initialization');

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
    var gl = canvas.getContext('webgl2');
    if (!gl) {
        errors.push('WebGL 2.0 is not supported');
    }
    
    if (errors.length > 0) {
        console.error('Browser compatibility errors:', errors);
        alert('Your browser does not support the required features to run Luanti:\n\n' + errors.join('\n') + '\n\nPlease use a modern browser like Chrome, Firefox, or Edge.');
    }
})();

// Setup virtual filesystem structure
Module.preRun = Module.preRun || [];
Module.preRun.push(function() {
    console.log('Setting up virtual filesystem...');
    
    // Create necessary directories
    try {
        FS.mkdir('/worlds');
        FS.mkdir('/mods');
        FS.mkdir('/clientmods');
        console.log('Virtual filesystem ready');
    } catch (e) {
        console.warn('Error creating directories (may already exist):', e);
    }
    
    // Setup default configuration if needed
    try {
        // Create a minimal default config
        var defaultConfig = [
            '# Luanti Web Configuration',
            '# Auto-generated on first run',
            '',
            '# Graphics',
            'screenW = 1024',
            'screenH = 768',
            'fullscreen = false',
            '',
            '# Performance',
            'fps_max = 60',
            'viewing_range = 100',
            '',
            '# Controls',
            'enable_mouse_look = true',
            'enable_touch = false',
            ''
        ].join('\n');
        
        FS.writeFile('/minetest.conf', defaultConfig);
        console.log('Created default configuration');
    } catch (e) {
        console.warn('Error creating default config:', e);
    }
});

// Setup post-run hooks
Module.postRun = Module.postRun || [];
Module.postRun.push(function() {
    console.log('Luanti initialization complete');
});

// Performance monitoring
var perfStats = {
    startTime: Date.now(),
    frameCount: 0,
    lastFpsUpdate: Date.now()
};

// Log performance stats periodically (optional, can be disabled)
if (typeof Module.enablePerfStats !== 'undefined' && Module.enablePerfStats) {
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
document.addEventListener('DOMContentLoaded', function() {
    var canvas = document.getElementById('canvas');
    if (canvas) {
        canvas.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            return false;
        });
    }
});

// Mobile/touch detection
var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
if (isMobile) {
    console.log('Mobile device detected');
    Module.isMobile = true;
}

// Log browser info
console.log('Browser:', navigator.userAgent);
console.log('Platform:', navigator.platform);
console.log('Language:', navigator.language);
console.log('Cores:', navigator.hardwareConcurrency || 'unknown');

// Memory info if available
if (performance && performance.memory) {
    console.log('Memory:', {
        used: (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
        total: (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
        limit: (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB'
    });
}

