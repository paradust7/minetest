/**
 * Thread-Safe Socket Proxy using SharedArrayBuffer
 * 
 * This implementation uses SharedArrayBuffer and Atomics to provide
 * a socket proxy that works correctly across all pthread workers.
 * 
 * Architecture:
 * - Socket metadata stored in SharedArrayBuffer
 * - Packet queues stored in a shared structure
 * - Atomic operations for thread-safe access
 */

// Check if SharedArrayBuffer is available
if (typeof SharedArrayBuffer === 'undefined') {
    console.error('[SocketProxyShared] SharedArrayBuffer not available! Pthreads require Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers.');
    throw new Error('SharedArrayBuffer not available');
}

// Shared memory layout:
// [0-3]: Next FD counter (Int32)
// [4-7]: Lock for socket registry (Int32, 0=unlocked, 1=locked)
// [8+]: Socket registry data

var SHARED_MEMORY_SIZE = 1024 * 1024; // 1MB should be plenty
var OFFSET_NEXT_FD = 0;
var OFFSET_LOCK = 1;
var OFFSET_SOCKET_DATA = 2;

// Maximum number of sockets
var MAX_SOCKETS = 256;
var SOCKET_ENTRY_SIZE = 16; // Int32s per socket entry

// Socket entry layout (in Int32 units):
// [0]: fd (-1 = unused)
// [1]: domain
// [2]: type  
// [3]: protocol
// [4]: bound (0/1)
// [5]: localPort
// [6-9]: localAddress (4 bytes for IPv4)
// [10-15]: reserved

// Use the shared buffer created in pre.js (on main thread before workers started)
// This is the ONLY way to share memory between main thread and workers
// Note: We access this lazily because workers may load this file before the buffer is visible
var _socketProxySharedInt32 = null;

// Helper: Get shared buffer (lazy initialization with retry)
function getSharedInt32() {
    if (_socketProxySharedInt32 === null) {
        if (typeof self._luantiSocketSharedInt32 === 'undefined') {
            // In worker threads, the buffer is sent via postMessage immediately on worker creation
            // If it's not here yet, wait a short time (should arrive within milliseconds)
            var isWorker = typeof importScripts === 'function';
            if (isWorker) {
                console.warn('[SocketProxyShared] Shared buffer not ready yet in worker, waiting...');
                var startTime = Date.now();
                var maxWaitMs = 2000; // Wait up to 2 seconds
                
                while (typeof self._luantiSocketSharedInt32 === 'undefined') {
                    if (Date.now() - startTime > maxWaitMs) {
                        console.error('[SocketProxyShared] ERROR: Shared buffer not found after ' + maxWaitMs + 'ms wait!');
                        console.error('[SocketProxyShared] postMessage may not have arrived from main thread');
                        throw new Error('Shared socket buffer not initialized');
                    }
                    // Busy wait (not ideal but necessary for synchronous API)
                    // The buffer should arrive within a few milliseconds in practice
                }
                console.log('[SocketProxyShared] Shared buffer arrived after ' + (Date.now() - startTime) + 'ms');
            } else {
                console.error('[SocketProxyShared] ERROR: Shared buffer not found on main thread!');
                throw new Error('Shared socket buffer not initialized');
            }
        }
        console.log('[SocketProxyShared] Using shared buffer from self');
        _socketProxySharedInt32 = self._luantiSocketSharedInt32;
        
        // Also ensure packet queues exist
        if (typeof self._luantiSocketPacketQueues === 'undefined') {
            console.warn('[SocketProxyShared] Packet queues not found in self, creating local copy');
            self._luantiSocketPacketQueues = {};
        }
    }
    return _socketProxySharedInt32;
}

// Helper: Acquire lock with timeout
function acquireLock(timeoutMs) {
    var sharedInt32 = getSharedInt32();
    var start = Date.now();
    while (true) {
        var oldValue = Atomics.compareExchange(
            sharedInt32,
            OFFSET_LOCK,
            0, // expected
            1  // new value
        );
        
        if (oldValue === 0) {
            // Lock acquired
            return true;
        }
        
        // Lock is held by another thread, wait a bit
        if (Date.now() - start > timeoutMs) {
            console.error('[SocketProxyShared] Lock timeout!');
            return false;
        }
        
        // Yield to other threads
        Atomics.wait(sharedInt32, OFFSET_LOCK, 1, 1);
    }
}

// Helper: Release lock
function releaseLock() {
    var sharedInt32 = getSharedInt32();
    Atomics.store(sharedInt32, OFFSET_LOCK, 0);
    Atomics.notify(sharedInt32, OFFSET_LOCK, 1);
}

// Helper: Find socket entry by fd
function findSocketEntry(fd) {
    var sharedInt32 = getSharedInt32();
    for (var i = 0; i < MAX_SOCKETS; i++) {
        var offset = OFFSET_SOCKET_DATA + (i * SOCKET_ENTRY_SIZE);
        var entryFd = Atomics.load(sharedInt32, offset);
        if (entryFd === fd) {
            return offset;
        }
    }
    return -1;
}

// Helper: Find unused socket entry
function findUnusedSocketEntry() {
    var sharedInt32 = getSharedInt32();
    for (var i = 0; i < MAX_SOCKETS; i++) {
        var offset = OFFSET_SOCKET_DATA + (i * SOCKET_ENTRY_SIZE);
        var entryFd = Atomics.load(sharedInt32, offset);
        if (entryFd === -1) {
            return offset;
        }
    }
    return -1;
}

// Helper: IP string to 32-bit integer
function ipToInt(ip) {
    var parts = ip.split('.');
    if (parts.length !== 4) return 0;
    return (parseInt(parts[0]) << 24) |
           (parseInt(parts[1]) << 16) |
           (parseInt(parts[2]) << 8) |
           parseInt(parts[3]);
}

// Helper: 32-bit integer to IP string
function intToIp(num) {
    return ((num >>> 24) & 0xFF) + '.' +
           ((num >>> 16) & 0xFF) + '.' +
           ((num >>> 8) & 0xFF) + '.' +
           (num & 0xFF);
}

var SocketProxy = {
    /**
     * Create a new socket
     */
    socket: function(domain, type, protocol) {
        console.log('[SocketProxyShared] socket() called: domain=' + domain + ', type=' + type);
        
        if (!acquireLock(1000)) {
            console.error('[SocketProxyShared] Failed to acquire lock for socket()');
            return -1;
        }
        
        try {
            // Only support IPv4 UDP for now
            if (type !== 2) { // SOCK_DGRAM
                console.error('[SocketProxyShared] Only UDP supported');
                return -1;
            }
            
            // Allocate new FD
            var fd = Atomics.add(getSharedInt32(), OFFSET_NEXT_FD, 1);
            
            // Find unused entry
            var offset = findUnusedSocketEntry();
            if (offset === -1) {
                console.error('[SocketProxyShared] No free socket entries!');
                return -1;
            }
            
            // Write socket data
            Atomics.store(getSharedInt32(), offset + 0, fd);
            Atomics.store(getSharedInt32(), offset + 1, domain);
            Atomics.store(getSharedInt32(), offset + 2, type);
            Atomics.store(getSharedInt32(), offset + 3, protocol);
            Atomics.store(getSharedInt32(), offset + 4, 0); // not bound
            Atomics.store(getSharedInt32(), offset + 5, 0); // port
            Atomics.store(getSharedInt32(), offset + 6, 0); // IP part 1
            
            console.log('[SocketProxyShared] Created socket fd=' + fd);
            return fd;
            
        } finally {
            releaseLock();
        }
    },
    
    /**
     * Bind socket to address
     */
    bind: function(fd, address, port) {
        console.log('[SocketProxyShared] bind() called: fd=' + fd + ', address=' + address + ', port=' + port);
        
        // Normalize addresses for localhost loopback
        // Convert IPv6 ::1 to IPv4 127.0.0.1 for consistency
        // Convert 0.0.0.0 (any address) to 127.0.0.1 for localhost-only operation
        if (address === '::1' || address === '0.0.0.0' || address === '::') {
            console.log('[SocketProxyShared] Normalizing address ' + address + ' to 127.0.0.1');
            address = '127.0.0.1';
        }
        
        // Port 0 means "assign any available port" - allocate an ephemeral port
        if (port === 0) {
            port = 30000 + (fd % 30000); // Use fd-based ephemeral port
            console.log('[SocketProxyShared] Port 0 requested, assigning ephemeral port ' + port);
        }
        
        if (!acquireLock(1000)) {
            console.error('[SocketProxyShared] Failed to acquire lock for bind()');
            return -1;
        }
        
        try {
            var offset = findSocketEntry(fd);
            if (offset === -1) {
                // Debug: dump all socket entries
                console.error('[SocketProxyShared] bind: Invalid socket fd=' + fd);
                console.error('[SocketProxyShared] Dumping all socket entries:');
                for (var i = 0; i < 10; i++) {
                    var off = OFFSET_SOCKET_DATA + (i * SOCKET_ENTRY_SIZE);
                    var entryFd = Atomics.load(getSharedInt32(), off);
                    if (entryFd !== -1) {
                        console.error('  Entry ' + i + ': fd=' + entryFd);
                    }
                }
                return -1;
            }
            
            var bound = Atomics.load(getSharedInt32(), offset + 4);
            if (bound) {
                console.error('[SocketProxyShared] bind: Socket already bound');
                return -1;
            }
            
            // Mark as bound
            Atomics.store(getSharedInt32(), offset + 4, 1);
            Atomics.store(getSharedInt32(), offset + 5, port);
            
            // Store IP address (simplified - just store as int)
            var ipInt = ipToInt(address);
            Atomics.store(getSharedInt32(), offset + 6, ipInt);
            
            // Create packet queue for this address:port
            var key = address + ':' + port;
            if (!self._luantiSocketPacketQueues[key]) {
                self._luantiSocketPacketQueues[key] = [];
            }
            
            console.log('[SocketProxyShared] Socket bound to ' + key);
            return 0;
            
        } finally {
            releaseLock();
        }
    },
    
    /**
     * Send data to address
     */
    sendto: function(fd, data, destAddress, destPort) {
        var offset = findSocketEntry(fd);
        if (offset === -1) {
            console.error('[SocketProxyShared] sendto: Invalid socket fd=' + fd);
            return -1;
        }
        
        // Auto-bind if not already bound (like real UDP does)
        var bound = Atomics.load(getSharedInt32(), offset + 4);
        if (!bound) {
            console.log('[SocketProxyShared] sendto: Auto-binding unbound socket fd=' + fd);
            if (!acquireLock(1000)) {
                console.error('[SocketProxyShared] Failed to acquire lock for auto-bind');
                return -1;
            }
            
            try {
                // Bind to 127.0.0.1 with ephemeral port (use fd as port for uniqueness)
                var ephemeralPort = 30000 + (fd % 30000); // Ephemeral port range
                Atomics.store(getSharedInt32(), offset + 4, 1); // Mark as bound
                Atomics.store(getSharedInt32(), offset + 5, ephemeralPort);
                Atomics.store(getSharedInt32(), offset + 6, ipToInt('127.0.0.1'));
                
                // Create packet queue for this address:port
                var key = '127.0.0.1:' + ephemeralPort;
                if (!self._luantiSocketPacketQueues[key]) {
                    self._luantiSocketPacketQueues[key] = [];
                }
                
                console.log('[SocketProxyShared] Auto-bound socket fd=' + fd + ' to ' + key);
            } finally {
                releaseLock();
            }
        }
        
        // Route packet to destination's queue
        var destKey = destAddress + ':' + destPort;
        
        if (!self._luantiSocketPacketQueues[destKey]) {
            // No one listening on this address:port
            console.log('[SocketProxyShared] sendto: No listener on ' + destKey);
            return data.length; // Pretend it was sent (UDP doesn't guarantee delivery)
        }
        
        // Get source info (after potential auto-bind)
        var srcPort = Atomics.load(getSharedInt32(), offset + 5);
        var srcIpInt = Atomics.load(getSharedInt32(), offset + 6);
        var srcAddress = intToIp(srcIpInt);
        
        // Add packet to destination's queue
        self._luantiSocketPacketQueues[destKey].push({
            data: new Uint8Array(data),
            address: srcAddress,
            port: srcPort
        });
        
        return data.length;
    },
    
    /**
     * Receive data from socket
     */
    recvfrom: function(fd, buffer, maxLen) {
        var offset = findSocketEntry(fd);
        if (offset === -1) {
            // Suppress error logging - happens frequently when polling
            return null;
        }
        
        var bound = Atomics.load(getSharedInt32(), offset + 4);
        if (!bound) {
            console.error('[SocketProxyShared] recvfrom: Socket not bound');
            return null;
        }
        
        // Get local address:port
        var localPort = Atomics.load(getSharedInt32(), offset + 5);
        var localIpInt = Atomics.load(getSharedInt32(), offset + 6);
        var localAddress = intToIp(localIpInt);
        var key = localAddress + ':' + localPort;
        
        // Check packet queue
        var queue = self._luantiSocketPacketQueues[key];
        if (!queue || queue.length === 0) {
            return null; // No data (EAGAIN)
        }
        
        // Get packet from queue
        var packet = queue.shift();
        
        // Copy data to buffer
        var copyLen = Math.min(packet.data.length, maxLen);
        for (var i = 0; i < copyLen; i++) {
            buffer[i] = packet.data[i];
        }
        
        return {
            length: copyLen,
            address: packet.address,
            port: packet.port
        };
    },
    
    /**
     * Close socket
     */
    close: function(fd) {
        console.log('[SocketProxyShared] close() called: fd=' + fd);
        
        if (!acquireLock(1000)) {
            console.error('[SocketProxyShared] Failed to acquire lock for close()');
            return -1;
        }
        
        try {
            var offset = findSocketEntry(fd);
            if (offset === -1) {
                console.error('[SocketProxyShared] close: Invalid socket fd=' + fd);
                return -1;
            }
            
            // Mark entry as unused
            Atomics.store(getSharedInt32(), offset + 0, -1);
            
            console.log('[SocketProxyShared] Socket closed: fd=' + fd);
            return 0;
            
        } finally {
            releaseLock();
        }
    }
};

console.log('[SocketProxyShared] Thread-safe socket proxy initialized');

