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

// Shared memory layout
var SHARED_MEMORY_SIZE = 2 * 1024 * 1024; // 2MB
var RESERVED_SLOTS = 32;
var MAX_SOCKETS = 2;
var SOCKET_ENTRY_SIZE = 5;

// Indices for ring buffer implementation (int32 units)
// [0-15]: doorbells and ring buffer indices
var SOCKET_FD_IDX = 0;
var DOORBELL_SERVER_IDX = 1;
var DOORBELL_CLIENT_IDX = 2;
var DOORBELL_EXTERNAL_IDX = 3;
var CLIENT_TO_SERVER_WRITE_IDX = 4;
var CLIENT_TO_SERVER_READ_IDX = 5;
var SERVER_TO_CLIENT_WRITE_IDX = 6;
var SERVER_TO_CLIENT_READ_IDX = 7;
var EXTERNAL_TO_SERVER_WRITE_IDX = 8;
var EXTERNAL_TO_SERVER_READ_IDX = 9;
var SERVER_TO_EXTERNAL_WRITE_IDX = 10;
var SERVER_TO_EXTERNAL_READ_IDX = 11;
var EXTERNAL_TO_CLIENT_WRITE_IDX = 12;
var EXTERNAL_TO_CLIENT_READ_IDX = 13;
var CLIENT_TO_EXTERNAL_WRITE_IDX = 14;
var CLIENT_TO_EXTERNAL_READ_IDX = 15;

// [16]: socket management lock
var MANAGE_SOCKET_LOCK_IDX = 16; // 0 = unlocked, 1 = locked
// [17-26]: two slots for socket management data
var SOCKET_DATA_ARRAY_IDX = 17;
// Socket entry layout (in Int32 units):
// [0]: fd (0 = not in use)
// [1]: bound (0/1)
// [2]: localPort (0 = not set)
// [3]: localAddress (as 32-bit int, -1 = not set)
// [4]: worker role (0 = unknown, 1 = client, 2 = server, 3 = external)

// [27-31]: reserved

// Packet entry layout (in Int32 units):
// [0]: dest address (as 32-bit int)
// [1]: dest port
// [2]: src address (as 32-bit int)
// [3]: src port
// [4]: data length
// [5-6]: packet creation time (milliseconds)
// [7-518]: packet data (up to 2048 bytes = 512 Int32s)
var MAX_PACKET_DATA_SIZE_UINT8 = 2048;
var MAX_PACKET_SIZE_INT32 = 519;

var TOTAL_BUFFER_SIZE_INT32 = (SHARED_MEMORY_SIZE / 4) - RESERVED_SLOTS;
var PER_SEGMENT_SIZE_PACKETS = Math.floor(Math.floor(TOTAL_BUFFER_SIZE_INT32 / 6) / MAX_PACKET_SIZE_INT32); // six segments
var PER_SEGMENT_SIZE_INT32 = PER_SEGMENT_SIZE_PACKETS * MAX_PACKET_SIZE_INT32;
var CLIENT_TO_SERVER_OFFSET = RESERVED_SLOTS;
var SERVER_TO_CLIENT_OFFSET = CLIENT_TO_SERVER_OFFSET + PER_SEGMENT_SIZE_INT32;
var EXTERNAL_TO_SERVER_OFFSET = SERVER_TO_CLIENT_OFFSET + PER_SEGMENT_SIZE_INT32;
var SERVER_TO_EXTERNAL_OFFSET = EXTERNAL_TO_SERVER_OFFSET + PER_SEGMENT_SIZE_INT32;
var EXTERNAL_TO_CLIENT_OFFSET = SERVER_TO_EXTERNAL_OFFSET + PER_SEGMENT_SIZE_INT32;
var CLIENT_TO_EXTERNAL_OFFSET = EXTERNAL_TO_CLIENT_OFFSET + PER_SEGMENT_SIZE_INT32;

// Use the shared buffer created in pre.js (on main thread before workers started)
// Note: We access this lazily because workers may load this file before the buffer is visible
var _socketProxySharedInt32 = null;
var _socketProxySharedUint8 = null;
var _socketProxySharedDataView = null;

function initBuffer() {
    if (typeof self._luantiSocketSharedBuffer === 'undefined') {
        throw new Error('Shared socket buffer not initialized');
    }
    console.log('[SocketProxyShared] Using shared buffer from self (packets stored in SharedArrayBuffer ring buffer)');
    _socketProxySharedInt32 = new Int32Array(self._luantiSocketSharedBuffer);
    _socketProxySharedUint8= new Uint8Array(self._luantiSocketSharedBuffer);
    _socketProxySharedDataView = new DataView(self._luantiSocketSharedBuffer);
}

function getSharedInt32() {
    if (_socketProxySharedInt32 === null) {
        initBuffer();
    }
    return _socketProxySharedInt32;
}

function getSharedUint8() {
    if (_socketProxySharedUint8 === null) {
        initBuffer();
    }
    return _socketProxySharedUint8;
}

function getSharedDataView() {
    if (_socketProxySharedDataView === null) {
        initBuffer();
    }
    return _socketProxySharedDataView;
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

// Helper: Write packet to ring buffer
function writePacket(workerRole, destAddr, destPort, srcAddr, srcPort, data, fd) {
    var sharedInt32 = getSharedInt32();
    var sharedUint8 = getSharedUint8();
    var sharedDataView = getSharedDataView();
    var ringBufferOffset = 0;
    var writeIdxPos = 0;
    var readIdxPos = 0;
    var doorbellPos = 0;
    if (workerRole === 'client') {
        if (destAddr === '127.0.0.1') {
            // client to server
            ringBufferOffset = CLIENT_TO_SERVER_OFFSET;
            writeIdxPos = CLIENT_TO_SERVER_WRITE_IDX;
            readIdxPos = CLIENT_TO_SERVER_READ_IDX;
            doorbellPos = DOORBELL_SERVER_IDX;
        } else {
            // client to external
            ringBufferOffset = CLIENT_TO_EXTERNAL_OFFSET;
            writeIdxPos = CLIENT_TO_EXTERNAL_WRITE_IDX;
            readIdxPos = CLIENT_TO_EXTERNAL_READ_IDX;
            doorbellPos = DOORBELL_EXTERNAL_IDX;
        }
    } else if (workerRole === 'server') {
        if (destAddr === '127.0.0.1') {
            // server to client
            ringBufferOffset = SERVER_TO_CLIENT_OFFSET;
            writeIdxPos = SERVER_TO_CLIENT_WRITE_IDX;
            readIdxPos = SERVER_TO_CLIENT_READ_IDX;
            doorbellPos = DOORBELL_CLIENT_IDX;
        } else {
            // server to external
            ringBufferOffset = SERVER_TO_EXTERNAL_OFFSET;
            writeIdxPos = SERVER_TO_EXTERNAL_WRITE_IDX;
            readIdxPos = SERVER_TO_EXTERNAL_READ_IDX;
            doorbellPos = DOORBELL_EXTERNAL_IDX;
        }
    } else if (workerRole === 'external') {
        if (destAddr === '10.8.0.1') {
            // external to server
            ringBufferOffset = EXTERNAL_TO_SERVER_OFFSET;
            writeIdxPos = EXTERNAL_TO_SERVER_WRITE_IDX;
            readIdxPos = EXTERNAL_TO_SERVER_READ_IDX;
            doorbellPos = DOORBELL_SERVER_IDX;
        } else {
            // external to client
            ringBufferOffset = EXTERNAL_TO_CLIENT_OFFSET;
            writeIdxPos = EXTERNAL_TO_CLIENT_WRITE_IDX;
            readIdxPos = EXTERNAL_TO_CLIENT_READ_IDX;
            doorbellPos = DOORBELL_CLIENT_IDX;
        }
    } else {
        throw new Error('Invalid worker role');
    }

    if (data.length > MAX_PACKET_DATA_SIZE_UINT8) {
        console.error(`[SocketProxyShared] Packet data length exceeds max size: ${data.length} > ${MAX_PACKET_DATA_SIZE_UINT8}, dropping packet (Worker Role: ${workerRole})!`);
        return false;
    }

    var loadedWriteIdx = Atomics.load(sharedInt32, writeIdxPos);
    var writeOffset = ringBufferOffset + loadedWriteIdx;
    sharedInt32[writeOffset] = ipToInt(destAddr);
    sharedInt32[writeOffset + 1] = destPort;
    sharedInt32[writeOffset + 2] = ipToInt(srcAddr);
    sharedInt32[writeOffset + 3] = srcPort;
    sharedInt32[writeOffset + 4] = data.length;
    sharedDataView.setFloat64((writeOffset + 5) * 4, Date.now(), true); // 8 bytes per Float64, offset by 5 Int32s
    sharedUint8.set(data, (writeOffset + 7) * 4); // 4 bytes per Int32, offset by 5 Int32s

    // console.log('[SocketProxyShared] writePacket: wrote packet to ring buffer, destAddr=' + destAddr + ', writeOffset=' + writeOffset + ', data.length=' + data.length + ', fd=' + fd + ' (Worker Role: ' + workerRole + ')');

    // Update write index
    var newWriteIdx = (loadedWriteIdx + MAX_PACKET_SIZE_INT32) % PER_SEGMENT_SIZE_INT32;
    var loadedReadIdx = Atomics.load(sharedInt32, readIdxPos);
    if (newWriteIdx === loadedReadIdx) {
        console.warn(`[SocketProxyShared] Warning: Packet buffer full, dropping packet (Worker Role: ${workerRole})!`);
        return false;
    }

    Atomics.store(sharedInt32, writeIdxPos, newWriteIdx);
    Atomics.store(sharedInt32, doorbellPos, 1);
    Atomics.notify(sharedInt32, doorbellPos, 1);
    return true;
}

// Helper: Read packet from ring buffer for specific address:port
function readPacket(workerRole, buffer, maxLen, fd) {
    var sharedInt32 = getSharedInt32();
    var sharedUint8 = getSharedUint8();
    var sharedDataView = getSharedDataView();

    var ringBufferOffset = 0;
    var readPos = 0;
    var readIdxPos = 0;

    var READ_IDX_1 = 0;
    var READ_IDX_2 = 0;
    var WRITE_IDX_1 = 0;
    var WRITE_IDX_2 = 0;
    var OFFSET_1 = 0;
    var OFFSET_2 = 0;
    var DOORBELL_POS = 0;
    
    if (workerRole === 'client') {
        READ_IDX_1 = SERVER_TO_CLIENT_READ_IDX;
        READ_IDX_2 = EXTERNAL_TO_CLIENT_READ_IDX;
        WRITE_IDX_1 = SERVER_TO_CLIENT_WRITE_IDX;
        WRITE_IDX_2 = EXTERNAL_TO_CLIENT_WRITE_IDX;
        OFFSET_1 = SERVER_TO_CLIENT_OFFSET;
        OFFSET_2 = EXTERNAL_TO_CLIENT_OFFSET;
        DOORBELL_POS = DOORBELL_CLIENT_IDX;
    } else if (workerRole === 'server') {
        READ_IDX_1 = CLIENT_TO_SERVER_READ_IDX;
        READ_IDX_2 = EXTERNAL_TO_SERVER_READ_IDX;
        WRITE_IDX_1 = CLIENT_TO_SERVER_WRITE_IDX;
        WRITE_IDX_2 = EXTERNAL_TO_SERVER_WRITE_IDX;
        OFFSET_1 = CLIENT_TO_SERVER_OFFSET;
        OFFSET_2 = EXTERNAL_TO_SERVER_OFFSET;
        DOORBELL_POS = DOORBELL_SERVER_IDX;
    } else if (workerRole === 'external') {
        READ_IDX_1 = CLIENT_TO_EXTERNAL_READ_IDX;
        READ_IDX_2 = SERVER_TO_EXTERNAL_READ_IDX;
        WRITE_IDX_1 = CLIENT_TO_EXTERNAL_WRITE_IDX;
        WRITE_IDX_2 = SERVER_TO_EXTERNAL_WRITE_IDX;
        OFFSET_1 = CLIENT_TO_EXTERNAL_OFFSET;
        OFFSET_2 = SERVER_TO_EXTERNAL_OFFSET;
        DOORBELL_POS = DOORBELL_EXTERNAL_IDX;
    } else {
        throw new Error('Invalid worker role');
    }
    
    var waited = false;
    while (true) {
        var readPos1 = Atomics.load(sharedInt32, READ_IDX_1);
        var writePos1 = Atomics.load(sharedInt32, WRITE_IDX_1);
        var readPos2 = Atomics.load(sharedInt32, READ_IDX_2);
        var writePos2 = Atomics.load(sharedInt32, WRITE_IDX_2);
        var creationTime1 = Infinity;
        var creationTime2 = Infinity;

        if (readPos1 !== writePos1) {
            var readOffset = OFFSET_1 + readPos1;
            creationTime1 = sharedDataView.getFloat64((readOffset + 5) * 4, true);
        }
        if (readPos2 !== writePos2) {
            var readOffset = OFFSET_2 + readPos2;
            creationTime2 = sharedDataView.getFloat64((readOffset + 5) * 4, true);
        }
        if (creationTime1 < creationTime2) {
            ringBufferOffset = OFFSET_1;
            readIdxPos = READ_IDX_1;
            readPos = readPos1;
            // console.log('[SocketProxyShared] readPacket: read packet from ring buffer 1, readPos=' + readPos + ' (Worker Role: ' + workerRole + ')');
            break;
        } else if (creationTime2 < creationTime1) {
            ringBufferOffset = OFFSET_2;
            readIdxPos = READ_IDX_2;
            readPos = readPos2;
            // console.log('[SocketProxyShared] readPacket: read packet from ring buffer 2, readPos=' + readPos + ' (Worker Role: ' + workerRole + ')');
            break;
        } else {
            // console.log('[SocketProxyShared] readPacket: no packet found, fd=' + fd + ' (Worker Role: ' + workerRole + ')');
            if (!waited) {
                var result = Atomics.wait(sharedInt32, DOORBELL_POS, 0, 500);
                if (result === 'timedout') {
                    return null;
                }
                Atomics.store(sharedInt32, DOORBELL_POS, 0);
                waited = true;
            }
            else {
                return null;
            }
        }
    }

    var readOffset = ringBufferOffset + readPos;
    // Found matching packet
    var srcAddr = sharedInt32[readOffset + 2];
    var srcPort = sharedInt32[readOffset + 3];
    var dataLen = sharedInt32[readOffset + 4];
    
    // Read packet data
    var copyLen = Math.min(dataLen, maxLen);
    buffer.set(sharedUint8.subarray((readOffset + 7) * 4, ((readOffset + 7) * 4) + copyLen));

    // Advance read index
    var newReadIdx = (readPos + MAX_PACKET_SIZE_INT32) % PER_SEGMENT_SIZE_INT32;
    Atomics.store(sharedInt32, readIdxPos, newReadIdx);
    
    return {
        length: copyLen,
        address: intToIp(srcAddr),
        port: srcPort
    };
}

function acquireSocketManagementLock(timeoutMs = 200) {
    var sharedInt32 = getSharedInt32();
    var start = Date.now();
    while (true) {
        var oldValue = Atomics.compareExchange(sharedInt32, MANAGE_SOCKET_LOCK_IDX, 0, 1);
        if (oldValue === 0) {
            return true;
        }
        if (Date.now() - start > timeoutMs) {
            break;
        }
        Atomics.wait(sharedInt32, MANAGE_SOCKET_LOCK_IDX, 1, 1);
    }
    return false;
}

function releaseSocketManagementLock() {
    var sharedInt32 = getSharedInt32();
    var oldValue = Atomics.compareExchange(sharedInt32, MANAGE_SOCKET_LOCK_IDX, 1, 0);
    if (oldValue === 1) {
        Atomics.notify(sharedInt32, MANAGE_SOCKET_LOCK_IDX, 1);
        return true;
    }
    throw new Error('[SocketProxyShared] Failed to release socket management lock, expected 1, got ' + oldValue);
}

function findSocketIdxByFd(fd) {
    var sharedInt32 = getSharedInt32();
    for (var i = 0; i < MAX_SOCKETS; i++) {
        var testIdx = SOCKET_DATA_ARRAY_IDX + (i * SOCKET_ENTRY_SIZE);
        var foundFd = Atomics.load(sharedInt32, testIdx);
        if (foundFd === fd) {
            return testIdx;
        }
    }
    return -1;
}

function intToWorkerRole(intVal) {
    switch (intVal) {
        case 0:
            return 'unknown';
        case 1:
            return 'client';
        case 2:
            return 'server';
        case 3:
            return 'external';
        default:
            throw new Error('Invalid worker role: ' + intVal);
    }
}

function workerRoleToInt(workerRole) {
    switch (workerRole) {
        case 'unknown':
            return 0;
        case 'client':
            return 1;
        case 'server':
            return 2;
        case 'external':
            return 3;
        default:
            throw new Error('Invalid worker role: ' + workerRole);
    }
}

var SocketProxy = {
    fd: 0,
    bound: false,
    socketDataIdx: -1,
    
    randomPort: function() {
        const minPort = 49152;
        const maxPort = 65535;
        return minPort + Math.floor(Math.random() * (maxPort - minPort + 1));
    },
    
    /**
     * Create a new socket
     */
    socket: function(domain, type, protocol) {
        var sharedInt32 = getSharedInt32();

        // Only support IPv4 UDP for now
        if (type !== 2) { // SOCK_DGRAM
            console.error('[SocketProxyShared] Only UDP supported');
            return -1;
        }

        if (!acquireSocketManagementLock()) {
            console.error('[SocketProxyShared] Failed to acquire socket management lock');
            return -1;
        }

        try {
            this.socketDataIdx = findSocketIdxByFd(0);
            if (this.socketDataIdx === -1) {
                console.error('[SocketProxyShared] No free socket slots!');
                return -1;
            }

            var newFd = Atomics.add(sharedInt32, SOCKET_FD_IDX, 1);

            Atomics.store(sharedInt32, this.socketDataIdx, newFd);
            Atomics.store(sharedInt32, this.socketDataIdx + 1, 0); // not bound
            Atomics.store(sharedInt32, this.socketDataIdx + 2, 0); // localPort not set
            Atomics.store(sharedInt32, this.socketDataIdx + 3, -1); // localAddress not set
            Atomics.store(sharedInt32, this.socketDataIdx + 4, 0); // worker role unknown

            this.fd = newFd;
            this.bound = false;

            console.log('[SocketProxyShared] socket() called: domain=' + domain + ', type=' + type + ', fd=' + this.fd);
            return this.fd;
        } finally {
            releaseSocketManagementLock();
        }
    },
    
    /**
     * Bind socket to address
     */
    bind: function(fd, address, port) {
        var sharedInt32 = getSharedInt32();

        if (fd === 0) {
            throw new Error('[SocketProxyShared] bind: Invalid socket fd=0');
        }

        if (!acquireSocketManagementLock()) {
            console.error('[SocketProxyShared] Failed to acquire socket management lock');
            return -1;
        }

        try {
            console.log('[SocketProxyShared] bind() called: fd=' + fd + ', address=' + address + ', port=' + port);

            this.socketDataIdx = findSocketIdxByFd(fd);
            if (this.socketDataIdx === -1) {
                console.error('[SocketProxyShared] Invalid socket fd=' + fd);
                return -1;
            }

            var wasBound = Atomics.compareExchange(sharedInt32, this.socketDataIdx + 1, 0, 1);
            if (wasBound !== 0) {
                console.error('[SocketProxyShared] bind: Socket already bound');
                return -1;
            }
            
            // Normalize address to localhost
            address = '127.0.0.1';
            
            // Port 0 means "assign any available port" - allocate an ephemeral port
            if (port === 0) {
                Atomics.store(sharedInt32, this.socketDataIdx + 4, workerRoleToInt('client'));
                port = this.randomPort(); // Use random ephemeral port
                console.log('[SocketProxyShared] Port 0 requested, assigning ephemeral port ' + port);
            }
            else {
                Atomics.store(sharedInt32, this.socketDataIdx + 4, workerRoleToInt('server'));
            }

            Atomics.store(sharedInt32, this.socketDataIdx + 2, port);
            Atomics.store(sharedInt32, this.socketDataIdx + 3, ipToInt(address));

            this.fd = fd;
            this.bound = true;
            
            return 0;

        } finally {
            releaseSocketManagementLock();
        }
    },

    loadSocketDataWithAutoBind: function(fd, autoBind = true) {
        var sharedInt32 = getSharedInt32();
        // Load socket data by fd
        if (!acquireSocketManagementLock()) {
            console.error('[SocketProxyShared] Failed to acquire socket management lock');
            return -1;
        }

        try {
            this.socketDataIdx = findSocketIdxByFd(fd);
            if (this.socketDataIdx === -1) {
                console.error('[SocketProxyShared] Invalid socket fd=' + fd);
                return -1;
            }
            this.fd = fd;
            var workerRole = Atomics.load(sharedInt32, this.socketDataIdx + 4);
            var addressInt = Atomics.load(sharedInt32, this.socketDataIdx + 3);
            var port = Atomics.load(sharedInt32, this.socketDataIdx + 2);
            var bound = Atomics.load(sharedInt32, this.socketDataIdx + 1) === 1;
            if (!bound && autoBind) {
                // Auto-bind if not already bound
                bound = true;
                Atomics.store(sharedInt32, this.socketDataIdx + 1, 1);
            }
            if (addressInt === -1) {
                addressInt = ipToInt('127.0.0.1');
                Atomics.store(sharedInt32, this.socketDataIdx + 3, addressInt);
            }
            if (port === 0) {
                port = this.randomPort();
                Atomics.store(sharedInt32, this.socketDataIdx + 2, port);
            }
            if (workerRole === workerRoleToInt('unknown')) {
                workerRole = workerRoleToInt('client');
                Atomics.store(sharedInt32, this.socketDataIdx + 4, workerRole);
            }

            this.bound = bound;

        } finally {
            releaseSocketManagementLock();
        }

        return 0;
    },

    /**
     * Send data to address
     */
    sendto: function(fd, data, destAddress, destPort) {
        var sharedInt32 = getSharedInt32();
        if (fd !== this.fd && this.loadSocketDataWithAutoBind(fd) !== 0) {
            console.error('[SocketProxyShared] Failed to auto-bind socket fd=' + fd);
            return -1;
        }

        if (this.socketDataIdx === -1 || sharedInt32[this.socketDataIdx] !== this.fd) {
            console.error('[SocketProxyShared] Invalid socket fd=' + fd);
            return -1;
        }
        
        if (!writePacket(
            intToWorkerRole(sharedInt32[this.socketDataIdx + 4]),
            destAddress,
            destPort,
            intToIp(sharedInt32[this.socketDataIdx + 3]),
            sharedInt32[this.socketDataIdx + 2],
            data,
            fd,
        )) {
            console.error('[SocketProxyShared] Failed to write packet to ring buffer');
            return -1;
        }
        
        // console.log('[SocketProxyShared] sendto: Packet written successfully');
        return data.length;
    },
    
    /**
     * Receive data from socket
     */
    recvfrom: function(fd, buffer, maxLen) {
        var sharedInt32 = getSharedInt32();
        if (fd !== this.fd && this.loadSocketDataWithAutoBind(fd, false) !== 0) {
            console.error('[SocketProxyShared] Failed to auto-bind socket fd=' + fd);
            return -1;
        }

        if (this.socketDataIdx === -1 || sharedInt32[this.socketDataIdx] !== this.fd) {
            console.error('[SocketProxyShared] Invalid socket fd=' + fd);
            return -1;
        }

        // Read packet from shared ring buffer
        return readPacket(intToWorkerRole(sharedInt32[this.socketDataIdx + 4]), buffer, maxLen, fd);
    },
    
    /**
     * Close socket
     */
    close: function(fd) {
        var sharedInt32 = getSharedInt32();
        console.log('[SocketProxyShared] Closing socket ' + fd);
        if (!acquireSocketManagementLock()) {
            console.error('[SocketProxyShared] Failed to acquire socket management lock');
            return -1;
        }

        try {
            if (this.socketDataIdx === -1 || sharedInt32[this.socketDataIdx] !== fd) {
                this.socketDataIdx = findSocketIdxByFd(fd);
                if (this.socketDataIdx === -1) {
                    console.error('[SocketProxyShared] close: Invalid socket fd=' + fd);
                    return -1;
                }
            }

            switch (intToWorkerRole(sharedInt32[this.socketDataIdx + 4])) {
                case 'client':
                    Atomics.store(sharedInt32, CLIENT_TO_SERVER_READ_IDX, 0);
                    Atomics.store(sharedInt32, CLIENT_TO_SERVER_WRITE_IDX, 0);
                    Atomics.store(sharedInt32, CLIENT_TO_EXTERNAL_READ_IDX, 0);
                    Atomics.store(sharedInt32, CLIENT_TO_EXTERNAL_WRITE_IDX, 0);
                    break;
                case 'server':
                    Atomics.store(sharedInt32, SERVER_TO_CLIENT_READ_IDX, 0);
                    Atomics.store(sharedInt32, SERVER_TO_CLIENT_WRITE_IDX, 0);
                    Atomics.store(sharedInt32, SERVER_TO_EXTERNAL_READ_IDX, 0);
                    Atomics.store(sharedInt32, SERVER_TO_EXTERNAL_WRITE_IDX, 0);
                    break;
                case 'external':
                    Atomics.store(sharedInt32, EXTERNAL_TO_CLIENT_READ_IDX, 0);
                    Atomics.store(sharedInt32, EXTERNAL_TO_CLIENT_WRITE_IDX, 0);
                    Atomics.store(sharedInt32, EXTERNAL_TO_SERVER_READ_IDX, 0);
                    Atomics.store(sharedInt32, EXTERNAL_TO_SERVER_WRITE_IDX, 0);
                    break;
                default:
                    console.warn('[SocketProxyShared] close: Invalid worker role "unknown", fd=' + fd)
                    break;
            }

            Atomics.store(sharedInt32, this.socketDataIdx, 0);
            Atomics.store(sharedInt32, this.socketDataIdx + 1, 0);
            Atomics.store(sharedInt32, this.socketDataIdx + 2, 0);
            Atomics.store(sharedInt32, this.socketDataIdx + 3, -1);
            Atomics.store(sharedInt32, this.socketDataIdx + 4, 0);
            
            this.fd = 0;
            this.bound = false;
            this.socketDataIdx = -1;
            return 0;
        } finally {
            releaseSocketManagementLock();
        }
    }
};

console.log('[SocketProxyShared] Thread-safe socket proxy initialized');