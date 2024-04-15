#ifdef _IRR_COMPILE_WITH_XR_DEVICE_

// See createSession() for why this is needed.
#if defined(WIN32)
#	define XR_USE_PLATFORM_WIN32
#	define XR_USE_GRAPHICS_API_OPENGL
#elif defined(_IRR_COMPILE_WITH_OGLES1_) || defined(_IRR_COMPILE_WITH_OGLES2_)
#	define XR_USE_PLATFORM_EGL
#	define XR_USE_GRAPHICS_API_OPENGL_ES
#elif defined(__ANDROID__)
#	error "Irrlicht XR driver does not support Android"
#elif defined(__APPLE__)
#	error "Irrlicht XR driver does not support MacOSX / iOS"
#else
#	define XR_USE_PLATFORM_XLIB
#	define XR_USE_GRAPHICS_API_OPENGL
#endif

// Headers required for openxr_platform.h

#ifdef XR_USE_PLATFORM_WIN32
#	define WIN32_LEAN_AND_MEAN
#	include <Unknwn.h>
#	include <windows.h>
#endif

#ifdef XR_USE_PLATFORM_XLIB
#	include <X11/Xlib.h>
#	include <GL/glx.h>
#endif

#ifdef XR_USE_PLATFORM_EGL
#	error "TODO: EGL headers"
#endif

#ifdef XR_USE_GRAPHICS_API_OPENGL
#	include <GL/gl.h>
#	include <GL/glext.h>
#endif

#include <openxr/openxr.h>
#include <openxr/openxr_platform.h>

#endif // _IRR_COMPILE_WITH_XR_DEVICE_
