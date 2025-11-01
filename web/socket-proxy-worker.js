/**
 * Socket Proxy Worker
 * 
 * Dedicated worker thread that owns the SocketProxy instance
 * All other threads (main, server, client network threads) communicate
 * with this worker via postMessage for socket operations
 */

// Import the SocketProxy implementation
importScripts('socket-proxy.js');

console.log('[SocketProxyWorker] Worker started');

// Message handler for socket operations
self.onmessage = function(e) {
    const { id, operation, args } = e.data;
    let result;
    
    try {
        switch (operation) {
            case 'socket':
                result = SocketProxy.socket(args.domain, args.type, args.protocol);
                break;
            
            case 'bind':
                result = SocketProxy.bind(args.fd, args.address, args.port);
                break;
            
            case 'sendto':
                result = SocketProxy.sendto(args.fd, args.data, args.destAddress, args.destPort);
                break;
            
            case 'recvfrom':
                result = SocketProxy.recvfrom(args.fd, args.buffer, args.len);
                break;
            
            case 'close':
                result = SocketProxy.close(args.fd);
                break;
            
            default:
                console.error('[SocketProxyWorker] Unknown operation:', operation);
                result = { error: 'Unknown operation' };
        }
        
        // Send result back
        self.postMessage({ id, result });
        
    } catch (error) {
        console.error('[SocketProxyWorker] Error:', error);
        self.postMessage({ id, error: error.message });
    }
};

console.log('[SocketProxyWorker] Ready to handle socket operations');

