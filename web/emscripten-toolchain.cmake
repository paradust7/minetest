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

# PNG - Emscripten port
set(PNG_FOUND TRUE)
set(PNG_PNG_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include")
set(PNG_LIBRARY "png")
set(PNG_LIBRARIES "${PNG_LIBRARY}")

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
set(FREETYPE_LIBRARY "freetype")
set(FREETYPE_LIBRARIES "${FREETYPE_LIBRARY}")

# SQLite3 - built-in to Emscripten
set(SQLITE3_FOUND TRUE)
set(SQLITE3_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include")
set(SQLITE3_LIBRARY "sqlite3")
set(SQLITE3_LIBRARIES "${SQLITE3_LIBRARY}")

# Force static libraries (Emscripten doesn't support dynamic linking)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build shared libraries" FORCE)

# Platform-specific settings
set(EMSCRIPTEN_PLATFORM TRUE)
add_definitions(-DEMSCRIPTEN)

# Emscripten linker flags - split into common and final-exe-only flags
# Common flags (safe for CMake tests)
set(EMSCRIPTEN_COMMON_FLAGS
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
    
    # Filesystem
    "-sFORCE_FILESYSTEM=1"
    
    # Networking
    "-sFETCH=1"
    
    # Optimization
    "-sASSERTIONS=0"
    "-sALLOW_UNIMPLEMENTED_SYSCALLS=0"
)

# These flags should ONLY be applied to the final executable, not CMake tests
set(EMSCRIPTEN_FINAL_EXE_FLAGS
    # Preload game data (can't be used during CMake tests)
    "--preload-file=${CMAKE_SOURCE_DIR}/builtin@/builtin"
    "--preload-file=${CMAKE_SOURCE_DIR}/games@/games"
    "--preload-file=${CMAKE_SOURCE_DIR}/textures@/textures"
    "--preload-file=${CMAKE_SOURCE_DIR}/fonts@/fonts"
    
    # JavaScript/WASM settings
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
    "-sEXPORTED_FUNCTIONS=['_main']"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME='LuantiModule'"
    "-sWEBSOCKET_URL=ws://localhost:30000"
    
    # Shell and JS files
    "--shell-file=${CMAKE_SOURCE_DIR}/web/shell.html"
    "--pre-js=${CMAKE_SOURCE_DIR}/web/pre.js"
)

# Apply common flags for all links (including CMake tests)
string(REPLACE ";" " " EMSCRIPTEN_COMMON_FLAGS_STR "${EMSCRIPTEN_COMMON_FLAGS}")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${EMSCRIPTEN_COMMON_FLAGS_STR}")

# Store final exe flags for later use (we'll apply them to the main target only)
string(REPLACE ";" " " EMSCRIPTEN_FINAL_EXE_FLAGS_STR "${EMSCRIPTEN_FINAL_EXE_FLAGS}")
set(LUANTI_WEB_LINKER_FLAGS "${EMSCRIPTEN_FINAL_EXE_FLAGS_STR}" CACHE STRING "Final exe flags for Luanti web build")

# Emscripten has atomics built-in, no library needed
set(HAVE_LINK_ATOMIC FALSE CACHE BOOL "Whether atomic library is needed" FORCE)

# Compiler optimization flags
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_DEBUG "-O0 -g -gsource-map" CACHE STRING "" FORCE)

# Disable features not supported on web (or complex to configure initially)
set(ENABLE_LUAJIT OFF CACHE BOOL "Use LuaJIT" FORCE)
set(ENABLE_GETTEXT OFF CACHE BOOL "Use GetText for internationalization" FORCE)
set(ENABLE_REDIS OFF CACHE BOOL "Enable Redis backend" FORCE)
set(ENABLE_POSTGRESQL OFF CACHE BOOL "Enable PostgreSQL backend" FORCE)
set(ENABLE_LEVELDB OFF CACHE BOOL "Enable LevelDB backend" FORCE)
set(ENABLE_PROMETHEUS OFF CACHE BOOL "Enable Prometheus metrics" FORCE)
set(ENABLE_SOUND OFF CACHE BOOL "Enable sound" FORCE)
set(ENABLE_CURL OFF CACHE BOOL "Enable cURL" FORCE)

# Graphics: Use OpenGL ES 2 (WebGL) instead of desktop OpenGL
set(ENABLE_OPENGL OFF CACHE BOOL "Enable OpenGL" FORCE)
set(ENABLE_OPENGL3 OFF CACHE BOOL "Enable OpenGL 3" FORCE)
set(ENABLE_GLES2 ON CACHE BOOL "Enable OpenGL ES 2" FORCE)

message(STATUS "Configuring for Emscripten/WebAssembly build")
message(STATUS "  Initial memory: 256MB, Maximum: 2GB")
message(STATUS "  WebGL 2.0 enabled")
message(STATUS "  SDL2 enabled via Emscripten")

