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

var NOOP_INT32 = new Int32Array(new SharedArrayBuffer(4)).fill(0);

var connectionBroadcastChannel = new BroadcastChannel('luanti-proxy-connection');

var WORKER_ROLE_UNKNOWN = 0;
var WORKER_ROLE_CLIENT = 1;
var WORKER_ROLE_SERVER = 2;
var WORKER_ROLE_EXTERNAL = 3;
var ADDRESS_NOT_SET = -1;
var PORT_NOT_SET = -1;

// Constants
var AF_INET = 2;
var AF_INET6 = 10;

// Shared memory layout
var SHARED_MEMORY_SIZE = 2 * 1024 * 1024; // 2MB
var TOTAL_RESERVED_SLOTS = 40;
var MAX_SOCKETS = 2; // client and server slots
var SOCKET_ENTRY_SIZE = 9; // 9 Int32s per socket entry

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

// [16-17]: Server info flags
var IS_SERVER_RUNNING_IDX = 16;
var IS_SERVER_PUBLIC_IDX = 17;

// [18-33]: Sockets
// [18]: socket management lock
var MANAGE_SOCKET_LOCK_IDX = 18; // 0 = unlocked, 1 = locked
// [19-36]: two slots for socket management data (client and server slots)
var SOCKET_DATA_ARRAY_IDX = 19;
// Socket entry layout (in Int32 units):
// [0]: fd (0 = not in use)
// [1]: bound (0/1)
// [2]: Port (0 = not set)
// [3]: Address family (AF_INET = 2, AF_INET6 = 10)
// [4-7]: Address
// [8]: worker role (0 = unknown, 1 = client, 2 = server) - external (=3) worker role is not used with socket entries
var SOCKET_DATA_FD_IDX = 0;
var SOCKET_DATA_BOUND_IDX = 1;
var SOCKET_DATA_PORT_IDX = 2;
var SOCKET_DATA_ADDRESS_FAMILY_IDX = 3;
var SOCKET_DATA_ADDRESS_IDX = 4;
var SOCKET_DATA_WORKER_ROLE_IDX = 8;

// [37-39]: reserved

// Packets
// Packet entry layout (in Int32 units):
// [0]: dest address family
// [1-4]: dest address
// [5]: dest port
// [6]: src address family
// [7-10]: src address
// [11]: src port
// [12]: data length
// [13-14]: packet creation time (milliseconds)
// [15-526]: packet data (up to 2048 bytes = 512 Int32s)
var PACKET_DATA_DEST_ADDRESS_FAMILY_IDX = 0;
var PACKET_DATA_DEST_ADDRESS_IDX = 1; // 4 Int32s
var PACKET_DATA_DEST_PORT_IDX = 5;
var PACKET_DATA_SRC_ADDRESS_FAMILY_IDX = 6;
var PACKET_DATA_SRC_ADDRESS_IDX = 7; // 4 Int32s
var PACKET_DATA_SRC_PORT_IDX = 11;
var PACKET_DATA_DATA_LENGTH_IDX = 12;
var PACKET_DATA_CREATION_TIME_IDX = 13; // 1 Float64
var PACKET_DATA_DATA_IDX = 15;

var MAX_PACKET_DATA_SIZE_UINT8 = 2048;
var MAX_PACKET_SIZE_INT32 = 527;

var TOTAL_BUFFER_SIZE_INT32 = (SHARED_MEMORY_SIZE / 4) - TOTAL_RESERVED_SLOTS;
var PER_SEGMENT_SIZE_PACKETS = Math.floor(Math.floor(TOTAL_BUFFER_SIZE_INT32 / 6) / MAX_PACKET_SIZE_INT32); // six segments
var PER_SEGMENT_SIZE_INT32 = PER_SEGMENT_SIZE_PACKETS * MAX_PACKET_SIZE_INT32;
var CLIENT_TO_SERVER_OFFSET = TOTAL_RESERVED_SLOTS;
var SERVER_TO_CLIENT_OFFSET = CLIENT_TO_SERVER_OFFSET + PER_SEGMENT_SIZE_INT32;
var EXTERNAL_TO_SERVER_OFFSET = SERVER_TO_CLIENT_OFFSET + PER_SEGMENT_SIZE_INT32;
var SERVER_TO_EXTERNAL_OFFSET = EXTERNAL_TO_SERVER_OFFSET + PER_SEGMENT_SIZE_INT32;
var EXTERNAL_TO_CLIENT_OFFSET = SERVER_TO_EXTERNAL_OFFSET + PER_SEGMENT_SIZE_INT32;
var CLIENT_TO_EXTERNAL_OFFSET = EXTERNAL_TO_CLIENT_OFFSET + PER_SEGMENT_SIZE_INT32;

// Use the shared buffer created in pre.js (on main thread before workers started)
// Note: We access this lazily because workers may load this file before the buffer is visible

/** @type {Int32Array} */
var sharedInt32 = null;
/** @type {Uint8Array} */
var sharedUint8 = null;
/** @type {DataView} */
var sharedDataView = null;

function initBuffer() {
    if (typeof self._luantiSocketSharedBuffer === 'undefined') {
        throw new Error('Shared socket buffer not initialized');
    }
    console.log('[SocketProxyShared] Using shared buffer from self (packets stored in SharedArrayBuffer ring buffer)');
    sharedInt32 = new Int32Array(self._luantiSocketSharedBuffer);
    sharedUint8= new Uint8Array(self._luantiSocketSharedBuffer);
    sharedDataView = new DataView(self._luantiSocketSharedBuffer);
}

/**
 * 
 * @param {Uint8Array} addr 
 * @returns {boolean} true if address is local, false otherwise
 */
function isAddressLocal(addr) {
    if (addr.length === 16) {
        for (var i = 0; i < 15; i++) {
            if (addr[i] !== 0) {
                return false;
            }
        }
        if (addr[15] === 1) {
            return true;
        }
    }
    else if (addr.length === 4) {
        if (addr[0] === 127 && addr[1] === 0 && addr[2] === 0 && addr[3] === 1) {
            return true;
        }
    }
    else {
        throw new Error('[SocketProxyShared] Invalid address length: ' + addr.length);
    }
    return false;
}

/**
 * Write packet to ring buffer
 * 
 * @param {number} workerRole - Worker role
 * @param {Uint8Array} destAddr - Destination address
 * @param {number} destPort - Destination port
 * @param {Uint8Array} srcAddr - Source address
 * @param {number} srcPort - Source port
 * @param {Uint8Array} data - Data to send
 * @returns {boolean} true on success, false on error
 */
function writePacket(workerRole, destAddr, destPort, srcAddr, srcPort, data) {
    var ringBufferOffset = 0;
    var writeIdxPos = 0;
    var readIdxPos = 0;
    var doorbellPos = 0;
    var addressLocal= isAddressLocal(destAddr);
    if (workerRole === WORKER_ROLE_CLIENT) {
        if (addressLocal) {
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
    } else if (workerRole === WORKER_ROLE_SERVER) {
        if (addressLocal) {
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
    } else if (workerRole === WORKER_ROLE_EXTERNAL) {
        if (Atomics.load(sharedInt32, IS_SERVER_RUNNING_IDX) === 1) {
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
    if (destAddr.length === 16) {
        sharedInt32[writeOffset + PACKET_DATA_DEST_ADDRESS_FAMILY_IDX] = AF_INET6;
        sharedUint8.set(destAddr, (writeOffset + PACKET_DATA_DEST_ADDRESS_IDX) * 4);
    }
    else if (destAddr.length === 4) {
        sharedInt32[writeOffset + PACKET_DATA_DEST_ADDRESS_FAMILY_IDX] = AF_INET;
        sharedUint8.set(destAddr, (writeOffset + PACKET_DATA_DEST_ADDRESS_IDX) * 4);
    }
    else {
        throw new Error('[SocketProxyShared] Invalid destination address length: ' + destAddr.length);
    }
    sharedInt32[writeOffset + PACKET_DATA_DEST_PORT_IDX] = destPort;
    if (srcAddr.length === 16) {
        sharedInt32[writeOffset + PACKET_DATA_SRC_ADDRESS_FAMILY_IDX] = AF_INET6;
        sharedUint8.set(srcAddr, (writeOffset + PACKET_DATA_SRC_ADDRESS_IDX) * 4);
    }
    else if (srcAddr.length === 4) {
        sharedInt32[writeOffset + PACKET_DATA_SRC_ADDRESS_FAMILY_IDX] = AF_INET;
        sharedUint8.set(srcAddr, (writeOffset + PACKET_DATA_SRC_ADDRESS_IDX) * 4);
    }
    else {
        throw new Error('[SocketProxyShared] Invalid source address length: ' + srcAddr.length);
    }
    sharedInt32[writeOffset + PACKET_DATA_SRC_PORT_IDX] = srcPort;
    sharedInt32[writeOffset + PACKET_DATA_DATA_LENGTH_IDX] = data.length;
    sharedDataView.setFloat64((writeOffset + PACKET_DATA_CREATION_TIME_IDX) * 4, Date.now(), true); // 8 bytes per Float64
    sharedUint8.set(data, (writeOffset + PACKET_DATA_DATA_IDX) * 4); // 4 bytes per Int32

    // console.log('[SocketProxyShared] writePacket: wrote packet to ring buffer, destAddr=' + destAddr.join(',') + ', writeOffset=' + writeOffset + ', data.length=' + data.length + ' (Worker Role: ' + workerRole + ')');

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

/**
 * Read packet from ring buffer for specific address:port
 * 
 * @param {number} workerRole - Worker role
 * @param {Uint8Array} buffer - Buffer to read data into
 * @param {number} maxLen - Maximum length of data to read
 * @param {number} readerFamily - Reader address family (AF_INET = 2, AF_INET6 = 10)
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {{length: number, address: Uint8Array, family: number, port: number} | null} Data read from packet or null if no packet found
 */
function readPacket(workerRole, buffer, maxLen, readerFamily, timeoutMs) {
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
    
    if (workerRole === WORKER_ROLE_CLIENT) {
        READ_IDX_1 = SERVER_TO_CLIENT_READ_IDX;
        READ_IDX_2 = EXTERNAL_TO_CLIENT_READ_IDX;
        WRITE_IDX_1 = SERVER_TO_CLIENT_WRITE_IDX;
        WRITE_IDX_2 = EXTERNAL_TO_CLIENT_WRITE_IDX;
        OFFSET_1 = SERVER_TO_CLIENT_OFFSET;
        OFFSET_2 = EXTERNAL_TO_CLIENT_OFFSET;
        DOORBELL_POS = DOORBELL_CLIENT_IDX;
    } else if (workerRole === WORKER_ROLE_SERVER) {
        READ_IDX_1 = CLIENT_TO_SERVER_READ_IDX;
        READ_IDX_2 = EXTERNAL_TO_SERVER_READ_IDX;
        WRITE_IDX_1 = CLIENT_TO_SERVER_WRITE_IDX;
        WRITE_IDX_2 = EXTERNAL_TO_SERVER_WRITE_IDX;
        OFFSET_1 = CLIENT_TO_SERVER_OFFSET;
        OFFSET_2 = EXTERNAL_TO_SERVER_OFFSET;
        DOORBELL_POS = DOORBELL_SERVER_IDX;
    } else if (workerRole === WORKER_ROLE_EXTERNAL) {
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
            creationTime1 = sharedDataView.getFloat64((readOffset + PACKET_DATA_CREATION_TIME_IDX) * 4, true);
        }
        if (readPos2 !== writePos2) {
            var readOffset = OFFSET_2 + readPos2;
            creationTime2 = sharedDataView.getFloat64((readOffset + PACKET_DATA_CREATION_TIME_IDX) * 4, true);
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
            // console.log('[SocketProxyShared] readPacket: no packet found (Worker Role: ' + workerRole + ')');
            if (!waited && timeoutMs > 0) {
                var result = Atomics.wait(sharedInt32, DOORBELL_POS, 0, timeoutMs);
                if (result === 'timed-out') {
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
    var srcAddrFamily = sharedInt32[readOffset + PACKET_DATA_SRC_ADDRESS_FAMILY_IDX];
    var srcAddr;
    var addrOffsetBytes = (readOffset + PACKET_DATA_SRC_ADDRESS_IDX) * 4;
    // For local address, convert to reader family if needed
    if (srcAddrFamily === AF_INET6) {
        var srcAddrBytes = sharedUint8.subarray(addrOffsetBytes, addrOffsetBytes + 16);
        if (readerFamily === AF_INET) {
            if (isAddressLocal(srcAddrBytes)) {
                srcAddrFamily = AF_INET;
                srcAddrBytes = new Uint8Array([127, 0, 0, 1]);
            }
            else {
                throw new Error('[SocketProxyShared] Invalid source address and family mismatch: ' + srcAddrBytes.join(','));
            }
        }
        srcAddr = new Uint8Array(srcAddrBytes);
    }
    else if (srcAddrFamily === AF_INET) {
        var srcAddrBytes = sharedUint8.subarray(addrOffsetBytes, addrOffsetBytes + 4);
        if (readerFamily === AF_INET6) {
            if (isAddressLocal(srcAddrBytes)) {
                srcAddrFamily = AF_INET6;
                srcAddrBytes = new Uint8Array(16).fill(0);
                srcAddrBytes[15] = 1;
            }
            else {
                throw new Error('[SocketProxyShared] Invalid source address and family mismatch: ' + srcAddrBytes.join(','));
            }
        }
        srcAddr = new Uint8Array(srcAddrBytes);
    }
    else {
        throw new Error('[SocketProxyShared] Invalid source address family: ' + srcAddrFamily);
    }
    var srcPort = sharedInt32[readOffset + PACKET_DATA_SRC_PORT_IDX];
    var dataLen = sharedInt32[readOffset + PACKET_DATA_DATA_LENGTH_IDX];
    
    // Read packet data
    var copyLen = Math.min(dataLen, maxLen);
    var dataOffsetBytes = (readOffset + PACKET_DATA_DATA_IDX) * 4;
    buffer.set(sharedUint8.subarray(dataOffsetBytes, dataOffsetBytes + copyLen));

    // Advance read index
    var newReadIdx = (readPos + MAX_PACKET_SIZE_INT32) % PER_SEGMENT_SIZE_INT32;
    Atomics.store(sharedInt32, readIdxPos, newReadIdx);
    
    return {
        length: copyLen,
        address: srcAddr,
        family: srcAddrFamily,
        port: srcPort
    };
}

/**
 * Acquire socket management lock
 * 
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {boolean} true on success, false on timeout
 */
function acquireSocketManagementLock(timeoutMs = 200) {
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

/**
 * Release socket management lock
 * 
 * @returns {boolean} true on success, false on error
 */
function releaseSocketManagementLock() {
    var oldValue = Atomics.compareExchange(sharedInt32, MANAGE_SOCKET_LOCK_IDX, 1, 0);
    if (oldValue === 1) {
        Atomics.notify(sharedInt32, MANAGE_SOCKET_LOCK_IDX, 1);
        return true;
    }
    throw new Error('[SocketProxyShared] Failed to release socket management lock, expected 1, got ' + oldValue);
}

/**
 * Find socket data index by file descriptor
 * 
 * @param {number} fd - File descriptor
 * @returns {number} Socket data index
 */
function findSocketIdxByFd(fd) {
    for (var i = 0; i < MAX_SOCKETS; i++) {
        var testIdx = SOCKET_DATA_ARRAY_IDX + (i * SOCKET_ENTRY_SIZE);
        var foundFd = Atomics.load(sharedInt32, testIdx);
        if (foundFd === fd) {
            return testIdx;
        }
    }
    return -1;
}

/**
 * Get socket address from socket data index
 * 
 * @param {number} socketDataIdx - Socket data index
 * @returns {{address: Uint8Array, family: number}} Socket address and family
 */
function getSocketAddress(socketDataIdx) {
    var addrFamily = sharedInt32[socketDataIdx + SOCKET_DATA_ADDRESS_FAMILY_IDX];
    var addr;
    if (addrFamily === AF_INET6) {
        addr = new Uint8Array(sharedUint8.subarray(
            (socketDataIdx + SOCKET_DATA_ADDRESS_IDX) * 4,
            (socketDataIdx + SOCKET_DATA_ADDRESS_IDX + 4) * 4));
    }
    else if (addrFamily === AF_INET) {
        addr = new Uint8Array(sharedUint8.subarray(
            (socketDataIdx + SOCKET_DATA_ADDRESS_IDX) * 4,
            (socketDataIdx + SOCKET_DATA_ADDRESS_IDX + 1) * 4));
    }
    else {
        throw new Error('[SocketProxyShared] Invalid source address family: ' + addrFamily);
    }
    return {
        address: addr,
        family: addrFamily
    };
}

/**
 * Set socket address in socket data index
 * 
 * @param {number} socketDataIdx - Socket data index
 * @param {Uint8Array} address - Socket address
 */
function setSocketAddress(socketDataIdx, address) {
    var addressFamily = sharedInt32[socketDataIdx + SOCKET_DATA_ADDRESS_FAMILY_IDX];
    if (addressFamily === AF_INET6 && address.length !== 16) {
        throw new Error('[SocketProxyShared] Invalid IPv6 address bytes length: ' + address.length);
    }
    else if (addressFamily === AF_INET && address.length !== 4) {
        throw new Error('[SocketProxyShared] Invalid IPv4 address bytes length: ' + address.length);
    }
    else if (addressFamily !== AF_INET && addressFamily !== AF_INET6) {
        throw new Error('[SocketProxyShared] Invalid address family: ' + addressFamily);
    }
    sharedUint8.set(address, (socketDataIdx + SOCKET_DATA_ADDRESS_IDX) * 4);
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
     * 
     * @param {number} domain - Address family (AF_INET = 2, AF_INET6 = 10)
     * @param {number} type - Socket type (SOCK_DGRAM = 2)
     * @param {number} protocol - Protocol (IPPROTO_UDP = 17)
     * @returns {number} Socket file descriptor on success, -1 on error
     */
    socket: function(domain, type, protocol) {
        if (sharedInt32 === null) {
            initBuffer();
        }
        if (type !== 2) { // Only support UDP sockets for now
            console.error('[SocketProxyShared] Only UDP supported');
            return -1;
        }
        if (protocol !== 17) { // IPPROTO_UDP
            console.error('[SocketProxyShared] Only IPPROTO_UDP supported');
            return -1;
        }
        if (domain !== AF_INET && domain !== AF_INET6) {
            console.error('[SocketProxyShared] Invalid domain: ' + domain);
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
            Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_FD_IDX, newFd);
            Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_BOUND_IDX, 0); // not bound
            Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_PORT_IDX, PORT_NOT_SET); // Port not set
            Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_ADDRESS_IDX, ADDRESS_NOT_SET); // Address not set
            Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_ADDRESS_FAMILY_IDX, domain); // address family
            Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_WORKER_ROLE_IDX, WORKER_ROLE_UNKNOWN); // worker role unknown
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
     * 
     * @param {number} fd - Socket file descriptor
     * @param {Uint8Array} addr_data - Address data (Uint8Array)
     * @param {number} family - Address family (AF_INET = 2, AF_INET6 = 10)
     * @param {number} port - Port (number)
     * @returns {number} 0 on success, -1 on error
     */
    bind: function(fd, addr_data, family, port = 0) {
        if (sharedInt32 === null) {
            initBuffer();
        }
        if (fd === 0) {
            throw new Error('[SocketProxyShared] bind: Invalid socket fd=0');
        }
        if (!acquireSocketManagementLock()) {
            console.error('[SocketProxyShared] Failed to acquire socket management lock');
            return -1;
        }

        try {
            console.log('[SocketProxyShared] bind() called: fd=' + fd + ', address=' + addr_data.join(',') + ', port=' + port);

            if (port < 0 || port > 65535) {
                console.error('[SocketProxyShared] Invalid port: ' + port);
                return -1;
            }

            this.socketDataIdx = findSocketIdxByFd(fd);
            if (this.socketDataIdx === -1) {
                console.error('[SocketProxyShared] Invalid socket fd=' + fd);
                return -1;
            }
            var currentFamily = sharedInt32[this.socketDataIdx + SOCKET_DATA_ADDRESS_FAMILY_IDX];
            if (family !== currentFamily) {
                console.error('[SocketProxyShared] Cannot bind to different address family: ' + family + ' (current family: ' + currentFamily + ')');
                return -1;
            }

            var wasBound = Atomics.compareExchange(sharedInt32, this.socketDataIdx + SOCKET_DATA_BOUND_IDX, 0, 1);
            if (wasBound !== 0) {
                console.error('[SocketProxyShared] bind: Socket already bound');
                return -1;
            }
            
            var addressIsZero = addr_data.every(value => value === 0);
            if (port === 0) {
                // Port 0 means "assign any available port" for client workers - allocate an ephemeral port
                Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_WORKER_ROLE_IDX, WORKER_ROLE_CLIENT);
                port = this.randomPort(); // Use random ephemeral port
                console.log('[SocketProxyShared] Port 0 requested, assigning ephemeral port ' + port);
            }
            else {
                // Port is not 0, so it's a server worker
                Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_WORKER_ROLE_IDX, WORKER_ROLE_SERVER);
                Atomics.store(sharedInt32, IS_SERVER_RUNNING_IDX, 1);
                if (addressIsZero) {
                    // Address is all 0s, so the server wants to listen publicly
                    console.log('[SocketProxyShared] Server wants to listen publicly');
                    Atomics.store(sharedInt32, IS_SERVER_PUBLIC_IDX, 1);
                    connectionBroadcastChannel.postMessage({
                        type: 'host-server'
                    });
                }
            }
            if (addressIsZero) {
                // Normalize address to local address
                if (family === AF_INET6) {
                    addr_data = new Uint8Array(16).fill(0);
                    addr_data[15] = 1;
                }
                else if (family === AF_INET) {
                    addr_data = new Uint8Array([127, 0, 0, 1]);
                }
            }

            setSocketAddress(this.socketDataIdx, addr_data);
            Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_PORT_IDX, port);

            this.fd = fd;
            this.bound = true;
            
            return 0;

        } finally {
            releaseSocketManagementLock();
        }
    },

    loadSocketDataWithAutoBind: function(fd, autoBind = true) {
        if (sharedInt32 === null) {
            initBuffer();
        }
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
            var workerRole = sharedInt32[this.socketDataIdx + SOCKET_DATA_WORKER_ROLE_IDX];
            var {address, family} = getSocketAddress(this.socketDataIdx);
            var port = sharedInt32[this.socketDataIdx + SOCKET_DATA_PORT_IDX];
            var bound = sharedInt32[this.socketDataIdx + SOCKET_DATA_BOUND_IDX] === 1;
            if (!bound && autoBind) {
                // Auto-bind if not already bound
                bound = true;
                Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_BOUND_IDX, 1);
            }
            var addressIsUnset = true;
            for (var i = 0; i < 4; i++) {
                addressIsUnset = addressIsUnset && address[i] === 0xFF;
            }
            if (addressIsUnset) {
                if (family === AF_INET) {
                    address = new Uint8Array([127, 0, 0, 1]);
                }
                else if (family === AF_INET6) {
                    address = new Uint8Array(16).fill(0);
                    address[15] = 1;
                }
                setSocketAddress(this.socketDataIdx, address);
                console.log('[SocketProxyShared] loadSocketDataWithAutoBind: set address to ' + address.join(','));
            }
            if (port === 0) {
                port = this.randomPort();
                Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_PORT_IDX, port);
            }
            if (workerRole === WORKER_ROLE_UNKNOWN && autoBind) {
                Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_WORKER_ROLE_IDX, WORKER_ROLE_CLIENT);
            }

            this.bound = bound;

        } finally {
            releaseSocketManagementLock();
        }

        return 0;
    },

    /**
     * Send data to address
     * 
     * @param {number} fd - Socket file descriptor
     * @param {Uint8Array} data - Data to send
     * @param {Uint8Array} destAddress - Destination address
     * @param {number} destPort - Destination port
     * @returns {number} 0 on success, -1 on error
     */
    sendto: function(fd, data, destAddress, destPort) {
        if (fd !== this.fd && this.loadSocketDataWithAutoBind(fd) !== 0) {
            console.error('[SocketProxyShared] Failed to auto-bind socket fd=' + fd);
            return -1;
        }

        if (this.socketDataIdx === -1 || sharedInt32[this.socketDataIdx] !== this.fd) {
            console.error('[SocketProxyShared] Invalid socket fd=' + fd);
            return -1;
        }
        
        var {address, family} = getSocketAddress(this.socketDataIdx);
        if (family === AF_INET6 && destAddress.length !== 16) {
            console.error('[SocketProxyShared] Invalid IPv6 destination address length: ' + destAddress.length);
            return -1;
        }
        else if (family === AF_INET && destAddress.length !== 4) {
            console.error('[SocketProxyShared] Invalid IPv4 destination address length: ' + destAddress.length);
            return -1;
        }
        var srcPort = sharedInt32[this.socketDataIdx + SOCKET_DATA_PORT_IDX];
        if (!writePacket(
            sharedInt32[this.socketDataIdx + SOCKET_DATA_WORKER_ROLE_IDX],
            destAddress,
            destPort,
            address,
            srcPort,
            data,
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
    recvfrom: function(fd, buffer, maxLen, timeoutMs = 0) {
        if (fd !== this.fd && this.loadSocketDataWithAutoBind(fd, false) !== 0) {
            console.error('[SocketProxyShared] Failed to auto-bind socket fd=' + fd);
            return null;
        }

        if (this.socketDataIdx === -1 || sharedInt32[this.socketDataIdx] !== this.fd) {
            console.error('[SocketProxyShared] Invalid socket fd=' + fd);
            return null;
        }

        var workerRole = Atomics.load(sharedInt32, this.socketDataIdx + SOCKET_DATA_WORKER_ROLE_IDX);
        if (workerRole === WORKER_ROLE_UNKNOWN) {
            // If worker role is still unknown, wait in increments of 5ms to avoid busy-waiting
            var startTime = Date.now();
            while (true) {
                Atomics.wait(NOOP_INT32, 0, 0, 5);
                workerRole = Atomics.load(sharedInt32, this.socketDataIdx + SOCKET_DATA_WORKER_ROLE_IDX);
                if (workerRole !== WORKER_ROLE_UNKNOWN) {
                    timeoutMs = Math.max(0, timeoutMs - (Date.now() - startTime));
                    break;
                }
                if (Date.now() - startTime >= timeoutMs) {
                    return null;
                }
            }
        }
        var family = sharedInt32[this.socketDataIdx + SOCKET_DATA_ADDRESS_FAMILY_IDX];

        // Read packet from shared ring buffer
        return readPacket(workerRole, buffer, maxLen, family, timeoutMs);
    },
    
    /**
     * Close socket
     */
    close: function(fd) {
        if (sharedInt32 === null) {
            initBuffer();
        }
        console.log('[SocketProxyShared] close() called: fd=' + fd);
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

            switch (sharedInt32[this.socketDataIdx + SOCKET_DATA_WORKER_ROLE_IDX]) {
                case WORKER_ROLE_CLIENT:
                    Atomics.store(sharedInt32, CLIENT_TO_SERVER_READ_IDX, 0);
                    Atomics.store(sharedInt32, CLIENT_TO_SERVER_WRITE_IDX, 0);
                    Atomics.store(sharedInt32, CLIENT_TO_EXTERNAL_READ_IDX, 0);
                    Atomics.store(sharedInt32, CLIENT_TO_EXTERNAL_WRITE_IDX, 0);
                    break;
                case WORKER_ROLE_SERVER:
                    Atomics.store(sharedInt32, SERVER_TO_CLIENT_READ_IDX, 0);
                    Atomics.store(sharedInt32, SERVER_TO_CLIENT_WRITE_IDX, 0);
                    Atomics.store(sharedInt32, SERVER_TO_EXTERNAL_READ_IDX, 0);
                    Atomics.store(sharedInt32, SERVER_TO_EXTERNAL_WRITE_IDX, 0);
                    Atomics.store(sharedInt32, IS_SERVER_PUBLIC_IDX, 0);
                    Atomics.store(sharedInt32, IS_SERVER_RUNNING_IDX, 0);
                    break;
                case WORKER_ROLE_EXTERNAL:
                    Atomics.store(sharedInt32, EXTERNAL_TO_CLIENT_READ_IDX, 0);
                    Atomics.store(sharedInt32, EXTERNAL_TO_CLIENT_WRITE_IDX, 0);
                    Atomics.store(sharedInt32, EXTERNAL_TO_SERVER_READ_IDX, 0);
                    Atomics.store(sharedInt32, EXTERNAL_TO_SERVER_WRITE_IDX, 0);
                    break;
                default:
                    console.warn('[SocketProxyShared] close: Invalid worker role "unknown", fd=' + fd)
                    break;
            }

            Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_FD_IDX, 0);
            Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_BOUND_IDX, 0);
            Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_PORT_IDX, PORT_NOT_SET);
            Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_ADDRESS_IDX, ADDRESS_NOT_SET);
            Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_ADDRESS_FAMILY_IDX, 0);
            Atomics.store(sharedInt32, this.socketDataIdx + SOCKET_DATA_WORKER_ROLE_IDX, WORKER_ROLE_UNKNOWN);
            
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