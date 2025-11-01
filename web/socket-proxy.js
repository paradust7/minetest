/**
 * Socket Proxy for Luanti Web Port
 * 
 * Stage 1: Localhost Loopback
 * Provides in-memory packet routing for local client-server communication
 * 
 * Future: Can be extended to support WebRTC DataChannels, WebTransport, etc.
 * 
 * With pthreads: This object must be shared across all threads.
 * We store it on the global scope so workers can access the main thread's instance.
 */

// Check if we're in a worker thread
var isWorker = typeof importScripts === 'function';
var isMainThread = typeof window !== 'undefined';

// With pthreads, we need ONE shared SocketProxy instance
// Store it in a global location accessible to all threads
if (typeof globalThis === 'undefined') {
    // Polyfill for older browsers
    (function() {
        if (typeof self !== 'undefined') { globalThis = self; }
        else if (typeof window !== 'undefined') { globalThis = window; }
        else if (typeof global !== 'undefined') { globalThis = global; }
        else { throw new Error('Unable to locate global object'); }
    })();
}

// Only create SocketProxy once (on first load, whether main thread or worker)
if (!globalThis._luantiSocketProxy) {
    globalThis._luantiSocketProxy = {
    // Socket registry: fd -> socket info
    sockets: {},
    nextFd: 100, // Start at 100 to avoid conflicts with stdin/stdout/stderr
    
    // Packet queues: "ip:port" -> array of packets
    packetQueues: {},
    
    /**
     * Create a new socket
     * @param {number} domain - AF_INET (2) or AF_INET6 (10)
     * @param {number} type - SOCK_DGRAM (2) for UDP
     * @param {number} protocol - IPPROTO_UDP (17)
     * @returns {number} file descriptor or -1 on error
     */
    socket: function(domain, type, protocol) {
        console.log('[SocketProxy] socket() called: domain=' + domain + ', type=' + type + ', protocol=' + protocol);
        
        // Only support IPv4 UDP for now
        if (domain !== 2) { // AF_INET
            console.warn('[SocketProxy] Only IPv4 (AF_INET) supported, got domain=' + domain);
            // Don't fail - just create it anyway, we'll handle IPv6 addresses as IPv4
        }
        
        if (type !== 2) { // SOCK_DGRAM
            console.error('[SocketProxy] Only UDP (SOCK_DGRAM) supported, got type=' + type);
            return -1;
        }
        
        var fd = this.nextFd++;
        this.sockets[fd] = {
            domain: domain,
            type: type,
            protocol: protocol,
            bound: false,
            localAddress: null,
            localPort: null
        };
        
        console.log('[SocketProxy] Created socket fd=' + fd);
        return fd;
    },
    
    /**
     * Bind socket to address
     * @param {number} fd - file descriptor
     * @param {string} address - IP address (e.g., "127.0.0.1")
     * @param {number} port - port number
     * @returns {number} 0 on success, -1 on error
     */
    bind: function(fd, address, port) {
        console.log('[SocketProxy] bind() called: fd=' + fd + ', address=' + address + ', port=' + port);
        
        var sock = this.sockets[fd];
        if (!sock) {
            console.error('[SocketProxy] bind: Invalid socket fd=' + fd);
            return -1;
        }
        
        if (sock.bound) {
            console.error('[SocketProxy] bind: Socket already bound');
            return -1;
        }
        
        sock.bound = true;
        sock.localAddress = address;
        sock.localPort = port;
        
        // Create packet queue for this address:port
        var key = address + ':' + port;
        if (!this.packetQueues[key]) {
            this.packetQueues[key] = [];
        }
        
        console.log('[SocketProxy] Socket bound to ' + key);
        return 0;
    },
    
    /**
     * Send data to address
     * @param {number} fd - file descriptor
     * @param {Uint8Array} data - data to send
     * @param {string} destAddress - destination IP
     * @param {number} destPort - destination port
     * @returns {number} bytes sent or -1 on error
     */
    sendto: function(fd, data, destAddress, destPort) {
        var sock = this.sockets[fd];
        if (!sock) {
            console.error('[SocketProxy] sendto: Invalid socket fd=' + fd);
            return -1;
        }
        
        // Check if destination is localhost
        var isLocalhost = destAddress === '127.0.0.1' || 
                         destAddress === 'localhost' ||
                         destAddress === '::1' ||
                         destAddress === '0.0.0.0';
        
        if (!isLocalhost) {
            console.error('[SocketProxy] sendto: Remote addresses not supported yet (got ' + destAddress + ')');
            console.error('[SocketProxy] Stage 1 only supports localhost loopback');
            return -1;
        }
        
        // Route to local packet queue
        var destKey = destAddress + ':' + destPort;
        if (!this.packetQueues[destKey]) {
            this.packetQueues[destKey] = [];
        }
        
        // Create packet with source info
        var packet = {
            data: new Uint8Array(data), // Copy data
            srcAddress: sock.localAddress || '127.0.0.1',
            srcPort: sock.localPort || 0,
            timestamp: Date.now()
        };
        
        this.packetQueues[destKey].push(packet);
        
        // Debug: only log occasionally to avoid spam
        if (Math.random() < 0.01) { // 1% of packets
            console.log('[SocketProxy] sendto: ' + data.length + ' bytes to ' + destKey + 
                       ' (queue size: ' + this.packetQueues[destKey].length + ')');
        }
        
        return data.length;
    },
    
    /**
     * Receive data from socket
     * @param {number} fd - file descriptor
     * @param {Uint8Array} buffer - buffer to write data into
     * @param {number} maxLen - maximum bytes to read
     * @returns {Object} {length: number, address: string, port: number} or null
     */
    recvfrom: function(fd, buffer, maxLen) {
        var sock = this.sockets[fd];
        if (!sock) {
            // Socket not found - this happens when threads have separate SocketProxy instances
            // Only log occasionally to avoid spam
            if (!this._recvErrorCount) this._recvErrorCount = {};
            if (!this._recvErrorCount[fd]) {
                this._recvErrorCount[fd] = 0;
            }
            this._recvErrorCount[fd]++;
            if (this._recvErrorCount[fd] <= 3) {
                console.error('[SocketProxy] recvfrom: Invalid socket fd=' + fd + ' (will suppress further errors)');
            }
            return null;
        }
        
        if (!sock.bound) {
            console.error('[SocketProxy] recvfrom: Socket not bound');
            return null;
        }
        
        // Get packet queue for this socket
        var key = sock.localAddress + ':' + sock.localPort;
        var queue = this.packetQueues[key];
        
        if (!queue || queue.length === 0) {
            // No data available - this is normal for non-blocking sockets
            return null;
        }
        
        // Get oldest packet
        var packet = queue.shift();
        
        // Copy data to buffer
        var copyLen = Math.min(packet.data.length, maxLen);
        for (var i = 0; i < copyLen; i++) {
            buffer[i] = packet.data[i];
        }
        
        // Debug: only log occasionally
        if (Math.random() < 0.01) { // 1% of packets
            console.log('[SocketProxy] recvfrom: ' + copyLen + ' bytes from ' + 
                       packet.srcAddress + ':' + packet.srcPort +
                       ' (queue remaining: ' + queue.length + ')');
        }
        
        return {
            length: copyLen,
            address: packet.srcAddress,
            port: packet.srcPort
        };
    },
    
    /**
     * Close socket
     * @param {number} fd - file descriptor
     * @returns {number} 0 on success, -1 on error
     */
    close: function(fd) {
        console.log('[SocketProxy] close() called: fd=' + fd);
        
        var sock = this.sockets[fd];
        if (!sock) {
            console.error('[SocketProxy] close: Invalid socket fd=' + fd);
            return -1;
        }
        
        // Clean up packet queue if bound
        if (sock.bound) {
            var key = sock.localAddress + ':' + sock.localPort;
            delete this.packetQueues[key];
        }
        
        delete this.sockets[fd];
        return 0;
    },
    
    /**
     * Set socket options (stub for now)
     */
    setsockopt: function(fd, level, optname, optval) {
        // Most socket options don't matter for in-memory routing
        // Just return success
        return 0;
    },
    
    /**
     * Get socket options (stub for now)
     */
    getsockopt: function(fd, level, optname) {
        // Return dummy values
        return 0;
    }
    };
}

// Create alias for easy access
var SocketProxy = globalThis._luantiSocketProxy;

// Export for use in Emscripten
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SocketProxy;
}

