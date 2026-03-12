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

// ===== CONSTANTS =====
// Worker roles
const WORKER_ROLE_UNKNOWN = 0;
const WORKER_ROLE_CLIENT = 1;
const WORKER_ROLE_SERVER = 2;
const WORKER_ROLE_EXTERNAL = 3;
// IP address families
const AF_INET = 2;
const AF_INET6 = 10;

// ===== MEMORY LAYOUT =====
// All memory layout numbers are provided in bytes

// Shared memory size
const SHARED_MEMORY_SIZE = 8 * 1024 * 1024;

// Cache line size is 64 bytes
const CACHE_LINE_SIZE = 64;
const GLOBAL_METADATA_SIZE = 256;

// reader memory (cache line 0)
const READ_IDX_PRIO_0 = 0;
const READ_IDX_PRIO_1 = 4;
const READ_IDX_PRIO_2 = 8;
// read lock
const READ_LOCK_IDX = 12;

// writer memory (cache line 1)
const WRITE_IDX_PRIO_0 = 64;
const WRITE_IDX_PRIO_1 = 68;
const WRITE_IDX_PRIO_2 = 72;
// write lock
const WRITE_LOCK_IDX = 76;
// doorbell memory (in writer cache line)
const DOORBELL_IDX = 80;

// Metadata size per segment, reserved for READ_IDXs, WRITE_IDXs, LOCKS and DOORBELL_IDX
const SEGMENT_METADATA_SIZE = CACHE_LINE_SIZE * 2;

// ===== PACKET BUFFER =====
// Per packet: 512 bytes of payload data + 64 bytes reserved for packet metadata
const PACKET_SLOT_SIZE = 512 + 64;

// ===== SEGMENT SIZES =====
// There are 3 segments in the shared memory buffer, each with 2 prio buffers.
// Each prio buffer contains prioritized packets for each priority level.

const _NUM_SEGMENTS = 3;
const _NUM_PRIO_BUFFERS = 3;
// Reserve 256 bytes for globals, and (3 * SEGMENT_METADATA_SIZE) for per-segment metadata
const _MAX_BYTES_ALL_SEGMENTS = SHARED_MEMORY_SIZE - GLOBAL_METADATA_SIZE;
// Calculate max bytes per segment (for 3 segments)
const _MAX_BYTES_PER_SEGMENT = Math.floor(_MAX_BYTES_ALL_SEGMENTS / _NUM_SEGMENTS);
// Calculate max bytes per prio buffer (for 3 prio buffers per segment)
const _MAX_BYTES_PER_PRIO_BUFFER = Math.floor((_MAX_BYTES_PER_SEGMENT - SEGMENT_METADATA_SIZE) / _NUM_PRIO_BUFFERS);
// Calculate number of packets per prio buffer (3 prio buffers per segment).
// Prio buffers contain prioritized packets for each priority level.
const PACKETS_PER_PRIO_BUFFER = Math.floor(_MAX_BYTES_PER_PRIO_BUFFER / PACKET_SLOT_SIZE);
// Calculate segment bytes size
const PRIO_BUFFER_SIZE = PACKETS_PER_PRIO_BUFFER * PACKET_SLOT_SIZE;
const SEGMENT_SIZE = (PRIO_BUFFER_SIZE * _NUM_PRIO_BUFFERS) + SEGMENT_METADATA_SIZE;

// ===== PRIO BUFFERS =====
// packet data memory: 3 prio buffers per segment
const DATA_OFFSET_PRIO_0 = SEGMENT_METADATA_SIZE;
const DATA_OFFSET_PRIO_1 = DATA_OFFSET_PRIO_0 + PRIO_BUFFER_SIZE;
const DATA_OFFSET_PRIO_2 = DATA_OFFSET_PRIO_1 + PRIO_BUFFER_SIZE;

// ===== PACKET MEMORY LAYOUT =====
// Packet entry layout (in bytes offsets):
const PACKET_DEST_ADDR_IDX = 0; // 16 bytes [0-15]
const PACKET_SRC_ADDR_IDX = 16; // 16 bytes [16-31]
const PACKET_BUFFERED_TIME_IDX = 32; // 8 bytes [32-39]
const PACKET_DEST_PORT_IDX = 40; // 2 bytes [40-41]
const PACKET_SRC_PORT_IDX = 42; // 2 bytes [42-43]
const PACKET_PAYLOAD_LENGTH_IDX = 44; // 2 bytes [44-45]
const PACKET_DEST_ADDR_FAMILY_IDX = 46; // 1 byte [46]
const PACKET_SRC_ADDR_FAMILY_IDX = 47; // 1 byte [47]

const PACKET_PAYLOAD_IDX = 64; // up to 512 bytes [64-..]

// ===== PACKET PRIORITY CLASSIFICATION =====
// Priority 0 (highest): ACKs, position updates, movement - latency critical
// Priority 1 (medium): Interactive packets - inventory, mining, chat, HUD
// Priority 2 (lowest): Bulk data - map chunks, media, definitions

const PACKET_DEBUG_LOG = false;

// Transport layer packet types (byte offset 7 after base header)
const PACKET_TYPE_CONTROL = 0;
const PACKET_TYPE_ORIGINAL = 1;
const PACKET_TYPE_SPLIT = 2;
const PACKET_TYPE_RELIABLE = 3;

/*
Base packet (all packet types have this header):
[0-3] protocol_id = 0x4f457403 (u32)
[4-5] sender_peer_id = 0 (u16)
[6] channel (u8)
[7] packet_type (u8): 0=CONTROL, 1=ORIGINAL, 2=SPLIT, 3=RELIABLE

Control packet (packet_type = 0):
[8] control_type (u8) 0=ACK, 1=SET_PEER_ID, 2=PING, 3=DISCO
(control_type == ACK) => [9-10] seqnum (u16)
(control_type == SET_PEER_ID) => [9-10] peer_id_new (u16)
(control_type == PING) => no payload
(control_type == DISCO) => no payload

Original packet (packet_type = 1):
(end of header)

Split packet (packet_type = 2):
[8-9] seqnum (u16)
[10-11] chunk_count (u16)
[12-13] chunk_num (u16)
[14+] data

Reliable packet (packet_type = 3):
[8-9] seqnum (u16)
*/

function logPacketDebug(payload) {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const chunks = [
        'P=' + view.getUint16(4, false).toString(16),
        'CH=' + view.getUint8(6).toString(16),
    ];

    let startByteLog = 0;
    if (payload[7] === PACKET_TYPE_CONTROL) {
        chunks.push('CONTROL');
        chunks.push('CT=' + view.getUint8(8).toString(16) + ' | ');
        startByteLog = 9;
    } else if (payload[7] === PACKET_TYPE_ORIGINAL) {
        chunks.push('ORIGINAL' + ' | ');
        startByteLog = 8;
    } else if (payload[7] === PACKET_TYPE_SPLIT) {
        chunks.push('SPLIT');
        chunks.push('SEQ=' + view.getUint16(8, false).toString(16));
        chunks.push('CHC=' + view.getUint16(10, false).toString(16));
        chunks.push('CHN=' + view.getUint16(12, false).toString(16) + ' | ');
        startByteLog = 14;
    } else if (payload[7] === PACKET_TYPE_RELIABLE) {
        chunks.push('RELIABLE');
        chunks.push('SEQ=' + view.getUint16(8, false).toString(16) + ' | ');
        startByteLog = 10;
    }
    for (let i = startByteLog; i < Math.min(startByteLog + 8, payload.length); i++) {
        const num = payload[i];
        chunks.push(num < 16 ? '0' + num.toString(16) : num.toString(16));
    }
    if (payload.length >= startByteLog + 8) {
        chunks.push('...');
    }
    chunks.push('L=' + payload.length);
    console.log('[PACKET DEBUG] ' + chunks.join(' '));
}

class SharedPacketBuffer {
    constructor(buffer, offset) {
        if (!(buffer instanceof SharedArrayBuffer)) {
            throw new Error('Buffer must be a SharedArrayBuffer');
        }
        /** @type {Uint8Array<SharedArrayBuffer>} */
        this.u8 = new Uint8Array(buffer, offset, SEGMENT_SIZE);
        /** @type {Uint16Array<SharedArrayBuffer>} */
        this.u16 = new Uint16Array(buffer, offset, SEGMENT_SIZE >> 1);
        /** @type {Int32Array<SharedArrayBuffer>} */
        this.i32 = new Int32Array(buffer, offset, SEGMENT_SIZE >> 2);
        /** @type {DataView<SharedArrayBuffer>} */
        this.dv = new DataView(buffer, offset, SEGMENT_SIZE);
    }

    /**
     * Write packet to ring buffer
     * @param {Uint8Array} destAddr - Destination address
     * @param {number} destPort - Destination port
     * @param {Uint8Array} srcAddr - Source address
     * @param {number} srcPort - Source port
     * @param {Uint8Array} payload - Payload to send
     * @returns {boolean} true on success, false on error
     */
    writePacket(destAddr, destPort, srcAddr, srcPort, payload) {
        const u8 = this.u8;
        const u16 = this.u16;
        const i32 = this.i32;
        const dv = this.dv;
        const now = Date.now();

        // Get address families
        let destAddrFamily = AF_INET;
        let srcAddrFamily = AF_INET;
        if (destAddr.length === 16) {
            destAddrFamily = AF_INET6;
        } else if (destAddr.length !== 4) {
            throw new Error('Invalid destination address length: ' + destAddr.length);
        }
        if (srcAddr.length === 16) {
            srcAddrFamily = AF_INET6;
        } else if (srcAddr.length !== 4) {
            throw new Error('Invalid source address length: ' + srcAddr.length);
        }

        // Define variables
        let i = 0;
        /** @type {0 | 1 | 2} */
        let prio = 0;
        let readIdx = 0;
        let writeIdx = 0;
        let dataOffset = 0;

        // Just decide prio based on channel for now, otherwise we risk re-ordering packets within a channel.
        prio = payload[6];
        if (prio > 2) {
            prio = 2;
        }

        // Acquire write lock
        while (Atomics.compareExchange(i32, WRITE_LOCK_IDX >> 2, 0, 1) !== 0) {
            i++;
            if (i > 1000) {
                console.error('Failed to acquire write lock');
                return false;
            }
            Atomics.pause();
        }

        // Get the read and write indices for the priority buffer
        if (prio === 0) {
            readIdx = Atomics.load(i32, READ_IDX_PRIO_0 >> 2);
            writeIdx = Atomics.load(i32, WRITE_IDX_PRIO_0 >> 2);
            dataOffset = DATA_OFFSET_PRIO_0;
        } else if (prio === 1) {
            readIdx = Atomics.load(i32, READ_IDX_PRIO_1 >> 2);
            writeIdx = Atomics.load(i32, WRITE_IDX_PRIO_1 >> 2);
            dataOffset = DATA_OFFSET_PRIO_1;
        } else {
            readIdx = Atomics.load(i32, READ_IDX_PRIO_2 >> 2);
            writeIdx = Atomics.load(i32, WRITE_IDX_PRIO_2 >> 2);
            dataOffset = DATA_OFFSET_PRIO_2;
        }
        
        const writeOffset = dataOffset + (writeIdx * PACKET_SLOT_SIZE);

        // Write packet data
        u8.set(destAddr, writeOffset + PACKET_DEST_ADDR_IDX);
        u8.set(srcAddr, writeOffset + PACKET_SRC_ADDR_IDX);
        u8[writeOffset + PACKET_DEST_ADDR_FAMILY_IDX] = destAddrFamily;
        u8[writeOffset + PACKET_SRC_ADDR_FAMILY_IDX] = srcAddrFamily;
        u16[(writeOffset + PACKET_DEST_PORT_IDX) >> 1] = destPort;
        u16[(writeOffset + PACKET_SRC_PORT_IDX) >> 1] = srcPort;
        u16[(writeOffset + PACKET_PAYLOAD_LENGTH_IDX) >> 1] = payload.length;
        dv.setFloat64(writeOffset + PACKET_BUFFERED_TIME_IDX, now, true);
        u8.set(payload, writeOffset + PACKET_PAYLOAD_IDX);

        // Update write index
        writeIdx = (writeIdx + 1) % PACKETS_PER_PRIO_BUFFER;
        if (writeIdx === readIdx) {
            console.warn('Packet buffer full, dropping packet');
            // Release write lock
            Atomics.store(i32, WRITE_LOCK_IDX >> 2, 0);
            return false;
        }
        if (prio === 0) {
            Atomics.store(i32, WRITE_IDX_PRIO_0 >> 2, writeIdx);
        } else if (prio === 1) {
            Atomics.store(i32, WRITE_IDX_PRIO_1 >> 2, writeIdx);
        } else {
            Atomics.store(i32, WRITE_IDX_PRIO_2 >> 2, writeIdx);
        }
        // Release write lock
        Atomics.store(i32, WRITE_LOCK_IDX >> 2, 0);

        // Notify waiting readers
        Atomics.add(i32, DOORBELL_IDX >> 2, 1);
        Atomics.notify(i32, DOORBELL_IDX >> 2, 1);

        return true;
    }

    /**
     * Read packet from ring buffer for specific address:port
     * 
     * @param {Uint8Array} dataBuffer - Buffer to read data into
     * @param {Uint8Array} destAddressBuffer - Buffer to read destination address into
     * @param {Uint8Array} srcAddressBuffer - Buffer to read source address into
     * @param {number} maxLen - Maximum length of data to read
     * @param {number} timeoutMs - Timeout in milliseconds
     * @returns {{length: number, srcFamily: number, srcPort: number, destFamily: number, destPort: number} | null} Data read from packet or null if no packet found
     */
    readPacket(dataBuffer, destAddressBuffer, srcAddressBuffer, maxLen, timeoutMs) {
        const u8 = this.u8;
        const u16 = this.u16;
        const i32 = this.i32;
        const dv = this.dv;

        // Get the read index for the priority buffer
        let i = 0;
        let waited = false;
        let readIdx = 0;
        let writeIdx = 0;
        let dataOffset = 0;
        let prio = 0;

        // Acquire read lock
        while (Atomics.compareExchange(i32, READ_LOCK_IDX >> 2, 0, 1) !== 0) {
            i++;
            if (i > 1000) {
                console.error('Failed to acquire read lock');
                return null;
            }
            Atomics.pause();
        }

        while (true) {
            const doorbellCounter = Atomics.load(i32, DOORBELL_IDX >> 2);
            readIdx = Atomics.load(i32, READ_IDX_PRIO_0 >> 2);
            writeIdx = Atomics.load(i32, WRITE_IDX_PRIO_0 >> 2);
            if (readIdx === writeIdx) {
                // No packet available in prio_0, try prio_1
                readIdx = Atomics.load(i32, READ_IDX_PRIO_1 >> 2);
                writeIdx = Atomics.load(i32, WRITE_IDX_PRIO_1 >> 2);
                if (readIdx === writeIdx) {
                    // No packet available in prio_1, try prio_2
                    readIdx = Atomics.load(i32, READ_IDX_PRIO_2 >> 2);
                    writeIdx = Atomics.load(i32, WRITE_IDX_PRIO_2 >> 2);
                    if (readIdx === writeIdx) {
                        // No packet available in any priority buffer, wait for a packet if timeout is set
                        if (!waited && timeoutMs > 0) {
                            const waitResult = Atomics.wait(i32, DOORBELL_IDX >> 2, doorbellCounter, timeoutMs);
                            if (waitResult === 'timed-out') {
                                // Release read lock
                                Atomics.store(i32, READ_LOCK_IDX >> 2, 0);
                                return null;
                            }
                            waited = true;
                            continue;
                        }
                        // Release read lock
                        Atomics.store(i32, READ_LOCK_IDX >> 2, 0);
                        return null;
                    } else {
                        dataOffset = DATA_OFFSET_PRIO_2;
                        prio = 2;
                    }
                } else {
                    dataOffset = DATA_OFFSET_PRIO_1;
                    prio = 1;
                }
            } else {
                dataOffset = DATA_OFFSET_PRIO_0;
                prio = 0;
            }
            // readIdx !== writeIdx, we have a packet
            break;
        }
        
        // Get the packet data
        const readOffset = dataOffset + (readIdx * PACKET_SLOT_SIZE);

        const payloadLength = Math.min(u16[(readOffset + PACKET_PAYLOAD_LENGTH_IDX) >> 1], maxLen);
        dataBuffer.set(u8.subarray(readOffset + PACKET_PAYLOAD_IDX, readOffset + PACKET_PAYLOAD_IDX + payloadLength), 0);
        destAddressBuffer.set(u8.subarray(readOffset + PACKET_DEST_ADDR_IDX, readOffset + PACKET_DEST_ADDR_IDX + 16), 0);
        srcAddressBuffer.set(u8.subarray(readOffset + PACKET_SRC_ADDR_IDX, readOffset + PACKET_SRC_ADDR_IDX + 16), 0);
        const destAddrFamily = u8[readOffset + PACKET_DEST_ADDR_FAMILY_IDX];
        const srcAddrFamily = u8[readOffset + PACKET_SRC_ADDR_FAMILY_IDX];
        const destPort = u16[(readOffset + PACKET_DEST_PORT_IDX) >> 1];
        const srcPort = u16[(readOffset + PACKET_SRC_PORT_IDX) >> 1];
        const creationTime = dv.getFloat64(readOffset + PACKET_BUFFERED_TIME_IDX, true);

        // Todo: Prio-based rules for max packet age before dropping?

        // Update read index
        readIdx = (readIdx + 1) % PACKETS_PER_PRIO_BUFFER;
        if (prio === 0) {
            Atomics.store(i32, READ_IDX_PRIO_0 >> 2, readIdx);
        } else if (prio === 1) {
            Atomics.store(i32, READ_IDX_PRIO_1 >> 2, readIdx);
        } else {
            Atomics.store(i32, READ_IDX_PRIO_2 >> 2, readIdx);
        }

        // Release read lock
        Atomics.store(i32, READ_LOCK_IDX >> 2, 0);

        return {
            length: payloadLength,
            srcFamily: srcAddrFamily,
            srcPort: srcPort,
            destFamily: destAddrFamily,
            destPort: destPort,
            creationTime: creationTime,
        };
    }

    /**
     * Reset buffer indices to 0
     */
    resetBuffer() {
        const i32 = this.i32;

        // Try to acquire read lock for 500 ms. Reads can wait atomic, so we need to wait for a while longer.
        let start = Date.now();
        while (Atomics.compareExchange(i32, READ_LOCK_IDX >> 2, 0, 1) !== 0) {
            if (Date.now() - start > 500) {
                console.warn('[SocketProxyShared] Failed to acquire read lock to reset buffer');
                return false;
            }
        }

        // Try to acquire write lock for 100 ms. Writes don't wait atomic, so 100 ms is enough.
        start = Date.now();
        while (Atomics.compareExchange(i32, WRITE_LOCK_IDX >> 2, 0, 1) !== 0) {
            if (Date.now() - start > 100) {
                console.warn('[SocketProxyShared] Failed to acquire write lock to reset buffer');
                // Release read lock
                Atomics.store(i32, READ_LOCK_IDX >> 2, 0);
                return false;
            }
        }

        // Reset read and write indices for all priority buffers
        Atomics.store(i32, READ_IDX_PRIO_0 >> 2, 0);
        Atomics.store(i32, WRITE_IDX_PRIO_0 >> 2, 0);
        Atomics.store(i32, READ_IDX_PRIO_1 >> 2, 0);
        Atomics.store(i32, WRITE_IDX_PRIO_1 >> 2, 0);
        Atomics.store(i32, READ_IDX_PRIO_2 >> 2, 0);
        Atomics.store(i32, WRITE_IDX_PRIO_2 >> 2, 0);

        // Release read lock
        Atomics.store(i32, READ_LOCK_IDX >> 2, 0);
        // Release write lock
        Atomics.store(i32, WRITE_LOCK_IDX >> 2, 0);

        return true;
    }
}

const NOOP_INT32 = new Int32Array(new SharedArrayBuffer(4));

const ADDRESS_NOT_SET = -1;
const PORT_NOT_SET = -1;
const MAX_SOCKETS = 2; // client and server slots
const SOCKET_ENTRY_SIZE = 9; // 9 Int32s per socket entry

// Indices for ring buffer implementation (int32 units)
// [0]: fd slot
const SOCKET_FD_IDX = 0;

// [1-3]: Server and client running flags
const IS_SERVER_RUNNING_IDX = 1;
const IS_SERVER_PUBLIC_IDX = 2;
const IS_CLIENT_RUNNING_IDX = 3;

// [4]: socket management lock
const MANAGE_SOCKET_LOCK_IDX = 4; // 0 = unlocked, 1 = locked

// [5-22]: two slots for socket management data (client and server slots)
// [5] is the first free slot for socket management data
const SOCKET_DATA_ARRAY_IDX = 5;
// Socket entry layout (in Int32 units):
// [0]: fd (0 = not in use)
// [1]: bound (0/1)
// [2]: Port (0 = not set)
// [3]: Address family (AF_INET = 2, AF_INET6 = 10)
// [4-7]: Address
// [8]: worker role (0 = unknown, 1 = client, 2 = server) - external (=3) worker role is not used with socket entries
const SOCKET_DATA_FD_IDX = 0;
const SOCKET_DATA_BOUND_IDX = 1;
const SOCKET_DATA_PORT_IDX = 2;
const SOCKET_DATA_ADDRESS_FAMILY_IDX = 3;
const SOCKET_DATA_ADDRESS_IDX = 4;
const SOCKET_DATA_WORKER_ROLE_IDX = 8;

// Use the shared buffer created in pre.js (on main thread before workers started)
// Note: We access this lazily because workers may load this file before the buffer is visible

/** @type {Int32Array} */
var sharedInt32 = null;
/** @type {Uint8Array} */
var sharedUint8 = null;
/** @type {DataView} */
var sharedDataView = null;

/** @type {SharedPacketBuffer} */
var clientPacketBuffer = null;
/** @type {SharedPacketBuffer} */
var serverPacketBuffer = null;
/** @type {SharedPacketBuffer} */
var externalPacketBuffer = null;

var ipv4LocalStaticAddress = new Uint8Array([127, 0, 0, 1]);
var ipv6LocalStaticAddress = new Uint8Array(16).fill(0);
ipv6LocalStaticAddress[15] = 1;

function initSharedNetworkBuffer() {
    if (typeof self._luantiSocketSharedBuffer === 'undefined') {
        throw new Error('Shared socket buffer not initialized');
    }
    console.log('[SocketProxyShared] Using shared buffer from self (packets stored in SharedArrayBuffer ring buffer)');
    sharedInt32 = new Int32Array(self._luantiSocketSharedBuffer);
    sharedUint8= new Uint8Array(self._luantiSocketSharedBuffer);
    sharedDataView = new DataView(self._luantiSocketSharedBuffer);

    clientPacketBuffer = new SharedPacketBuffer(self._luantiSocketSharedBuffer, GLOBAL_METADATA_SIZE);
    serverPacketBuffer = new SharedPacketBuffer(self._luantiSocketSharedBuffer, GLOBAL_METADATA_SIZE + SEGMENT_SIZE);
    externalPacketBuffer = new SharedPacketBuffer(self._luantiSocketSharedBuffer, GLOBAL_METADATA_SIZE + (SEGMENT_SIZE * 2));
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
function luantiProxyWritePacket(workerRole, destAddr, destPort, srcAddr, srcPort, data) {
    if (workerRole === WORKER_ROLE_CLIENT) {
        if (isAddressLocal(destAddr)) {
            // client to server
            return serverPacketBuffer.writePacket(destAddr, destPort, srcAddr, srcPort, data);
        } else {
            // client to external
            return externalPacketBuffer.writePacket(destAddr, destPort, srcAddr, srcPort, data);
        }
    } else if (workerRole === WORKER_ROLE_SERVER) {
        if (isAddressLocal(destAddr)) {
            // server to client
            return clientPacketBuffer.writePacket(destAddr, destPort, srcAddr, srcPort, data);
        } else {
            // server to external
            return externalPacketBuffer.writePacket(destAddr, destPort, srcAddr, srcPort, data);
        }
    } else if (workerRole === WORKER_ROLE_EXTERNAL) {
        if (Atomics.load(sharedInt32, IS_SERVER_RUNNING_IDX) === 1) {
            // external to server
            return serverPacketBuffer.writePacket(destAddr, destPort, srcAddr, srcPort, data);
        } else if (Atomics.load(sharedInt32, IS_CLIENT_RUNNING_IDX) === 1) {
            // external to client
            return clientPacketBuffer.writePacket(destAddr, destPort, srcAddr, srcPort, data);
        }
        else {
            return false;
        }
    } else {
        throw new Error('Invalid worker role');
    }
}

/**
 * Read packet from ring buffer for specific address:port
 * 
 * @param {number} workerRole - Worker role
 * @param {Uint8Array} dataBuffer - Buffer to read data into
 * @param {Uint8Array} destAddressBuffer - Buffer to read destination address into
 * @param {Uint8Array} srcAddressBuffer - Buffer to read source address into
 * @param {number} maxLen - Maximum length of data to read
 * @param {number} readerFamily - Reader address family (AF_INET = 2, AF_INET6 = 10)
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {{length: number, srcFamily: number, srcPort: number, destFamily: number, destPort: number} | null} Data read from packet or null if no packet found
 */
function luantiProxyReadPacket(workerRole, dataBuffer, destAddressBuffer, srcAddressBuffer, maxLen, timeoutMs) {
    if (workerRole === WORKER_ROLE_CLIENT) {
        return clientPacketBuffer.readPacket(dataBuffer, destAddressBuffer, srcAddressBuffer, maxLen, timeoutMs);
    } else if (workerRole === WORKER_ROLE_SERVER) {
        return serverPacketBuffer.readPacket(dataBuffer, destAddressBuffer, srcAddressBuffer, maxLen, timeoutMs);
    } else if (workerRole === WORKER_ROLE_EXTERNAL) {
        return externalPacketBuffer.readPacket(dataBuffer, destAddressBuffer, srcAddressBuffer, maxLen, timeoutMs);
    } else {
        throw new Error('Invalid worker role');
    }
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
        addr = sharedUint8.subarray(
            (socketDataIdx + SOCKET_DATA_ADDRESS_IDX) << 2,
            (socketDataIdx + SOCKET_DATA_ADDRESS_IDX + 4) << 2);
    }
    else if (addrFamily === AF_INET) {
        addr = sharedUint8.subarray(
            (socketDataIdx + SOCKET_DATA_ADDRESS_IDX) << 2,
            (socketDataIdx + SOCKET_DATA_ADDRESS_IDX + 1) << 2);
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
            initSharedNetworkBuffer();
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
            initSharedNetworkBuffer();
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
                Atomics.store(sharedInt32, IS_CLIENT_RUNNING_IDX, 1);
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
                }
            }
            if (addressIsZero) {
                // Normalize address to local address
                if (family === AF_INET6) {
                    addr_data = ipv6LocalStaticAddress;
                }
                else if (family === AF_INET) {
                    addr_data = ipv4LocalStaticAddress;
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
            initSharedNetworkBuffer();
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
                    address = ipv4LocalStaticAddress;
                }
                else if (family === AF_INET6) {
                    address = ipv6LocalStaticAddress;
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
                Atomics.store(sharedInt32, IS_CLIENT_RUNNING_IDX, 1);
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
        if (!luantiProxyWritePacket(
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
     * 
     * @param {number} fd - Socket file descriptor
     * @param {Uint8Array} dataBuffer - Buffer to read data into
     * @param {Uint8Array} destAddressBuffer - Buffer to read destination address into
     * @param {Uint8Array} srcAddressBuffer - Buffer to read source address into
     * @param {number} maxLen - Maximum length of data to read
     * @param {number} timeoutMs - Timeout in milliseconds
     * @returns {{length: number, srcFamily: number, srcPort: number, destFamily: number, destPort: number} | null} Data read from packet or null if no packet found
     */
    recvfrom: function(fd, dataBuffer, destAddressBuffer, srcAddressBuffer, maxLen, timeoutMs = 0) {
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
        var readerFamily = sharedInt32[this.socketDataIdx + SOCKET_DATA_ADDRESS_FAMILY_IDX];

        // Read packet from shared ring buffer
        const result = luantiProxyReadPacket(workerRole, dataBuffer, destAddressBuffer, srcAddressBuffer, maxLen, timeoutMs);

        if (result === null) {
            return null;
        }

        // For local address, convert to reader family if needed
        if (readerFamily === AF_INET && result.srcFamily === AF_INET6) {
            if (isAddressLocal(srcAddressBuffer.subarray(0, 16))) {
                result.srcFamily = AF_INET;
                srcAddressBuffer.set(ipv4LocalStaticAddress, 0);
            }
            else {
                console.error('[SocketProxyShared] Invalid source address and socket family mismatch (IPv6 vs. IPv4): ' + srcAddressBuffer.join(','));
                return null;
            }
        }
        else if (readerFamily === AF_INET6 && result.srcFamily === AF_INET) {
            if (isAddressLocal(srcAddressBuffer.subarray(0, 4))) {
                result.srcFamily = AF_INET6;
                srcAddressBuffer.set(ipv6LocalStaticAddress, 0);
            }
            else {
                console.error('[SocketProxyShared] Invalid source address and socket family mismatch (IPv4 vs. IPv6): ' + srcAddressBuffer.join(','));
                return null;
            }
        }

        return result;
    },

    /**
     * Close socket
     * 
     * @param {number} fd - Socket file descriptor
     * @returns {number} 0 on success, -1 on error
     */
    close: function(fd) {
        if (sharedInt32 === null) {
            initSharedNetworkBuffer();
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
                    Atomics.store(sharedInt32, IS_CLIENT_RUNNING_IDX, 0);
                    clientPacketBuffer.resetBuffer();
                    break;
                case WORKER_ROLE_SERVER:
                    Atomics.store(sharedInt32, IS_SERVER_PUBLIC_IDX, 0);
                    Atomics.store(sharedInt32, IS_SERVER_RUNNING_IDX, 0);
                    serverPacketBuffer.resetBuffer();
                    break;
                case WORKER_ROLE_EXTERNAL:
                    console.warn('[SocketProxyShared] close: External worker role not supported');
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