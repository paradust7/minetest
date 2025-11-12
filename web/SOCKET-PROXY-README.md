# Socket Proxy Implementation for Luanti Web Port

## Overview

This document describes the custom socket proxy implementation that enables Luanti's single-player mode to work in the browser without external dependencies.

## The Problem

Luanti uses UDP sockets for client-server communication, even in single-player mode (the client connects to a local server via loopback). WebAssembly/Emscripten has several limitations:

1. **No direct UDP support** - WebAssembly cannot create raw UDP sockets
2. **WebSocket-only** - Emscripten's `PROXY_POSIX_SOCKETS` only works with WebSockets and requires an external proxy server
3. **Overkill for localhost** - Running a separate proxy process just for in-process communication is unnecessary

## The Solution: JavaScript Socket Proxy

We implemented a **pure JavaScript socket proxy** that intercepts POSIX socket calls and routes them appropriately:

- **Localhost connections** → In-memory packet queues (no network)
- **Remote connections** → Reserved for future WebRTC/WebTransport implementation

### Architecture

```
┌─────────────────────────────────────────┐
│  C++ Code (unchanged)                   │
│  socket(), bind(), sendto(), recvfrom() │
└──────────────┬──────────────────────────┘
               │ POSIX socket syscalls
               ▼
┌─────────────────────────────────────────┐
│  socket-library.js                      │
│  Emscripten library that intercepts     │
│  syscalls and bridges to JavaScript     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  socket-proxy.js                        │
│  ┌─────────────────────────────────┐   │
│  │ 127.0.0.1 / localhost?          │   │
│  │  → In-memory FIFO queues        │   │
│  │  → Direct packet passing        │   │
│  └─────────────────────────────────┘   │
│  ┌─────────────────────────────────┐   │
│  │ Remote address?                 │   │
│  │  → Not yet implemented          │   │
│  │  → Future: WebRTC/WebTransport  │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## Implementation Details

### Files

1. **`web/socket-proxy.js`** (~250 lines)
   - Maintains socket registry (fd → socket info)
   - Maintains packet queues (address:port → packet array)
   - Implements socket operations: `socket()`, `bind()`, `sendto()`, `recvfrom()`, `close()`
   - Routes localhost packets through in-memory queues

2. **`web/socket-library.js`** (~190 lines)
   - Emscripten library file (uses `mergeInto(LibraryManager.library, {...})`)
   - Intercepts syscalls: `__syscall_socket`, `__syscall_bind`, `__syscall_sendto`, `__syscall_recvfrom`
   - Parses C `sockaddr` structures from WASM memory
   - Bridges between C calling convention and JavaScript

3. **`web/emscripten-toolchain.cmake`** (updated)
   - Added `--pre-js=${CMAKE_SOURCE_DIR}/web/socket-proxy.js`
   - Added `--js-library=${CMAKE_SOURCE_DIR}/web/socket-library.js`
   - Removed `PROXY_POSIX_SOCKETS` flag (not needed)

### How It Works

1. **Socket Creation**
   - C code calls `socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)`
   - Emscripten routes to `__syscall_socket` in `socket-library.js`
   - Creates virtual socket in `SocketProxy.sockets` registry
   - Returns file descriptor (starting at 100 to avoid conflicts)

2. **Binding**
   - C code calls `bind(fd, &addr, addrlen)`
   - `socket-library.js` parses `sockaddr_in` structure from WASM heap
   - Extracts IP address and port
   - Creates packet queue for `address:port` key

3. **Sending**
   - C code calls `sendto(fd, buf, len, flags, &dest_addr, addrlen)`
   - Copies data from WASM memory to JavaScript `Uint8Array`
   - Checks if destination is localhost (127.0.0.1, ::1, etc.)
   - Pushes packet to destination's queue with source info

4. **Receiving**
   - C code calls `recvfrom(fd, buf, len, flags, &src_addr, &addrlen)`
   - Pops oldest packet from socket's queue
   - Copies data to WASM memory
   - Writes source address to `sockaddr` structure
   - Returns `-EAGAIN` if no data available (non-blocking)

## Current Status: Stage 1 Complete ✓

**Stage 1: Localhost Loopback**
- ✅ Single-player mode works
- ✅ No external dependencies
- ✅ Pure in-memory communication
- ✅ Fast (no serialization overhead)

## Future Stages

**Stage 2: WebRTC DataChannels** (Not yet implemented)
- P2P multiplayer via WebRTC
- NAT traversal built-in
- Requires signaling server for peer discovery
- UDP-like unreliable channels

**Stage 3: WebTransport/HTTP3** (Not yet implemented)
- Modern QUIC-based protocol
- Lower latency than WebRTC
- Easier server hosting
- Better for client-server architecture

## Benefits of This Approach

1. **No external dependencies** - Works out of the box
2. **Future-proof** - Easy to add WebRTC/WebTransport later
3. **C++ code unchanged** - Uses standard POSIX sockets
4. **Flexible** - Can route different addresses to different transports
5. **Debuggable** - Pure JavaScript, easy to inspect and modify

## Testing

After building (`./web/01-build-luanti.sh`), serve the output:

```bash
cd build-web/output
python3 -m http.server 8080
```

Open `http://localhost:8080` and start a single-player game. Check browser console for socket proxy logs.

## Debugging

The socket proxy logs important events to the console:
- Socket creation/destruction
- Bind operations
- Occasional send/receive (1% sampling to avoid spam)

To enable full logging, modify `socket-proxy.js` and remove the `Math.random() < 0.01` checks.

## Known Limitations

1. **IPv6 support** - Currently treats IPv6 localhost as IPv4 (works but not ideal)
2. **Remote connections** - Not yet implemented (will fail with clear error)
3. **Socket options** - Most `setsockopt`/`getsockopt` calls are stubbed (return success)
4. **Error codes** - Limited errno mapping (could be expanded)

## Contributing

To add WebRTC support (Stage 2):
1. Modify `socket-proxy.js` `sendto()` to detect non-localhost addresses
2. Create WebRTC DataChannel connection
3. Send packets via `channel.send()`
4. Buffer incoming packets in queue
5. Implement signaling (WebSocket to matchmaking server)

The C++ code will not need any changes!

