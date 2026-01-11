// Socket library for Emscripten - Override POSIX socket functions
// With pthreads, all socket operations must run on main thread where SocketProxy lives
mergeInto(LibraryManager.library, {
    em_socket_create: function(domain, type, protocol) {
        console.log('[socket-library] em_socket_create() called: domain=' + domain);
        return SocketProxy.socket(domain, type, protocol);
    }
});

