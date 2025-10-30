# Emscripten CMake toolchain file for Luanti
# This file configures CMake to build Luanti for WebAssembly

# Set the system name to Emscripten
set(CMAKE_SYSTEM_NAME Emscripten)
set(CMAKE_SYSTEM_VERSION 1)

# Emscripten compiler settings
if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "This toolchain file requires Emscripten. Please use 'emcmake cmake' to build.")
endif()

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

# Force static libraries (Emscripten doesn't support dynamic linking)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build shared libraries" FORCE)

# Platform-specific settings
set(EMSCRIPTEN_PLATFORM TRUE)
add_definitions(-DEMSCRIPTEN)

# Emscripten linker flags
set(EMSCRIPTEN_LINK_FLAGS
    # Memory settings
    "-sINITIAL_MEMORY=256MB"
    "-sMAXIMUM_MEMORY=2GB"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sSTACK_SIZE=5MB"
    
    # WebGL / Graphics
    "-sFULL_ES3=1"
    "-sUSE_WEBGL2=1"
    "-sMIN_WEBGL_VERSION=2"
    "-sMAX_WEBGL_VERSION=2"
    
    # SDL2 (Luanti uses SDL2)
    "-sUSE_SDL=2"
    
    # Filesystem - preload game data
    "-sFORCE_FILESYSTEM=1"
    "--preload-file=${CMAKE_SOURCE_DIR}/builtin@/builtin"
    "--preload-file=${CMAKE_SOURCE_DIR}/games@/games"
    "--preload-file=${CMAKE_SOURCE_DIR}/textures@/textures"
    "--preload-file=${CMAKE_SOURCE_DIR}/fonts@/fonts"
    
    # Threading support (experimental but useful for Luanti)
    # "-pthread"
    # "-sPTHREAD_POOL_SIZE=4"
    
    # Networking
    "-sWEBSOCKET_URL=ws://localhost:30000"
    "-sFETCH=1"
    
    # JavaScript/WASM settings
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
    "-sEXPORTED_FUNCTIONS=['_main']"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME='LuantiModule'"
    
    # Optimization and debugging
    "-sASSERTIONS=0"
    "-sALLOW_UNIMPLEMENTED_SYSCALLS=0"
    
    # Shell file
    "--shell-file=${CMAKE_SOURCE_DIR}/web/shell.html"
    
    # Pre/post JS
    "--pre-js=${CMAKE_SOURCE_DIR}/web/pre.js"
)

# Apply the link flags
string(REPLACE ";" " " EMSCRIPTEN_LINK_FLAGS_STR "${EMSCRIPTEN_LINK_FLAGS}")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${EMSCRIPTEN_LINK_FLAGS_STR}")

# Compiler optimization flags
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_DEBUG "-O0 -g -gsource-map" CACHE STRING "" FORCE)

# Disable features not supported on web
set(ENABLE_LUAJIT OFF CACHE BOOL "Use LuaJIT" FORCE)
set(ENABLE_GETTEXT OFF CACHE BOOL "Use GetText for internationalization" FORCE)
set(ENABLE_REDIS OFF CACHE BOOL "Enable Redis backend" FORCE)
set(ENABLE_POSTGRESQL OFF CACHE BOOL "Enable PostgreSQL backend" FORCE)
set(ENABLE_LEVELDB OFF CACHE BOOL "Enable LevelDB backend" FORCE)
set(ENABLE_PROMETHEUS OFF CACHE BOOL "Enable Prometheus metrics" FORCE)

message(STATUS "Configuring for Emscripten/WebAssembly build")
message(STATUS "  Initial memory: 256MB, Maximum: 2GB")
message(STATUS "  WebGL 2.0 enabled")
message(STATUS "  SDL2 enabled via Emscripten")

