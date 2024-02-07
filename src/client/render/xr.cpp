/*
Minetest
Copyright (C) 2010-2013 celeron55, Perttu Ahola <celeron55@gmail.com>
Copyright (C) 2017 numzero, Lobachevskiy Vitaliy <numzer0@yandex.ru>

This program is free software; you can redistribute it and/or modify
it under the terms of the GNU Lesser General Public License as published by
the Free Software Foundation; either version 2.1 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public License along
with this program; if not, write to the Free Software Foundation, Inc.,
51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
*/

#include "client/client.h"
#include "client/camera.h"
#include "pipeline.h"
#include "plain.h"
#include "XrViewInfo.h"

#include <memory>

extern uint64_t XrFrameCounter;

using std::unique_ptr;

class XrPipeline : public RenderStep
{
public:
	XrPipeline(unique_ptr<RenderStep>&& draw3d) : m_draw3d(std::move(draw3d)) {}
        virtual void setRenderSource(RenderSource *) override {}
        virtual void setRenderTarget(RenderTarget *target) override {}

        virtual void reset(PipelineContext &context) override {}
        virtual void run(PipelineContext &context) override;
private:
	unique_ptr<RenderStep> m_draw3d;
};

void XrPipeline::run(PipelineContext &context)
{
	auto device = context.device;
	auto driver = device->getVideoDriver();

	if (!device->beginFrame())
		return;

	auto oldScreenSize = driver->getScreenSize();
	auto oldViewPort = driver->getViewPort();

	scene::ICameraSceneNode* cameraNode = context.client->getCamera()->getCameraNode();
	core::vector3df oldCameraPos = cameraNode->getPosition();
	core::vector3df oldCameraRot = cameraNode->getRotation();
	f32 oldFovUp, oldFovDown, oldFovRight, oldFovLeft;
	f32 oldNear, oldFar;
	cameraNode->getFOV(&oldFovUp, &oldFovDown, &oldFovRight, &oldFovLeft);
	oldNear = cameraNode->getNearValue();
	oldFar = cameraNode->getFarValue();

	// Ignore the pitch given by mouse movement.
	if (g_settings->getBool("xr_pitchlock")) {
		core::vector3df levelForward = oldCameraRot.rotationToDirection();
		levelForward.Y = 0;
		levelForward.normalize();
		core::vector3df levelRotation = levelForward.getHorizontalAngle();
		cameraNode->setRotation(levelRotation);
		cameraNode->setUpVector(levelRotation.rotationToDirection(core::vector3df(0, 1, 0)));
	}

	core::matrix4 baseTransform = cameraNode->getRelativeTransformation();
	core::matrix4 move;
	core::quaternion baseRotation(cameraNode->getRotation() * core::DEGTORAD);

	core::XrViewInfo info;
	while (device->nextView(&info)) {
		driver->setRenderTargetEx(info.Target, video::ECBF_ALL, context.clear_color);
		driver->OnResize(core::dimension2du(info.Width, info.Height));

		// Scale device coordinates by BS
		core::vector3df scaledPosition = info.Position * BS;
		move.setTranslation(scaledPosition);
		auto finalPos = (move * baseTransform).getTranslation();
		cameraNode->setPosition(finalPos);
		cameraNode->updateAbsolutePosition();

		core::vector3df euler;
		(info.Orientation * baseRotation).toEulerDeg(euler);
		cameraNode->setRotation(euler);
		cameraNode->setUpVector(euler.rotationToDirection(core::vector3df(0, 1, 0)));

		cameraNode->setNearValue(info.ZNear);
		cameraNode->setFarValue(info.ZFar);
		cameraNode->setFOV(info.AngleUp, info.AngleDown, info.AngleRight, info.AngleLeft);
		m_draw3d->run(context);
/*
TODO(paradust): Add as a debug feature
		gui::IGUIFont *font = device->getGUIEnvironment()->getBuiltInFont();
		if (!font) {
			std::cout << "font is NULL" << std::endl;
		} else {
			wchar_t buf[256];
			swprintf(buf, 256, L"F%u", (unsigned int)XrFrameCounter);
			font->draw(buf,
				core::rect<s32>(info.Width/2, info.Height/2, info.Width/2 + 100, info.Height/2 + 100),
				video::SColor(255, 255, 255, 255));
		}
*/
	}
	// Reset to screen
	driver->setRenderTarget(nullptr, video::ECBF_NONE);
	driver->OnResize(oldScreenSize);
	driver->setViewPort(oldViewPort);
	// Reset camera
	cameraNode->setPosition(oldCameraPos);
	cameraNode->setRotation(oldCameraRot);
	cameraNode->setNearValue(oldNear);
	cameraNode->setFarValue(oldFar);
	cameraNode->setFOV(oldFovUp, oldFovDown, oldFovRight, oldFovLeft);
}


void populateXrPipeline(RenderPipeline *pipeline, Client *client)
{
	unique_ptr<RenderStep> draw3d(new Draw3D());
        pipeline->addStep<XrPipeline>(std::move(draw3d));
}
