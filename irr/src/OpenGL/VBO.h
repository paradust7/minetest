// Copyright (C) 2024 sfan5
// This file is part of the "Irrlicht Engine".
// For conditions of distribution and use, see copyright notice in irrlicht.h

#pragma once

#include "Common.h"
#include <cstddef>

namespace video
{

class OpenGLVBO
{
public:
	/// @note does not create on GL side
	/// @param target GL buffer target (GL_ARRAY_BUFFER or GL_ELEMENT_ARRAY_BUFFER)
	OpenGLVBO(GLenum target = GL_ARRAY_BUFFER) : m_target(target) {}
	/// @note does not free on GL side
	~OpenGLVBO() = default;

	/// @return "name" (ID) of this buffer in GL
	GLuint getName() const { return m_name; }
	/// @return does this refer to an existing GL buffer?
	bool exists() const { return m_name != 0; }

	/// @return size of this buffer in bytes
	size_t getSize() const { return m_size; }
	
	/// @return GL buffer target (GL_ARRAY_BUFFER or GL_ELEMENT_ARRAY_BUFFER)
	GLenum getTarget() const { return m_target; }

	/**
	 * Upload buffer data to GL.
	 *
	 * Changing the size of the buffer is only possible when `offset == 0`.
	 * @param data data pointer
	 * @param size number of bytes
	 * @param offset offset to upload at
	 * @param usage usage pattern passed to GL (only if buffer is new)
	 * @param mustShrink force re-create of buffer if it became smaller
	 * @note modifies buffer binding for this VBO's target
	 */
	void upload(const void *data, size_t size, size_t offset,
		GLenum usage, bool mustShrink = false);

	/**
	 * Free buffer in GL.
	 * @note modifies buffer binding for this VBO's target
	 */
	void destroy();

private:
	GLuint m_name = 0;
	size_t m_size = 0;
	GLenum m_target = GL_ARRAY_BUFFER;  // WebGL-safe: separate buffers for vertices vs indices
};

}
