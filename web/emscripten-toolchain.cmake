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

# LIBSPATIALINDEX - manually compiled with pthread support (in /usr/local)
set(SPATIAL_FOUND TRUE CACHE BOOL "SpatialIndex found")
set(SPATIAL_INCLUDE_DIR "/usr/local/include" CACHE PATH "SpatialIndex include directory")
set(SPATIAL_LIBRARY "/usr/local/lib/libspatialindex.a" CACHE FILEPATH "SpatialIndex library")
set(USE_SPATIAL TRUE CACHE BOOL "Use SpatialIndex")

# PNG - Emscripten port (handled by -sUSE_LIBPNG=1 at link time)
set(PNG_FOUND TRUE)
set(PNG_PNG_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include")
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
set(SQLITE3_LIBRARY "sqlite3")
set(SQLITE3_LIBRARIES "sqlite3")

# OpenAL - Emscripten port (handled by -sUSE_OPENAL=1 at link time)
set(OPENAL_FOUND TRUE CACHE BOOL "OpenAL found")
set(OPENAL_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include" CACHE PATH "OpenAL include directory")
set(OPENAL_LIBRARY "openal" CACHE STRING "OpenAL library")
set(OPENAL_LIBRARIES "${OPENAL_LIBRARY}" CACHE STRING "OpenAL libraries")

# Ogg - Emscripten port (handled by -sUSE_OGG=1 at link time)
set(OGG_FOUND TRUE CACHE BOOL "Ogg found")
set(OGG_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include" CACHE PATH "Ogg include directory")
set(OGG_LIBRARY "ogg" CACHE STRING "Ogg library")
set(OGG_LIBRARIES "${OGG_LIBRARY}" CACHE STRING "Ogg libraries")

# Vorbis - Emscripten port (handled by -sUSE_VORBIS=1 at link time)
set(VORBIS_FOUND TRUE CACHE BOOL "Vorbis found")
set(VORBIS_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include" CACHE PATH "Vorbis include directory")
set(VORBIS_LIBRARY "vorbis" CACHE STRING "Vorbis library")
set(VORBISFILE_LIBRARY "vorbis" CACHE STRING "Vorbisfile library (same as vorbis in Emscripten)")
set(VORBIS_LIBRARIES "${VORBIS_LIBRARY}" CACHE STRING "Vorbis libraries")

# Zstd - manually compiled with pthread support (in /usr/local)
set(ZSTD_FOUND TRUE CACHE BOOL "Zstd found")
set(ZSTD_INCLUDE_DIR "/usr/local/include" CACHE PATH "Zstd include directory")
set(ZSTD_INCLUDE_DIRS "${ZSTD_INCLUDE_DIR}" CACHE PATH "Zstd include directories")
set(ZSTD_LIBRARY "/usr/local/lib/libzstd.a" CACHE FILEPATH "Zstd library")
set(ZSTD_LIBRARIES "${ZSTD_LIBRARY}" CACHE STRING "Zstd libraries")

# Force static libraries (Emscripten doesn't support dynamic linking)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build shared libraries" FORCE)

# Platform-specific settings
set(EMSCRIPTEN_PLATFORM TRUE)
set(EMSCRIPTEN TRUE)

# Emscripten linker flags - split into common and final-exe-only flags
# Common flags (safe for CMake tests)
set(EMSCRIPTEN_COMMON_FLAGS
    # Memory settings
    "-sINITIAL_MEMORY=2GB"
    "-sMAXIMUM_MEMORY=4GB"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sALLOW_TABLE_GROWTH=1"
    "-sSTACK_SIZE=10MB"
    "-sDEFAULT_PTHREAD_STACK_SIZE=2MB"
    
    # WebGL / Graphics
    "-sFULL_ES3=1"
    "-sUSE_WEBGL2=1"
    "-sMIN_WEBGL_VERSION=2"
    "-sMAX_WEBGL_VERSION=2"
    
    # SDL2 (Luanti uses SDL2)
    "-sUSE_SDL=2"
    
    # Filesystem
    "-sWASMFS=1"
    "-sFORCE_FILESYSTEM"

    # Malloc
    "-sMALLOC=mimalloc"
    
    # Networking
    "-sFETCH=1"
    
    # Debug and Error Reporting (reduced verbosity for performance)
    "-sASSERTIONS=0"
    "-sSTACK_OVERFLOW_CHECK=0"
    "-sALLOW_UNIMPLEMENTED_SYSCALLS=1"
    "-sERROR_ON_UNDEFINED_SYMBOLS=0"
    "-sRUNTIME_DEBUG=0"
    
    # Asyncify (JSPI) and Threading settings
    "-sJSPI=1"
    "-sASYNCIFY_STACK_SIZE=8MB"
    "-sJSPI_EXPORTS=['_main']"
    "-sJSPI_IMPORTS=['emscripten_sleep','emscripten_yield','emscripten_main_loop_helper','emscripten_asm_const_int','emscripten_asm_const_double','emscripten_asm_const_void','emscripten_scan_registers','getaddrinfo','emscripten_getaddrinfo']"
    "-sALLOW_BLOCKING_ON_MAIN_THREAD=0"
    "-pthread"
    "-sPTHREAD_POOL_SIZE=20"
    "-sPROXY_TO_PTHREAD=1"
    "-sOFFSCREEN_FRAMEBUFFER=0"
    "-sOFFSCREENCANVAS_SUPPORT=1"
    "-sOFFSCREENCANVASES_TO_PTHREAD=\"#canvas\""
    "-sGL_WORKAROUND_SAFARI_GETCONTEXT_BUG=0"
    "-sSUPPORT_LONGJMP=wasm"
    
    "-sENVIRONMENT=web,worker"
    "-sDEFAULT_TO_CXX=1"
)

# Additional compile flags for SDL2
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -DEMSCRIPTEN_SDL2_MAIN_LOOP")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DEMSCRIPTEN_SDL2_MAIN_LOOP")

# These flags should ONLY be applied to the final executable, not CMake tests
set(EMSCRIPTEN_FINAL_EXE_FLAGS
    # Preload game data (can't be used during CMake tests)
    # With WASMFS=1, we preload directly to /userdata where Luanti expects them
    "--preload-file=${CMAKE_SOURCE_DIR}/builtin@/userdata/builtin"
    "--preload-file=${CMAKE_SOURCE_DIR}/games@/userdata/games"
    "--preload-file=${CMAKE_SOURCE_DIR}/textures@/userdata/textures"
    "--preload-file=${CMAKE_SOURCE_DIR}/fonts@/userdata/fonts"
    "--preload-file=${CMAKE_SOURCE_DIR}/client@/userdata/client"
    
    # JavaScript/WASM settings
    "-sEXPORTED_RUNTIME_METHODS=['callMain','ccall','cwrap','FS','ENV','GL','stringToNewUTF8']"
    "-sEXPORTED_FUNCTIONS=['_main','_SDL_SetClipboardText','_free']"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME='LuantiModule'"
    
    # Shell and JS files
    "--shell-file=${CMAKE_SOURCE_DIR}/web/shell.html"
    "--pre-js=${CMAKE_SOURCE_DIR}/web/pre.js"
    "--pre-js=${CMAKE_SOURCE_DIR}/web/socket-proxy-shared.js"
)

# Apply common flags for all links (including CMake tests)
string(REPLACE ";" " " EMSCRIPTEN_COMMON_FLAGS_STR "${EMSCRIPTEN_COMMON_FLAGS}")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${EMSCRIPTEN_COMMON_FLAGS_STR} -L/usr/local/lib -fwasm-exceptions -sNO_EXIT_RUNTIME=0 -sUSE_SDL=2 -sUSE_LIBJPEG=1 -sUSE_LIBPNG=1 -sUSE_ZLIB=1 -sUSE_FREETYPE=1 -sUSE_SQLITE3=1 -sUSE_OGG=1 -sUSE_VORBIS=1")

# Enable C++ exception handling
set(EXCEPTION_FLAGS "-fwasm-exceptions")

# CRITICAL: -sSUPPORT_LONGJMP must be in compile flags (not just linker flags)!
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${EXCEPTION_FLAGS} -pthread -mbulk-memory -mnontrapping-fptoint -sSUPPORT_LONGJMP=wasm -I/usr/local/include -sUSE_SDL=2 -sUSE_LIBJPEG=1 -sUSE_LIBPNG=1 -sUSE_ZLIB=1 -sUSE_FREETYPE=1 -sUSE_SQLITE3=1 -sUSE_OGG=1 -sUSE_VORBIS=1")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${EXCEPTION_FLAGS} -pthread -mbulk-memory -mnontrapping-fptoint -sSUPPORT_LONGJMP=wasm -I/usr/local/include -sUSE_SDL=2 -sUSE_LIBJPEG=1 -sUSE_LIBPNG=1 -sUSE_ZLIB=1 -sUSE_FREETYPE=1 -sUSE_SQLITE3=1 -sUSE_OGG=1 -sUSE_VORBIS=1")

# Store final exe flags for later use (we'll apply them to the main target only)
# Keep as a list (semicolon-separated) so CMake passes each flag separately
set(LUANTI_WEB_LINKER_FLAGS ${EMSCRIPTEN_FINAL_EXE_FLAGS} CACHE STRING "Final exe flags for Luanti web build")

# Compiler optimization flags per build type
set(CMAKE_C_FLAGS_RELEASE "-O3 -DNDEBUG -flto -msimd128" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG -flto -msimd128" CACHE STRING "" FORCE)
set(CMAKE_EXE_LINKER_FLAGS_RELEASE "-O3 -flto" CACHE STRING "" FORCE)

# Debug: No optimization, full debug symbols with source maps
set(CMAKE_C_FLAGS_DEBUG "-O0 -g -gsource-map -msimd128" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_DEBUG "-O0 -g -gsource-map -msimd128" CACHE STRING "" FORCE)
set(CMAKE_EXE_LINKER_FLAGS_DEBUG "-O0 -g -gsource-map" CACHE STRING "" FORCE)

# MinSizeRel: Optimize for smallest binary size
set(CMAKE_C_FLAGS_MINSIZEREL "-Oz -DNDEBUG -flto" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_MINSIZEREL "-Oz -DNDEBUG -flto" CACHE STRING "" FORCE)
set(CMAKE_EXE_LINKER_FLAGS_MINSIZEREL "-Oz -flto -sAGGRESSIVE_VARIABLE_ELIMINATION=1" CACHE STRING "" FORCE)

# RelWithDebInfo: Balanced size/speed with debug info
set(CMAKE_C_FLAGS_RELWITHDEBINFO "-O2 -g -flto" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "-O2 -g -flto" CACHE STRING "" FORCE)

# Disable features not supported on web (or complex to configure initially)
set(HAVE_LINK_ATOMIC FALSE CACHE BOOL "Whether atomic library is needed" FORCE)
set(ENABLE_LUAJIT OFF CACHE BOOL "Use LuaJIT" FORCE)
set(ENABLE_GETTEXT OFF CACHE BOOL "Use GetText for internationalization" FORCE)
set(ENABLE_REDIS OFF CACHE BOOL "Enable Redis backend" FORCE)
set(ENABLE_POSTGRESQL OFF CACHE BOOL "Enable PostgreSQL backend" FORCE)
set(ENABLE_LEVELDB OFF CACHE BOOL "Enable LevelDB backend" FORCE)
set(ENABLE_PROMETHEUS OFF CACHE BOOL "Enable Prometheus metrics" FORCE)
set(ENABLE_SOUND ON CACHE BOOL "Enable sound" FORCE)
set(ENABLE_CURL OFF CACHE BOOL "Enable cURL" FORCE)
set(ENABLE_OPENSSL OFF CACHE BOOL "Use OpenSSL" FORCE)

# Graphics: Use OpenGL ES 2 (WebGL) instead of desktop OpenGL
set(ENABLE_OPENGL OFF CACHE BOOL "Enable OpenGL" FORCE)
set(ENABLE_OPENGL3 OFF CACHE BOOL "Enable OpenGL 3" FORCE)
set(ENABLE_GLES2 ON CACHE BOOL "Enable OpenGL ES 2" FORCE)

message(STATUS "=== Emscripten/WebAssembly Configuration ===")
message(STATUS "  Initial memory: 2GB, Maximum: 4GB")
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

