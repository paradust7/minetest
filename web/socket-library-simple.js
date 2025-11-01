// Minimal socket library for Emscripten
// Overrides POSIX socket functions to use our JavaScript SocketProxy

addToLibrary({
    socket: function(domain, type, protocol) {
        console.log('[socket-library] socket() called');
        var fd = SocketProxy.socket(domain, type, protocol);
        console.log('[socket-library] socket() returning ' + fd);
        return fd;
    },
    
    bind: function(sockfd, addr, addrlen) {
        console.log('[socket-library] bind() called');
        var family = getValue(addr, 'i16');
        var port_raw = getValue(addr + 2, 'i16');
        var port = ((port_raw & 0xFF) << 8) | ((port_raw >> 8) & 0xFF); // ntohs
        
        var address = '127.0.0.1';
        if (family === 2) {
            var ip = getValue(addr + 4, 'i32');
            address = (ip & 0xff) + '.' + ((ip >> 8) & 0xff) + '.' + 
                     ((ip >> 16) & 0xff) + '.' + ((ip >> 24) & 0xff);
        }
        
        var result = SocketProxy.bind(sockfd, address, port);
        console.log('[socket-library] bind() returning ' + result);
        return result;
    },
    
    sendto: function(sockfd, buf, len, flags, dest_addr, addrlen) {
        var family = getValue(dest_addr, 'i16');
        var port_raw = getValue(dest_addr + 2, 'i16');
        var port = ((port_raw & 0xFF) << 8) | ((port_raw >> 8) & 0xFF);
        
        var address = '127.0.0.1';
        if (family === 2) {
            var ip = getValue(dest_addr + 4, 'i32');
            address = (ip & 0xff) + '.' + ((ip >> 8) & 0xff) + '.' + 
                     ((ip >> 16) & 0xff) + '.' + ((ip >> 24) & 0xff);
        }
        
        var data = new Uint8Array(HEAPU8.buffer, buf, len).slice(0);
        var result = SocketProxy.sendto(sockfd, data, address, port);
        return result;
    },
    
    recvfrom: function(sockfd, buf, len, flags, src_addr, addrlen) {
        var buffer = new Uint8Array(len);
        var result = SocketProxy.recvfrom(sockfd, buffer, len);
        
        if (!result) {
            return -11; // EAGAIN
        }
        
        HEAPU8.set(buffer.subarray(0, result.length), buf);
        
        if (src_addr) {
            var parts = result.address.split('.');
            var ip = (parts[0] | 0) | ((parts[1] | 0) << 8) | 
                    ((parts[2] | 0) << 16) | ((parts[3] | 0) << 24);
            
            var port_host = result.port;
            var port_net = ((port_host & 0xFF) << 8) | ((port_host >> 8) & 0xFF); // htons
            
            setValue(src_addr, 2, 'i16'); // AF_INET
            setValue(src_addr + 2, port_net, 'i16');
            setValue(src_addr + 4, ip, 'i32');
            
            if (addrlen) {
                setValue(addrlen, 16, 'i32');
            }
        }
        
        return result.length;
    },
    
    setsockopt: function(sockfd, level, optname, optval, optlen) {
        return 0;
    },
    
    getsockopt: function(sockfd, level, optname, optval, optlen) {
        return 0;
    }
});

