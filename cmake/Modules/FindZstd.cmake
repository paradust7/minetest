mark_as_advanced(ZSTD_LIBRARY ZSTD_INCLUDE_DIR)

# Emscripten provides Zstd as a port - set paths before searching
if(CMAKE_SYSTEM_NAME STREQUAL "Emscripten")
	set(ZSTD_INCLUDE_DIR "${EMSCRIPTEN_ROOT_PATH}/system/include" CACHE PATH "Zstd include directory" FORCE)
	set(ZSTD_LIBRARY "zstd" CACHE STRING "Zstd library" FORCE)
	message(STATUS "Using Emscripten Zstd port")
else()
	find_path(ZSTD_INCLUDE_DIR NAMES zstd.h)
	find_library(ZSTD_LIBRARY NAMES zstd)

	if(ZSTD_INCLUDE_DIR AND ZSTD_LIBRARY)
		# Check that the API we use exists
		include(CheckSymbolExists)
		unset(HAVE_ZSTD_INITCSTREAM CACHE)
		set(CMAKE_REQUIRED_INCLUDES ${ZSTD_INCLUDE_DIR})
		set(CMAKE_REQUIRED_LIBRARIES ${ZSTD_LIBRARY})
		check_symbol_exists(ZSTD_initCStream zstd.h HAVE_ZSTD_INITCSTREAM)
		unset(CMAKE_REQUIRED_INCLUDES)
		unset(CMAKE_REQUIRED_LIBRARIES)

		if(NOT HAVE_ZSTD_INITCSTREAM)
			unset(ZSTD_INCLUDE_DIR CACHE)
			unset(ZSTD_LIBRARY CACHE)
		endif()
	endif()
endif()

include(FindPackageHandleStandardArgs)
find_package_handle_standard_args(Zstd DEFAULT_MSG ZSTD_LIBRARY ZSTD_INCLUDE_DIR)

