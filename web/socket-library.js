/**
 * Emscripten Library for Socket Syscall Interception
 * 
 * This file provides JavaScript implementations of POSIX socket functions
 * that Emscripten will use instead of its default implementations.
 * 
 * These functions bridge C socket calls to our SocketProxy.
 */

mergeInto(LibraryManager.library, {
    /**
     * socket() - POSIX function
     * C signature: int socket(int domain, int type, int protocol)
     */
    socket__deps: [],
    socket__proxy: 'sync',
    socket: function(domain, type, protocol) {
        console.log('[socket-library] socket() intercepted: domain=' + domain + ', type=' + type + ', protocol=' + protocol);
        try {
            var fd = SocketProxy.socket(domain, type, protocol);
            if (fd < 0) {
                // Return error
                return -1;
            }
            console.log('[socket-library] socket() returning fd=' + fd);
            return fd;
        } catch (e) {
            console.error('[socket-library] socket() error:', e);
            return -1;
        }
    },
    
    /**
     * bind() - POSIX function
     * C signature: int bind(int sockfd, const struct sockaddr *addr, socklen_t addrlen)
     */
    bind__deps: ['$setErrNo', '$ntohs'],
    bind: function(sockfd, addr, addrlen) {
        try {
            console.log('[socket-library] bind() called: sockfd=' + sockfd + ', addr=' + addr + ', addrlen=' + addrlen);
            
            // Parse sockaddr structure
            // struct sockaddr_in {
            //     sa_family_t sin_family;  // 2 bytes
            //     in_port_t sin_port;      // 2 bytes (network byte order)
            //     struct in_addr sin_addr; // 4 bytes (network byte order)
            // };
            
            // Read address family (first 2 bytes)
            console.log('[socket-library] Reading family from addr=' + addr);
            var family = getValue(addr, 'i16');
            console.log('[socket-library] Family=' + family);
            
            console.log('[socket-library] Reading port from addr+2=' + (addr + 2));
            var port = _ntohs(getValue(addr + 2, 'i16') & 0xFFFF);
            console.log('[socket-library] Port=' + port);
            
            var address;
            if (family === 2) { // AF_INET
                // Read IPv4 address (4 bytes at offset 4)
                console.log('[socket-library] Reading IPv4 from addr+4=' + (addr + 4));
                var ip = getValue(addr + 4, 'i32');
                address = (ip & 0xff) + '.' + ((ip >> 8) & 0xff) + '.' + 
                         ((ip >> 16) & 0xff) + '.' + ((ip >> 24) & 0xff);
                console.log('[socket-library] IPv4 address=' + address);
            } else if (family === 10) { // AF_INET6
                // For now, treat IPv6 localhost as IPv4 localhost
                // Full IPv6 support can be added later
                address = '127.0.0.1';
                console.warn('[socket-library] IPv6 address treated as IPv4 localhost');
            } else {
                console.error('[socket-library] Unsupported address family:', family);
                setErrNo(97); // EAFNOSUPPORT
                return -1;
            }
            
            console.log('[socket-library] Calling SocketProxy.bind(' + sockfd + ', ' + address + ', ' + port + ')');
            var result = SocketProxy.bind(sockfd, address, port);
            if (result < 0) {
                setErrNo(22); // EINVAL
                return -1;
            }
            console.log('[socket-library] bind() successful');
            return 0;
        } catch (e) {
            console.error('[socket-library] bind() error:', e);
            console.error('[socket-library] Stack:', e.stack);
            setErrNo(22); // EINVAL
            return -1;
        }
    },
    
    /**
     * sendto() - POSIX function
     * C signature: ssize_t sendto(int sockfd, const void *buf, size_t len, int flags,
     *                              const struct sockaddr *dest_addr, socklen_t addrlen)
     */
    sendto__deps: ['$setErrNo'],
    sendto: function(sockfd, buf, len, flags, dest_addr, addrlen) {
        try {
            // Parse destination address
            var family = getValue(dest_addr, 'i16');
            var port = ntohs(getValue(dest_addr + 2, 'i16') & 0xFFFF);
            
            var address;
            if (family === 2) { // AF_INET
                var ip = getValue(dest_addr + 4, 'i32');
                address = (ip & 0xff) + '.' + ((ip >> 8) & 0xff) + '.' + 
                         ((ip >> 16) & 0xff) + '.' + ((ip >> 24) & 0xff);
            } else if (family === 10) { // AF_INET6
                address = '127.0.0.1';
                console.warn('[socket-library] IPv6 destination treated as IPv4 localhost');
            } else {
                console.error('[socket-library] Unsupported address family:', family);
                setErrNo(97); // EAFNOSUPPORT
                return -1;
            }
            
            // Copy data from WASM memory (use HEAPU8 view for efficiency)
            var data = new Uint8Array(HEAPU8.buffer, buf, len).slice(0);
            
            var result = SocketProxy.sendto(sockfd, data, address, port);
            if (result < 0) {
                setErrNo(22); // EINVAL
                return -1;
            }
            return result;
        } catch (e) {
            console.error('[socket-library] sendto() error:', e);
            setErrNo(22); // EINVAL
            return -1;
        }
    },
    
    /**
     * recvfrom() - POSIX function
     * C signature: ssize_t recvfrom(int sockfd, void *buf, size_t len, int flags,
     *                                struct sockaddr *src_addr, socklen_t *addrlen)
     */
    recvfrom__deps: ['$setErrNo'],
    recvfrom: function(sockfd, buf, len, flags, src_addr, addrlen) {
        try {
            // Create buffer for receiving
            var buffer = new Uint8Array(len);
            
            var result = SocketProxy.recvfrom(sockfd, buffer, len);
            
            if (!result) {
                // No data available - return EAGAIN (would block)
                setErrNo(11); // EAGAIN
                return -1;
            }
            
            // Copy data to WASM memory (use HEAPU8 view for efficiency)
            HEAPU8.set(buffer.subarray(0, result.length), buf);
            
            // Fill in source address if requested
            if (src_addr) {
                // Parse address string to IP
                var parts = result.address.split('.');
                var ip = (parts[0] | 0) | ((parts[1] | 0) << 8) | 
                        ((parts[2] | 0) << 16) | ((parts[3] | 0) << 24);
                
                // Write sockaddr_in structure
                setValue(src_addr, 2, 'i16'); // AF_INET
                setValue(src_addr + 2, htons(result.port), 'i16');
                setValue(src_addr + 4, ip, 'i32');
                
                // Write addrlen if provided
                if (addrlen) {
                    setValue(addrlen, 16, 'i32'); // sizeof(sockaddr_in)
                }
            }
            
            return result.length;
        } catch (e) {
            console.error('[socket-library] recvfrom() error:', e);
            setErrNo(22); // EINVAL
            return -1;
        }
    },
    
    /**
     * setsockopt() - POSIX function
     */
    setsockopt__deps: [],
    setsockopt: function(sockfd, level, optname, optval, optlen) {
        console.log('[socket-library] setsockopt() called');
        // Most options don't matter for in-memory routing
        // Just return success
        return 0;
    },
    
    /**
     * getsockopt() - POSIX function
     */
    getsockopt__deps: [],
    getsockopt: function(sockfd, level, optname, optval, optlen) {
        console.log('[socket-library] getsockopt() called');
        // Return dummy success
        return 0;
    }
});

