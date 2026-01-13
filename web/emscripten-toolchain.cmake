# Emscripten CMake toolchain file for Luanti
# This file configures CMake to build Luanti for WebAssembly
# Use with: emcmake cmake -DCMAKE_TOOLCHAIN_FILE=path/to/this/file

# Set the system name to Emscripten
set(CMAKE_SYSTEM_NAME Emscripten)
set(CMAKE_SYSTEM_VERSION 1)

# C and C++ compilers
set(CMAKE_C_COMPILER "emcc")
set(CMAKE_CXX_COMPILER "em++")
set(CMAKE_AR "emar")
set(CMAKE_RANLIB "emranlib")

# Find root path for Emscripten
set(CMAKE_FIND_ROOT_PATH ${EMSCRIPTEN_ROOT_PATH})
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)

# Emscripten provides these libraries as built-in ports
# We need to tell CMake they exist so find_package() succeeds
# The actual linking happens automatically via emcc

# ZLIB - built-in to Emscripten
set(ZLIB_FOUND TRUE)
set(ZLIB_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include")
set(ZLIB_INCLUDE_DIRS "${ZLIB_INCLUDE_DIR}")
set(ZLIB_LIBRARY "z")
set(ZLIB_LIBRARIES "${ZLIB_LIBRARY}")

# PNG - Emscripten port (handled by -sUSE_LIBPNG=1 at link time)
set(PNG_FOUND TRUE)
set(PNG_PNG_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include")
# Use dummy value - actual linking handled by -sUSE_LIBPNG=1
set(PNG_LIBRARY "EMSCRIPTEN_PORT_PNG")
set(PNG_LIBRARIES "EMSCRIPTEN_PORT_PNG")

# JPEG - Emscripten port
set(JPEG_FOUND TRUE)
set(JPEG_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include")
set(JPEG_LIBRARY "jpeg")
set(JPEG_LIBRARIES "${JPEG_LIBRARY}")

# OpenGLES2 - provided by Emscripten's WebGL
set(OPENGLES2_FOUND TRUE)
set(OPENGLES2_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include")
set(OPENGLES2_LIBRARY "GLESv2")
set(OPENGLES2_LIBRARIES "${OPENGLES2_LIBRARY}")

# EGL - provided by Emscripten
set(EGL_FOUND TRUE)
set(EGL_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include")
set(EGL_LIBRARY "EGL")
set(EGL_LIBRARIES "${EGL_LIBRARY}")

# SDL2 - provided by Emscripten via -sUSE_SDL=2
set(SDL2_FOUND TRUE)
set(SDL2_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include/SDL2")
set(SDL2_INCLUDE_DIRS "${SDL2_INCLUDE_DIR}")
set(SDL2_LIBRARY "SDL2")
set(SDL2_LIBRARIES "${SDL2_LIBRARY}")

# Freetype - Emscripten port
set(FREETYPE_FOUND TRUE)
set(FREETYPE_INCLUDE_DIRS "${EMSCRIPTEN_ROOT_PATH}/system/include/freetype2")
set(FREETYPE_LIBRARY "EMSCRIPTEN_PORT")
set(FREETYPE_LIBRARIES "${FREETYPE_LIBRARY}")

# SQLite3 - built-in to Emscripten (handled by -sUSE_SQLITE3=1 at link time)
set(SQLITE3_FOUND TRUE)
set(SQLITE3_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include")
# Set to "sqlite3" for CMake, but Emscripten will handle it via port system
set(SQLITE3_LIBRARY "sqlite3")
set(SQLITE3_LIBRARIES "sqlite3")

# OpenAL - Emscripten port (handled by -sUSE_OPENAL=1 at link time) <-- incorrect
# Set as CACHE variables so find_package(OpenAL) will detect them
#
set(OPENAL_FOUND TRUE CACHE BOOL "OpenAL found")
set(OPENAL_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include" CACHE PATH "OpenAL include directory")
set(OPENAL_LIBRARY "openal" CACHE STRING "OpenAL library")
set(OPENAL_LIBRARIES "${OPENAL_LIBRARY}" CACHE STRING "OpenAL libraries")

# Ogg - Emscripten port (handled by -sUSE_OGG=1 at link time)
# Set as CACHE variables so find_package(Vorbis) will detect them
set(OGG_FOUND TRUE CACHE BOOL "Ogg found")
set(OGG_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include" CACHE PATH "Ogg include directory")
set(OGG_LIBRARY "ogg" CACHE STRING "Ogg library")
set(OGG_LIBRARIES "${OGG_LIBRARY}" CACHE STRING "Ogg libraries")

# Vorbis - Emscripten port (handled by -sUSE_VORBIS=1 at link time)
# Set as CACHE variables so find_package(Vorbis) will detect them
# Note: Emscripten's libvorbis.a includes vorbisfile - no separate library needed
set(VORBIS_FOUND TRUE CACHE BOOL "Vorbis found")
set(VORBIS_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include" CACHE PATH "Vorbis include directory")
set(VORBIS_LIBRARY "vorbis" CACHE STRING "Vorbis library")
set(VORBISFILE_LIBRARY "vorbis" CACHE STRING "Vorbisfile library (same as vorbis in Emscripten)")
set(VORBIS_LIBRARIES "${VORBIS_LIBRARY}" CACHE STRING "Vorbis libraries")

# Zstd - manually compiled with pthread support (in /usr/local)
set(ZSTD_FOUND TRUE)
set(ZSTD_INCLUDE_DIR "/usr/local/include")
set(ZSTD_INCLUDE_DIRS "${ZSTD_INCLUDE_DIR}")
set(ZSTD_LIBRARY "/usr/local/lib/libzstd.a")
set(ZSTD_LIBRARIES "${ZSTD_LIBRARY}")

# Force static libraries (Emscripten doesn't support dynamic linking)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build shared libraries" FORCE)

# Platform-specific settings
set(EMSCRIPTEN_PLATFORM TRUE)
set(EMSCRIPTEN TRUE)

# Emscripten linker flags - split into common and final-exe-only flags
# Common flags (safe for CMake tests)
set(EMSCRIPTEN_COMMON_FLAGS
    # Memory settings
    "-sINITIAL_MEMORY=256MB"
    "-sMAXIMUM_MEMORY=2GB"
    "-sALLOW_MEMORY_GROWTH=1"
    # "-sALLOW_TABLE_GROWTH=1"
    "-sSTACK_SIZE=10MB"
    "-sDEFAULT_PTHREAD_STACK_SIZE=2097152"
    
    # WebGL / Graphics
    "-sFULL_ES3=1"
    "-sUSE_WEBGL2=1"
    "-sMIN_WEBGL_VERSION=2"
    "-sMAX_WEBGL_VERSION=2"
    
    # SDL2 (Luanti uses SDL2)
    "-sUSE_SDL=2"
    
    # Filesystem
    "-sFORCE_FILESYSTEM=1"
    
    # Networking
    "-sFETCH=1"
    
    # Socket emulation: Using custom JavaScript proxy (socket-proxy.js + socket-library.js)
    # Stage 1: Localhost loopback for single-player
    # Future: WebRTC DataChannels / WebTransport for multiplayer
    # Note: NOT using PROXY_POSIX_SOCKETS - we implement our own socket layer
    
    # Debug and Error Reporting (reduced verbosity for performance)
    "-sASSERTIONS=2"
    "-sSTACK_OVERFLOW_CHECK=2"
    "-sALLOW_UNIMPLEMENTED_SYSCALLS=1"
    "-sERROR_ON_UNDEFINED_SYMBOLS=0"
    # "-sGL_DEBUG=1"  # Enable to debug GL issues
    # "-sGL_TRACK_ERRORS=1"  # Track GL errors
    "-sRUNTIME_DEBUG=0"  # Disable runtime keepalive spam
    
    # CRITICAL: ASYNCIFY allows synchronous main loops to yield to the browser
    # Without this, the game loop blocks the JavaScript thread = frozen browser
    # "-sASYNCIFY=2"
    # "-sASYNCIFY_STACK_SIZE=8388608"
    # "-sJSPI_EXPORTS=['_main']"
    # "-sJSPI_IMPORTS=['emscripten_sleep','emscripten_yield','emscripten_main_loop_helper','emscripten_asm_const_int','emscripten_asm_const_double','emscripten_asm_const_void','emscripten_scan_registers','getaddrinfo','emscripten_getaddrinfo']"
    # "-sASYNCIFY_ADD=['_main','main','the_game','*ClientLauncher*run*','*Game*startup*','*Game*init*','*Game*createServer*','*Game*createClient*','*Address*Resolve*','*getaddrinfo*','*fps_control*limit*','*sleep_ms*']"
    # "-sASYNCIFY_REMOVE=['__wasm_call_ctors','_emscripten_init_main_thread','emscripten_futex_wake','emscripten_runtime_init','*BanManager*','*Server*','*Connection*','*EmergeManager*','*Thread*','*Socket*','*fs*','*filesys*','*NetworkPacket*','*Settings*','*Inventory*','*Mod*','*Script*','*Env*']"
    # "-sASYNCIFY_PROPAGATE_ADD=0"
    # "-sASYNCIFY_ADVISE=1"
    # "-sALLOW_BLOCKING_ON_MAIN_THREAD=1"
    
    "-sASYNCIFY=2"
    "-sASYNCIFY_STACK_SIZE=8388608"
    "-sJSPI_EXPORTS=['_main']"
    "-sJSPI_IMPORTS=['emscripten_sleep','emscripten_yield','emscripten_main_loop_helper','emscripten_asm_const_int','emscripten_asm_const_double','emscripten_asm_const_void','emscripten_scan_registers','getaddrinfo','emscripten_getaddrinfo']"
    "-sASYNCIFY_ADD=['_main','main','the_game','*ClientLauncher*run*','*Game*startup*','*Game*init*','*Game*createServer*','*Game*createClient*','*fps_control*limit*','*sleep_ms*']"
    "-sASYNCIFY_REMOVE=['__wasm_call_ctors','_emscripten_init_main_thread','emscripten_futex_wake','emscripten_runtime_init','*BanManager*','*Server*','*Connection*','*EmergeManager*','*Thread*','*Socket*','*fs*','*filesys*','*NetworkPacket*','*Settings*','*Inventory*','*Mod*','*Script*','*Env*','*lambda*','*$_*']"
    "-sASYNCIFY_PROPAGATE_ADD=0"
    "-sASYNCIFY_ADVISE=1"
    "-sALLOW_BLOCKING_ON_MAIN_THREAD=1"

    # Threading support (required for server thread + network threads)
    # Enables Web Workers for true multithreading
    "-pthread"
    "-sPTHREAD_POOL_SIZE=20"  # Pre-create 16 worker threads (server + client network threads + emerge + overhead)
    # Note: NOT using PROXY_TO_PTHREAD - main() runs on main thread for WebGL compatibility
    # Server runs in one thread, network threads in others
    
    # SDL2 Emscripten integration
    "-sOFFSCREENCANVAS_SUPPORT=0"  # Don't use OffscreenCanvas (not widely supported)
    
    # CRITICAL: Tell SDL to use emscripten_set_main_loop_timing for proper FPS limiting
    # This makes SDL respect vsync and use requestAnimationFrame
    "-sDEFAULT_TO_CXX=1"  # C++ support for SDL

    # "-sPROXY_TO_PTHREAD=1"
    # "-sOFFSCREENCANVAS_SUPPORT=1"
    # "-sOFFSCREENCANVASES_TO_PTHREAD=\"#canvas\""
    # "-sOFFSCREEN_FRAMEBUFFER=1"
)

# Additional compile flags for SDL2
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -DEMSCRIPTEN_SDL2_MAIN_LOOP")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DEMSCRIPTEN_SDL2_MAIN_LOOP")

# These flags should ONLY be applied to the final executable, not CMake tests
set(EMSCRIPTEN_FINAL_EXE_FLAGS
    # Preload game data (can't be used during CMake tests)
    "--preload-file=${CMAKE_SOURCE_DIR}/builtin@/builtin"
    "--preload-file=${CMAKE_SOURCE_DIR}/games@/games"
    "--preload-file=${CMAKE_SOURCE_DIR}/textures@/textures"
    "--preload-file=${CMAKE_SOURCE_DIR}/fonts@/fonts"
    "--preload-file=${CMAKE_SOURCE_DIR}/client@/client"
    
    # JavaScript/WASM settings
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','FS','ENV']"
    "-sEXPORTED_FUNCTIONS=['_main']"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME='LuantiModule'"
    "-sWEBSOCKET_URL=ws://localhost:30000"
    
    # JSPI / Asyncify Settings (Applied to final executable)
    "-sASYNCIFY=2"
    "-sASYNCIFY_STACK_SIZE=8388608"
    "-sJSPI_EXPORTS=['_main']"
    # "-sJSPI_IMPORTS=['emscripten_sleep','emscripten_yield','emscripten_main_loop_helper','emscripten_asm_const_int','emscripten_asm_const_double','emscripten_asm_const_void','emscripten_scan_registers','getaddrinfo','emscripten_getaddrinfo']"
    # "-sASYNCIFY_REMOVE=['__wasm_call_ctors','_emscripten_init_main_thread','emscripten_futex_wake','emscripten_runtime_init','*BanManager*','*Server*','*Connection*','*EmergeManager*','*Thread*','*Socket*','*fs*','*filesys*','*NetworkPacket*','*Settings*','*Inventory*','*Mod*','*Script*','*Env*']"
    "-sASYNCIFY_ADVISE=1"
    "-sJSPI_IMPORTS=['emscripten_sleep','emscripten_yield','emscripten_main_loop_helper','emscripten_asm_const_int','emscripten_asm_const_double','emscripten_asm_const_void','emscripten_scan_registers','getaddrinfo','emscripten_getaddrinfo']"
    "-sASYNCIFY_ADD=['_main','main','the_game','*ClientLauncher*run*','*Game*startup*','*Game*init*','*Game*createServer*','*Game*createClient*','*fps_control*limit*','*sleep_ms*']"
    "-sASYNCIFY_REMOVE=['__wasm_call_ctors','_emscripten_init_main_thread','emscripten_futex_wake','emscripten_runtime_init','*BanManager*','*Server*','*Connection*','*EmergeManager*','*Thread*','*Socket*','*fs*','*filesys*','*NetworkPacket*','*Settings*','*Inventory*','*Mod*','*Script*','*Env*','*lambda*','*$_*']"
    "-sALLOW_BLOCKING_ON_MAIN_THREAD=1"
    
    # Shell and JS files
    "--shell-file=${CMAKE_SOURCE_DIR}/web/shell.html"
    "--pre-js=${CMAKE_SOURCE_DIR}/web/pre.js"
    "--pre-js=${CMAKE_SOURCE_DIR}/web/socket-proxy-shared.js"
    "--js-library=${CMAKE_SOURCE_DIR}/web/socket-library.js"
)

# Apply common flags for all links (including CMake tests)
string(REPLACE ";" " " EMSCRIPTEN_COMMON_FLAGS_STR "${EMSCRIPTEN_COMMON_FLAGS}")
# Add exception catching for proper error messages and stack traces
# Add -L/usr/local/lib for zstd library and dummy port libraries (created in Dockerfile)
# Add port flags at link time so Emscripten builds pthread-enabled versions
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${EMSCRIPTEN_COMMON_FLAGS_STR} -L/usr/local/lib -fwasm-exceptions -sNO_EXIT_RUNTIME=0 -sUSE_SDL=2 -sUSE_LIBJPEG=1 -sUSE_LIBPNG=1 -sUSE_ZLIB=1 -sUSE_FREETYPE=1 -sUSE_SQLITE3=1 -sUSE_OGG=1 -sUSE_VORBIS=1")

# Enable proper C++ exception handling (compile-time flag required!)
set(EXCEPTION_FLAGS "-fwasm-exceptions")

# Emscripten port flags MUST be present during compilation for headers to work properly
# Add -fexceptions for proper C++ exception handling across WASM boundaries
# Add -pthread for threading support (must match linker flags)
# Add -I/usr/local/include for zstd headers
# Note: Debug symbols (-g) are added per build type below
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -pthread -I/usr/local/include -sUSE_SDL=2 -sUSE_LIBJPEG=1 -sUSE_LIBPNG=1 -sUSE_ZLIB=1 -sUSE_FREETYPE=1 -sUSE_SQLITE3=1")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${EXCEPTION_FLAGS} -pthread -I/usr/local/include -sUSE_SDL=2 -sUSE_LIBJPEG=1 -sUSE_LIBPNG=1 -sUSE_ZLIB=1 -sUSE_FREETYPE=1 -sUSE_SQLITE3=1")

# Store final exe flags for later use (we'll apply them to the main target only)
# Keep as a list (semicolon-separated) so CMake passes each flag separately
set(LUANTI_WEB_LINKER_FLAGS ${EMSCRIPTEN_FINAL_EXE_FLAGS} CACHE STRING "Final exe flags for Luanti web build")

# Emscripten has atomics built-in, no library needed
set(HAVE_LINK_ATOMIC FALSE CACHE BOOL "Whether atomic library is needed" FORCE)

# Compiler optimization flags per build type
# Release: Maximum performance with LTO
# Note: -ffast-math removed due to infinity/NaN usage in codebase
set(CMAKE_C_FLAGS_RELEASE "-O3 -DNDEBUG -flto -msimd128" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG -flto -msimd128" CACHE STRING "" FORCE)

# Debug: No optimization, full debug symbols with source maps
set(CMAKE_C_FLAGS_DEBUG "-O0 -g -gsource-map -msimd128" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_DEBUG "-O0 -g -gsource-map -msimd128" CACHE STRING "" FORCE)

# MinSizeRel: Optimize for smallest binary size
set(CMAKE_C_FLAGS_MINSIZEREL "-Oz -DNDEBUG -flto" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_MINSIZEREL "-Oz -DNDEBUG -flto" CACHE STRING "" FORCE)

# RelWithDebInfo: Balanced size/speed with debug info
set(CMAKE_C_FLAGS_RELWITHDEBINFO "-O2 -g -flto" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "-O2 -g -flto" CACHE STRING "" FORCE)

# Release linker flags: LTO and aggressive optimizations
# Note: --closure removed due to compatibility issues with Luanti codebase
set(CMAKE_EXE_LINKER_FLAGS_RELEASE "-O3 -flto -sAGGRESSIVE_VARIABLE_ELIMINATION=1" CACHE STRING "" FORCE)

# MinSizeRel linker flags: Maximum size reduction
# Note: --closure removed due to compatibility issues
set(CMAKE_EXE_LINKER_FLAGS_MINSIZEREL "-Oz -flto -sAGGRESSIVE_VARIABLE_ELIMINATION=1" CACHE STRING "" FORCE)

# Debug linker flags: No optimization, preserve debug info
set(CMAKE_EXE_LINKER_FLAGS_DEBUG "-O0 -g -gsource-map" CACHE STRING "" FORCE)

# Disable features not supported on web (or complex to configure initially)
set(ENABLE_LUAJIT OFF CACHE BOOL "Use LuaJIT" FORCE)
set(ENABLE_GETTEXT OFF CACHE BOOL "Use GetText for internationalization" FORCE)
set(ENABLE_REDIS OFF CACHE BOOL "Enable Redis backend" FORCE)
set(ENABLE_POSTGRESQL OFF CACHE BOOL "Enable PostgreSQL backend" FORCE)
set(ENABLE_LEVELDB OFF CACHE BOOL "Enable LevelDB backend" FORCE)
set(ENABLE_PROMETHEUS OFF CACHE BOOL "Enable Prometheus metrics" FORCE)
set(ENABLE_SOUND ON CACHE BOOL "Enable sound" FORCE)
set(ENABLE_CURL OFF CACHE BOOL "Enable cURL" FORCE)

# Graphics: Use OpenGL ES 2 (WebGL) instead of desktop OpenGL
set(ENABLE_OPENGL OFF CACHE BOOL "Enable OpenGL" FORCE)
set(ENABLE_OPENGL3 OFF CACHE BOOL "Enable OpenGL 3" FORCE)
set(ENABLE_GLES2 ON CACHE BOOL "Enable OpenGL ES 2" FORCE)

message(STATUS "=== Emscripten/WebAssembly Configuration ===")
message(STATUS "  Initial memory: 256MB, Maximum: 2GB")
message(STATUS "  WebGL 2.0 enabled")
message(STATUS "  SDL2 enabled via Emscripten")
message(STATUS "  Build type: ${CMAKE_BUILD_TYPE}")
if(CMAKE_BUILD_TYPE STREQUAL "Release")
    message(STATUS "  Optimizations: -O3 + LTO")
    message(STATUS "  Target: Maximum performance")
elseif(CMAKE_BUILD_TYPE STREQUAL "MinSizeRel")
    message(STATUS "  Optimizations: -Oz + LTO")
    message(STATUS "  Target: Minimum binary size")
elseif(CMAKE_BUILD_TYPE STREQUAL "Debug")
    message(STATUS "  Optimizations: None (-O0 + debug symbols)")
    message(STATUS "  Target: Debugging")
endif()

