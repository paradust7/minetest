// Copyright (C) 2024 sfan5
// This file is part of the "Irrlicht Engine".
// For conditions of distribution and use, see copyright notice in irrlicht.h

#include "VBO.h"

#include <cassert>
#include <mt_opengl.h>

namespace video
{

void OpenGLVBO::upload(const void *data, size_t size, size_t offset,
		GLenum usage, bool mustShrink)
{
	bool newBuffer = false;
	assert(!(mustShrink && offset > 0)); // forbidden usage
	if (!m_name) {
		GL.GenBuffers(1, &m_name);
		if (!m_name)
			return;
		newBuffer = true;
	} else if (size > m_size || mustShrink) {
		newBuffer = size != m_size;
	}

#ifdef __EMSCRIPTEN__
	// WebGL-safe: Use the target this VBO was created for
	GL.BindBuffer(m_target, m_name);
#else
	GL.BindBuffer(GL_ARRAY_BUFFER, m_name);
#endif

	if (newBuffer) {
		assert(offset == 0);
#ifdef __EMSCRIPTEN__
		GL.BufferData(m_target, size, data, usage);
#else
		GL.BufferData(GL_ARRAY_BUFFER, size, data, usage);
#endif
		m_size = size;
	} else {
#ifdef __EMSCRIPTEN__
		GL.BufferSubData(m_target, offset, size, data);
#else
		GL.BufferSubData(GL_ARRAY_BUFFER, offset, size, data);
#endif
	}

#ifdef __EMSCRIPTEN__
	GL.BindBuffer(m_target, 0);
#else
	GL.BindBuffer(GL_ARRAY_BUFFER, 0);
#endif
}

void OpenGLVBO::destroy()
{
	if (m_name) {
		// Note: DeleteBuffers doesn't require the buffer to be bound to any specific target
		GL.DeleteBuffers(1, &m_name);
	}
	m_name = 0;
	m_size = 0;
}

}
