mark_as_advanced(SQLITE3_LIBRARY SQLITE3_INCLUDE_DIR)

# Emscripten provides SQLite3 built-in - set paths before searching
if(CMAKE_SYSTEM_NAME STREQUAL "Emscripten")
	set(SQLITE3_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include" CACHE PATH "SQLite3 include directory" FORCE)
	set(SQLITE3_LIBRARY "EMSCRIPTEN_PORT" CACHE STRING "SQLite3 library (handled by Emscripten port system)" FORCE)
	message(STATUS "Using Emscripten SQLite3 port (via -sUSE_SQLITE3=1)")
else()
	find_path(SQLITE3_INCLUDE_DIR sqlite3.h)
	
	find_library(SQLITE3_LIBRARY NAMES sqlite3)
endif()

include(FindPackageHandleStandardArgs)
find_package_handle_standard_args(SQLite3 DEFAULT_MSG SQLITE3_LIBRARY SQLITE3_INCLUDE_DIR)

