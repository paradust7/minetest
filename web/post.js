// Post-initialization JavaScript for Luanti
// This runs after the main module has loaded

console.log('Luanti Web - Post-initialization');

// Expose some useful functions to the browser console
window.Luanti = {
    version: '5.14.0-web',
    
    // Take a screenshot (saves to browser downloads)
    screenshot: function() {
        if (Module && Module.canvas) {
            Module.canvas.toBlob(function(blob) {
                var url = URL.createObjectURL(blob);
                var link = document.createElement('a');
                link.download = 'luanti_screenshot_' + Date.now() + '.png';
                link.href = url;
                link.click();
                console.log('Screenshot saved');
            });
        }
    },
    
    // Toggle fullscreen
    toggleFullscreen: function() {
        if (!document.fullscreenElement) {
            Module.canvas.requestFullscreen().catch(function(err) {
                console.error('Fullscreen error:', err);
            });
        } else {
            document.exitFullscreen();
        }
    },
    
    // Get performance info
    getStats: function() {
        return {
            uptime: ((Date.now() - perfStats.startTime) / 1000 / 60).toFixed(1) + ' minutes',
            memory: performance.memory ? {
                used: (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
                total: (performance.memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB'
            } : 'Not available'
        };
    },
    
    // Restart the game
    restart: function() {
        location.reload();
    }
};

console.log('Luanti API available at window.Luanti');
console.log('Try: Luanti.screenshot(), Luanti.toggleFullscreen(), Luanti.getStats()');

