#!/bin/bash -e

cmake -B build \
	-DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE:-Release} \
	-DRUN_IN_PLACE=TRUE \
	-DENABLE_LUAJIT=TRUE \
	-DENABLE_GETTEXT=TRUE \
	-DBUILD_SHARED_LIBS=FALSE \
	${CMAKE_FLAGS}

cmake --build build --parallel $(($(nproc) + 1))
