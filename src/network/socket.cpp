// Luanti
// SPDX-License-Identifier: LGPL-2.1-or-later
// Copyright (C) 2013 celeron55, Perttu Ahola <celeron55@gmail.com>

#include "socket.h"

#include <iostream>
#include <cstring>
#include "util/numeric.h"
#include "address.h"
#include "constants.h"
#include "log.h"
#include "networkexceptions.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>

// Emscripten: JavaScript socket proxy functions
// These call into our SocketProxy JavaScript object for in-memory packet routing
// With SharedArrayBuffer, SocketProxy is now thread-safe and works across all pthreads
EM_JS(int, em_socket_create, (int domain, int type, int protocol), {
	if (typeof SocketProxy === 'undefined') {
		console.error('[socket.cpp] SocketProxy not found!');
		return -1;
	}
	var fd = SocketProxy.socket(domain, type, protocol);
	console.log('[socket.cpp] em_socket_create returning fd=' + fd);
	return fd;
});

EM_JS(int, em_socket_bind, (int fd, const char* address, int port), {
	var addr_str = UTF8ToString(address);
	var result = SocketProxy.bind(fd, addr_str, port);
	console.log('[socket.cpp] em_socket_bind(' + fd + ', ' + addr_str + ', ' + port + ') = ' + result);
	return result;
});

EM_JS(int, em_socket_sendto, (int fd, const void* data, int len, const char* dest_addr, int dest_port), {
	var addr_str = UTF8ToString(dest_addr);
	var data_array = new Uint8Array(HEAPU8.buffer, data, len).slice(0);
	var result = SocketProxy.sendto(fd, data_array, addr_str, dest_port);
	return result;
});

EM_JS(int, em_socket_recvfrom, (int fd, void* buffer, int len, char* src_addr, int src_addr_len, int* src_port), {
	var buf = new Uint8Array(len);
	var result = SocketProxy.recvfrom(fd, buf, len);
	
	if (!result) {
		// No data available (EAGAIN) - this is normal, don't spam logs
		return -1;
	}
	
	// Copy data to C++ buffer
	HEAPU8.set(buf.subarray(0, result.length), buffer);
	
	// Write source address if requested
	if (src_addr && src_addr_len > 0) {
		stringToUTF8(result.address, src_addr, src_addr_len);
	}
	
	// Write source port if requested
	if (src_port) {
		HEAP32[src_port >> 2] = result.port;
	}
	
	return result.length;
});

EM_JS(int, em_socket_close, (int fd), {
	return SocketProxy.close(fd);
});

#endif // __EMSCRIPTEN__

#ifdef _WIN32
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include "util/string.h"
#define LAST_SOCKET_ERR() WSAGetLastError()
#define SOCKET_ERR_STR(e) itos(e)
typedef int socklen_t;
#else
#include <cerrno>
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
#include <arpa/inet.h>
#define LAST_SOCKET_ERR() (errno)
#define SOCKET_ERR_STR(e) strerror(e)
#endif

static bool g_sockets_initialized = false;

// Initialize sockets
void sockets_init()
{
#ifdef _WIN32
	// Windows needs sockets to be initialized before use
	WSADATA WsaData;
	if (WSAStartup(MAKEWORD(2, 2), &WsaData) != NO_ERROR)
		throw SocketException("WSAStartup failed");
#endif
	g_sockets_initialized = true;
}

void sockets_cleanup()
{
#ifdef _WIN32
	// On Windows, cleanup sockets after use
	WSACleanup();
#endif
	g_sockets_initialized = false;
}

/*
	UDPSocket
*/

UDPSocket::UDPSocket(bool ipv6)
{
	init(ipv6, false);
}

bool UDPSocket::init(bool ipv6, bool noExceptions)
{
	if (!g_sockets_initialized) {
		verbosestream << "Sockets not initialized" << std::endl;
		return false;
	}

	if (m_handle >= 0) {
		auto msg = "Cannot initialize socket twice";
		verbosestream << msg << std::endl;
		if (noExceptions)
			return false;
		throw SocketException(msg);
	}

	// Use IPv6 if specified
	m_addr_family = ipv6 ? AF_INET6 : AF_INET;
	
#ifdef __EMSCRIPTEN__
	// Emscripten: Use JavaScript socket proxy
	m_handle = em_socket_create(m_addr_family, SOCK_DGRAM, IPPROTO_UDP);
#else
	m_handle = socket(m_addr_family, SOCK_DGRAM, IPPROTO_UDP);
#endif

	if (m_handle < 0) {
		auto msg = std::string("Failed to create socket: ") +
			SOCKET_ERR_STR(LAST_SOCKET_ERR());
		verbosestream << msg << std::endl;
		if (noExceptions)
			return false;
		throw SocketException(msg);
	}

	setTimeoutMs(0);

	return true;
}

UDPSocket::~UDPSocket()
{
	if (m_handle >= 0) {
#ifdef __EMSCRIPTEN__
		em_socket_close(m_handle);
#elif defined(_WIN32)
		closesocket(m_handle);
#else
		close(m_handle);
#endif
	}
}

void UDPSocket::Bind(Address addr)
{
	if (addr.getFamily() != m_addr_family) {
		const char *errmsg =
				"Socket and bind address families do not match";
		errorstream << "Bind failed: " << errmsg << std::endl;
		throw SocketException(errmsg);
	}

#ifdef __EMSCRIPTEN__
	// Emscripten: Use JavaScript socket proxy for bind
	EM_ASM({
		console.log('[socket.cpp] Bind() called, fd=' + $0 + ', family=' + $1 + ', port=' + $2);
	}, m_handle, m_addr_family, addr.getPort());
	
	// Manually format IP address to avoid inet_ntop issues
	char addr_buf[64];
	if (m_addr_family == AF_INET6) {
		// IPv6 - treat as localhost for now
		snprintf(addr_buf, sizeof(addr_buf), "::1");
		EM_ASM({ console.log('[socket.cpp] Using IPv6 localhost'); });
	} else {
		// IPv4
		EM_ASM({ console.log('[socket.cpp] Getting IPv4 address...'); });
		struct in_addr ipv4 = addr.getAddress();
		EM_ASM({ console.log('[socket.cpp] Got in_addr, formatting...'); });
		unsigned char *bytes = (unsigned char*)&ipv4.s_addr;
		snprintf(addr_buf, sizeof(addr_buf), "%u.%u.%u.%u", 
			bytes[0], bytes[1], bytes[2], bytes[3]);
		EM_ASM({ console.log('[socket.cpp] Formatted address: ' + UTF8ToString($0)); }, addr_buf);
	}
	
	EM_ASM({ console.log('[socket.cpp] Calling em_socket_bind...'); });
	int ret = em_socket_bind(m_handle, addr_buf, addr.getPort());
	EM_ASM({ console.log('[socket.cpp] em_socket_bind returned: ' + $0); }, ret);
	
	if (ret < 0) {
		tracestream << (int)m_handle << ": Bind failed (Emscripten)" << std::endl;
		throw SocketException("Failed to bind socket");
	}
#else
	if (m_addr_family == AF_INET6) {
		// Allow our socket to accept both IPv4 and IPv6 connections
		// required on Windows:
		// <https://msdn.microsoft.com/en-us/library/windows/desktop/bb513665(v=vs.85).aspx>
		int value = 0;
		if (setsockopt(m_handle, IPPROTO_IPV6, IPV6_V6ONLY,
				reinterpret_cast<char *>(&value), sizeof(value)) != 0) {
			auto errmsg = SOCKET_ERR_STR(LAST_SOCKET_ERR());
			errorstream << "Failed to disable V6ONLY: " << errmsg
				<< "\nTry disabling ipv6_server to fix this." << std::endl;
			throw SocketException(errmsg);
		}
	}

	int ret = 0;

	if (m_addr_family == AF_INET6) {
		struct sockaddr_in6 address;
		memset(&address, 0, sizeof(address));

		address.sin6_family = AF_INET6;
		address.sin6_addr = addr.getAddress6();
		address.sin6_port = htons(addr.getPort());

		ret = bind(m_handle, (const struct sockaddr *) &address,
				sizeof(struct sockaddr_in6));
	} else {
		struct sockaddr_in address;
		memset(&address, 0, sizeof(address));

		address.sin_family = AF_INET;
		address.sin_addr = addr.getAddress();
		address.sin_port = htons(addr.getPort());

		ret = bind(m_handle, (const struct sockaddr *) &address,
			sizeof(struct sockaddr_in));
	}

	if (ret < 0) {
		tracestream << (int)m_handle << ": Bind failed: "
			<< SOCKET_ERR_STR(LAST_SOCKET_ERR()) << std::endl;
		throw SocketException("Failed to bind socket");
	}
#endif
}

void UDPSocket::Send(const Address &destination, const void *data, int size)
{
	bool dumping_packet = false; // for INTERNET_SIMULATOR

	if (INTERNET_SIMULATOR)
		dumping_packet = myrand() % INTERNET_SIMULATOR_PACKET_LOSS == 0;

	if (dumping_packet) {
		// Lol let's forget it
		tracestream << "UDPSocket::Send(): INTERNET_SIMULATOR: dumping packet."
			<< std::endl;
		return;
	}

	if (destination.getFamily() != m_addr_family) {
#ifdef __EMSCRIPTEN__
		EM_ASM({
			console.error('[socket.cpp] Address family mismatch! socket_family=' + $0 + ', dest_family=' + $1);
		}, m_addr_family, destination.getFamily());
#endif
		throw SendFailedException("Address family mismatch");
	}

	int sent;
#ifdef __EMSCRIPTEN__
	// Emscripten: Use JavaScript socket proxy for sendto
	// Manually format IP address
	// CRITICAL: Always use 127.0.0.1 for localhost (normalize IPv6 ::1 to IPv4)
	// because our SocketProxy normalizes all addresses to 127.0.0.1
	char dest_buf[64];
	if (m_addr_family == AF_INET6) {
		// IPv6 socket, but normalize ::1 to 127.0.0.1 for SocketProxy
		snprintf(dest_buf, sizeof(dest_buf), "127.0.0.1");
	} else {
		struct in_addr ipv4 = destination.getAddress();
		unsigned char *bytes = (unsigned char*)&ipv4.s_addr;
		snprintf(dest_buf, sizeof(dest_buf), "%u.%u.%u.%u", 
			bytes[0], bytes[1], bytes[2], bytes[3]);
	}
	sent = em_socket_sendto(m_handle, data, size, dest_buf, destination.getPort());
#else
	if (m_addr_family == AF_INET6) {
		struct sockaddr_in6 address = {};
		address.sin6_family = AF_INET6;
		address.sin6_addr = destination.getAddress6();
		address.sin6_port = htons(destination.getPort());

		sent = sendto(m_handle, (const char *)data, size, 0,
				(struct sockaddr *)&address, sizeof(struct sockaddr_in6));
	} else {
		struct sockaddr_in address = {};
		address.sin_family = AF_INET;
		address.sin_addr = destination.getAddress();
		address.sin_port = htons(destination.getPort());

		sent = sendto(m_handle, (const char *)data, size, 0,
				(struct sockaddr *)&address, sizeof(struct sockaddr_in));
	}
#endif

	if (sent != size)
		throw SendFailedException("Failed to send packet");
}

int UDPSocket::Receive(Address &sender, void *data, int size)
{
#ifdef __EMSCRIPTEN__
	// Emscripten: Use JavaScript socket proxy for recvfrom
	// No WaitData needed - JavaScript proxy handles non-blocking
	size = MYMAX(size, 0);
	char src_addr_buf[256];
	int src_port = 0;
	int received = em_socket_recvfrom(m_handle, data, size, src_addr_buf, sizeof(src_addr_buf), &src_port);
	if (received < 0)
		return -1;
	
	// Parse IP address string and create Address with matching family
	// CRITICAL: The returned address MUST match the socket's address family
	// or Send() will fail with "Address family mismatch"
	unsigned int a, b, c, d;
	if (sscanf(src_addr_buf, "%u.%u.%u.%u", &a, &b, &c, &d) == 4) {
		// Received IPv4 address string
		if (m_addr_family == AF_INET6) {
			// Socket is IPv6, so return IPv6-mapped IPv4 address
			/* EM_ASM({ console.log('[socket.cpp] Parsed IPv4, converting to IPv6 for socket compatibility'); }); */
			// Use IPv6 localhost for simplicity (both client and server use localhost)
			IPv6AddressBytes bytes;
			bytes.bytes[0] = 0; bytes.bytes[1] = 0; bytes.bytes[2] = 0; bytes.bytes[3] = 0;
			bytes.bytes[4] = 0; bytes.bytes[5] = 0; bytes.bytes[6] = 0; bytes.bytes[7] = 0;
			bytes.bytes[8] = 0; bytes.bytes[9] = 0; bytes.bytes[10] = 0; bytes.bytes[11] = 0;
			bytes.bytes[12] = 0; bytes.bytes[13] = 0; bytes.bytes[14] = 0; bytes.bytes[15] = 1;
			sender = Address(&bytes, src_port);
		} else {
			// Socket is IPv4, return IPv4 address
			/* EM_ASM({ console.log('[socket.cpp] Parsed IPv4 address'); }); */
			sender = Address(a, b, c, d, src_port);
		}
	} else {
		// Assume localhost with matching family
		EM_ASM({ console.log('[socket.cpp] Using localhost fallback'); });
		if (m_addr_family == AF_INET6) {
			IPv6AddressBytes bytes;
			bytes.bytes[0] = 0; bytes.bytes[1] = 0; bytes.bytes[2] = 0; bytes.bytes[3] = 0;
			bytes.bytes[4] = 0; bytes.bytes[5] = 0; bytes.bytes[6] = 0; bytes.bytes[7] = 0;
			bytes.bytes[8] = 0; bytes.bytes[9] = 0; bytes.bytes[10] = 0; bytes.bytes[11] = 0;
			bytes.bytes[12] = 0; bytes.bytes[13] = 0; bytes.bytes[14] = 0; bytes.bytes[15] = 1;
			sender = Address(&bytes, src_port);
		} else {
			sender = Address(127, 0, 0, 1, src_port);
		}
	}
	return received;
#else
	// Return on timeout
	assert(m_timeout_ms >= 0);
	if (!WaitData(m_timeout_ms))
		return -1;

	size = MYMAX(size, 0);

	int received;
	if (m_addr_family == AF_INET6) {
		struct sockaddr_in6 address;
		memset(&address, 0, sizeof(address));
		socklen_t address_len = sizeof(address);

		received = recvfrom(m_handle, (char *)data, size, 0,
				(struct sockaddr *)&address, &address_len);

		if (received < 0)
			return -1;

		u16 address_port = ntohs(address.sin6_port);
		const auto *bytes = reinterpret_cast<IPv6AddressBytes*>
			(address.sin6_addr.s6_addr);
		sender = Address(bytes, address_port);
	} else {
		struct sockaddr_in address;
		memset(&address, 0, sizeof(address));

		socklen_t address_len = sizeof(address);

		received = recvfrom(m_handle, (char *)data, size, 0,
				(struct sockaddr *)&address, &address_len);

		if (received < 0)
			return -1;

		u32 address_ip = ntohl(address.sin_addr.s_addr);
		u16 address_port = ntohs(address.sin_port);

		sender = Address(address_ip, address_port);
	}

	return received;
#endif
}

void UDPSocket::setTimeoutMs(int timeout_ms)
{
	m_timeout_ms = timeout_ms;
}

bool UDPSocket::WaitData(int timeout_ms)
{
	timeout_ms = MYMAX(timeout_ms, 0);

#ifdef _WIN32
	WSAPOLLFD pfd;
	pfd.fd = m_handle;
	pfd.events = POLLRDNORM;

	int result = WSAPoll(&pfd, 1, timeout_ms);
#else
	struct pollfd pfd;
	pfd.fd = m_handle;
	pfd.events = POLLIN;

	int result = poll(&pfd, 1, timeout_ms);
#endif

	if (result == 0) {
		return false; // No data
	} else if (result > 0) {
		// There might be data
		return pfd.revents != 0;
	}

	// Error case
	int e = LAST_SOCKET_ERR();

#ifdef _WIN32
	if (e == WSAEINTR || e == WSAEBADF) {
#else
	if (e == EINTR || e == EBADF) {
#endif
		// N.B. poll() fails when sockets are destroyed on Connection's dtor
		// with EBADF. Instead of doing tricky synchronization, allow this
		// thread to exit but don't throw an exception.
		return false;
	}

	tracestream << (int)m_handle << ": poll failed: "
		<< SOCKET_ERR_STR(e) << std::endl;

	throw SocketException("poll failed");
}
