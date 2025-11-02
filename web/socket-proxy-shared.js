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
// [0]: Next FD counter (Int32)
// [1]: Lock for socket registry (Int32, 0=unlocked, 1=locked)
// [2]: Packet ring buffer write index (Int32)
// [3]: Packet ring buffer read index (Int32)
// [4]: Packet ring buffer lock (Int32)
// [5-1023]: Socket registry data (1019 Int32s)
// [1024+]: Packet ring buffer

var SHARED_MEMORY_SIZE = 1024 * 1024; // 1MB
var OFFSET_NEXT_FD = 0;
var OFFSET_LOCK = 1;
var OFFSET_PACKET_WRITE_IDX = 2;
var OFFSET_PACKET_READ_IDX = 3;
var OFFSET_PACKET_LOCK = 4;
var OFFSET_SOCKET_DATA = 5;

// Maximum number of sockets
var MAX_SOCKETS = 32; // Reduced to make more room for packet buffer
var SOCKET_ENTRY_SIZE = 16; // Int32s per socket entry

// Socket entry layout (in Int32 units):
// [0]: fd (-1 = unused)
// [1]: domain
// [2]: type  
// [3]: protocol
// [4]: bound (0/1)
// [5]: localPort
// [6]: localAddress (as 32-bit int)
// [7-15]: reserved

// Packet ring buffer starts after socket data
var PACKET_BUFFER_START = OFFSET_SOCKET_DATA + (MAX_SOCKETS * SOCKET_ENTRY_SIZE);
var PACKET_BUFFER_SIZE = 8192; // Number of Int32s for packet buffer
var MAX_PACKET_SIZE = 2048; // Max packet size in bytes
var PACKET_ENTRY_SIZE = 520; // Int32s per packet entry (2080 bytes = 2048 data + 32 metadata)
var MAX_PACKETS = Math.floor((SHARED_MEMORY_SIZE / 4 - PACKET_BUFFER_START) / PACKET_ENTRY_SIZE); // Calculate max packets from available space

// Packet entry layout (in Int32 units):
// [0]: valid flag (0=empty, 1=has data)
// [1]: dest address (as 32-bit int)
// [2]: dest port
// [3]: src address (as 32-bit int)
// [4]: src port
// [5]: data length
// [6-519]: packet data (up to 2048 bytes = 512 Int32s)

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
        console.log('[SocketProxyShared] Using shared buffer from self (packets stored in SharedArrayBuffer ring buffer)');
        _socketProxySharedInt32 = self._luantiSocketSharedInt32;
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

// Helper: Acquire packet buffer lock
function acquirePacketLock(timeoutMs) {
    var sharedInt32 = getSharedInt32();
    var start = Date.now();
    while (true) {
        var oldValue = Atomics.compareExchange(
            sharedInt32,
            OFFSET_PACKET_LOCK,
            0, // expected
            1  // new value
        );
        
        if (oldValue === 0) {
            return true;
        }
        
        if (Date.now() - start > timeoutMs) {
            console.error('[SocketProxyShared] Packet lock timeout!');
            return false;
        }
        
        Atomics.wait(sharedInt32, OFFSET_PACKET_LOCK, 1, 1);
    }
}

// Helper: Release packet buffer lock
function releasePacketLock() {
    var sharedInt32 = getSharedInt32();
    Atomics.store(sharedInt32, OFFSET_PACKET_LOCK, 0);
    Atomics.notify(sharedInt32, OFFSET_PACKET_LOCK, 1);
}

// Helper: Write packet to ring buffer
function writePacket(destAddr, destPort, srcAddr, srcPort, data) {
    var sharedInt32 = getSharedInt32();
    
    if (!acquirePacketLock(1000)) {
        console.error('[SocketProxyShared] Failed to acquire packet lock for write');
        return false;
    }
    
    try {
        // Find an empty slot (linear search for simplicity)
        for (var i = 0; i < MAX_PACKETS; i++) {
            var offset = PACKET_BUFFER_START + (i * PACKET_ENTRY_SIZE);
            var valid = Atomics.load(sharedInt32, offset);
            
            if (valid === 0) {
                // Found empty slot, write packet metadata
                Atomics.store(sharedInt32, offset + 1, ipToInt(destAddr));
                Atomics.store(sharedInt32, offset + 2, destPort);
                Atomics.store(sharedInt32, offset + 3, ipToInt(srcAddr));
                Atomics.store(sharedInt32, offset + 4, srcPort);
                Atomics.store(sharedInt32, offset + 5, data.length);
                
                // Write packet data (as bytes, 4 bytes per Int32)
                // Pack 4 bytes into each Int32 to avoid partial writes and data corruption
                var dataOffset = offset + 6;
                for (var j = 0; j < data.length; j += 4) {
                    var int32Idx = dataOffset + Math.floor(j / 4);
                    var val = 0;
                    // Pack up to 4 bytes into this Int32 (little-endian)
                    for (var k = 0; k < 4 && (j + k) < data.length; k++) {
                        val |= (data[j + k] << (k * 8));
                    }
                    Atomics.store(sharedInt32, int32Idx, val);
                }
                
                // Mark as valid (must be last to ensure data is written first)
                Atomics.store(sharedInt32, offset, 1);
                
                return true;
            }
        }
        
        console.error('[SocketProxyShared] Packet buffer full!');
        return false;
        
    } finally {
        releasePacketLock();
    }
}

// Helper: Read packet from ring buffer for specific address:port
function readPacket(destAddr, destPort, buffer, maxLen) {
    var sharedInt32 = getSharedInt32();
    var destAddrInt = ipToInt(destAddr);
    
    if (!acquirePacketLock(1000)) {
        console.error('[SocketProxyShared] Failed to acquire packet lock for read');
        return null;
    }
    
    try {
        // Count and log available packets for debugging
        var availablePackets = 0;
        var packetInfo = [];
        for (var i = 0; i < MAX_PACKETS; i++) {
            var offset = PACKET_BUFFER_START + (i * PACKET_ENTRY_SIZE);
            var valid = Atomics.load(sharedInt32, offset);
            if (valid === 1) {
                availablePackets++;
                var pktDestAddr = Atomics.load(sharedInt32, offset + 1);
                var pktDestPort = Atomics.load(sharedInt32, offset + 2);
                packetInfo.push(intToIp(pktDestAddr) + ':' + pktDestPort);
            }
        }
        
        if (availablePackets > 0) {
            console.log('[SocketProxyShared] readPacket: Looking for ' + destAddr + ':' + destPort + ', found ' + availablePackets + ' packets: [' + packetInfo.join(', ') + ']');
        }
        
        // Find a packet for this destination
        for (var i = 0; i < MAX_PACKETS; i++) {
            var offset = PACKET_BUFFER_START + (i * PACKET_ENTRY_SIZE);
            var valid = Atomics.load(sharedInt32, offset);
            
            if (valid === 1) {
                var pktDestAddr = Atomics.load(sharedInt32, offset + 1);
                var pktDestPort = Atomics.load(sharedInt32, offset + 2);
                
                if (pktDestAddr === destAddrInt && pktDestPort === destPort) {
                    // Found matching packet
                    var srcAddr = Atomics.load(sharedInt32, offset + 3);
                    var srcPort = Atomics.load(sharedInt32, offset + 4);
                    var dataLen = Atomics.load(sharedInt32, offset + 5);
                    
                    // Read packet data
                    var copyLen = Math.min(dataLen, maxLen);
                    var dataOffset = offset + 6;
                    for (var j = 0; j < copyLen; j++) {
                        var int32Idx = dataOffset + Math.floor(j / 4);
                        var byteIdx = j % 4;
                        var val = Atomics.load(sharedInt32, int32Idx);
                        buffer[j] = (val >>> (byteIdx * 8)) & 0xFF;
                    }
                    
                    // Mark slot as empty (must be last)
                    Atomics.store(sharedInt32, offset, 0);
                    
                    return {
                        length: copyLen,
                        address: intToIp(srcAddr),
                        port: srcPort
                    };
                }
            }
        }
        
        // No matching packet found
        if (availablePackets > 0) {
            console.warn('[SocketProxyShared] readPacket: No match for ' + destAddr + ':' + destPort + ' among ' + availablePackets + ' packets');
        }
        return null;
        
    } finally {
        releasePacketLock();
    }
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
            
            console.log('[SocketProxyShared] Socket bound to ' + address + ':' + port);
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
                
                console.log('[SocketProxyShared] Auto-bound socket fd=' + fd + ' to 127.0.0.1:' + ephemeralPort);
            } finally {
                releaseLock();
            }
        }
        
        // Get source info (after potential auto-bind)
        var srcPort = Atomics.load(getSharedInt32(), offset + 5);
        var srcIpInt = Atomics.load(getSharedInt32(), offset + 6);
        var srcAddress = intToIp(srcIpInt);
        
        // Write packet to shared ring buffer
        console.log('[SocketProxyShared] sendto: Writing packet from ' + srcAddress + ':' + srcPort + ' to ' + destAddress + ':' + destPort + ' (' + data.length + ' bytes)');
        if (!writePacket(destAddress, destPort, srcAddress, srcPort, data)) {
            console.error('[SocketProxyShared] Failed to write packet to ring buffer');
            return -1;
        }
        
        console.log('[SocketProxyShared] sendto: Packet written successfully');
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
        
        // Read packet from shared ring buffer
        var result = readPacket(localAddress, localPort, buffer, maxLen);
        if (result) {
            console.log('[SocketProxyShared] recvfrom fd=' + fd + ': Received packet on ' + localAddress + ':' + localPort + ' from ' + result.address + ':' + result.port + ' (' + result.length + ' bytes)');
        }
        return result;
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

