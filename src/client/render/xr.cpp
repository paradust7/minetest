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

struct ViewState : public RenderPipelineObject
{
	core::XrViewInfo info;
};

struct CameraState : public RenderPipelineObject
{
	core::vector3df cameraPos;
	core::vector3df cameraRot;
	f32 fovUp, fovDown, fovRight, fovLeft;
	f32 znear, zfar;
	// These are computed values
	core::matrix4 baseTransform;
	core::quaternion baseRotation;
};

class XrTarget : public RenderTarget
{
public:
	XrTarget() = delete;
	XrTarget(ViewState* viewState) : view(viewState) {}
	virtual void activate(PipelineContext &context) override
	{
		auto driver = context.device->getVideoDriver();
		driver->setRenderTargetEx(view->info.Target, video::ECBF_ALL, context.clear_color);
		driver->OnResize(core::dimension2du(view->info.Width, view->info.Height));
	}
private:
	ViewState* view;
};

class SaveCameraState : public RenderStep
{
public:
	SaveCameraState() = delete;
	SaveCameraState(CameraState* camState) : state(camState) {}

	virtual void setRenderSource(RenderSource *source) override {}
	virtual void setRenderTarget(RenderTarget *target) override {}

	virtual void reset(PipelineContext &) override {}

	virtual void run(PipelineContext &context) override
	{
		scene::ICameraSceneNode* cameraNode = context.client->getCamera()->getCameraNode();
		state->cameraPos = cameraNode->getPosition();
		state->cameraRot = cameraNode->getRotation();
		cameraNode->getFOV(&state->fovUp, &state->fovDown, &state->fovRight, &state->fovLeft);
		state->znear = cameraNode->getNearValue();
		state->zfar = cameraNode->getFarValue();
		state->baseTransform = cameraNode->getRelativeTransformation();
		state->baseRotation = core::quaternion(cameraNode->getRotation() * core::DEGTORAD);
	};

private:
	CameraState* state;
};

class RestoreCameraState : public RenderStep
{
public:
	RestoreCameraState() = delete;
	RestoreCameraState(CameraState* camState) : state(camState) {}

	virtual void setRenderSource(RenderSource *source) override {}
	virtual void setRenderTarget(RenderTarget *target) override {}

	virtual void reset(PipelineContext &) override {}

	virtual void run(PipelineContext &context) override {
		scene::ICameraSceneNode* cameraNode = context.client->getCamera()->getCameraNode();
		cameraNode->setPosition(state->cameraPos);
		cameraNode->setRotation(state->cameraRot);
		cameraNode->setNearValue(state->znear);
		cameraNode->setFarValue(state->zfar);
		cameraNode->setFOV(state->fovUp, state->fovDown, state->fovRight, state->fovLeft);
	}
private:
	CameraState* state;
};

class XrForEachView : public RenderStep {
public:
	XrForEachView(ViewState *viewState, RenderStep* renderView)
		: view(viewState), render_view(renderView) {}

        virtual void setRenderSource(RenderSource *) override {}
        virtual void setRenderTarget(RenderTarget *target) override {}

        virtual void reset(PipelineContext &context) override {}
        virtual void run(PipelineContext &context) override {
		auto device = context.device;
		if (!device->beginFrame())
			return;

		auto driver = device->getVideoDriver();
		auto oldScreenSize = driver->getScreenSize();
		auto oldViewPort = driver->getViewPort();
		v2u32 old_target_size = context.target_size;
		while (device->nextView(&view->info)) {
			context.target_size = v2u32(view->info.Width, view->info.Height);
			render_view->reset(context);
			render_view->run(context);
		}
		context.target_size = old_target_size;

		// Reset driver
		driver->setRenderTarget(nullptr, video::ECBF_NONE);
		driver->OnResize(oldScreenSize);
		driver->setViewPort(oldViewPort);
	}
private:
	ViewState* view;
	RenderStep* render_view;
};

//! Setup the camera for rendering to an XR view target
class XrSetupCamera : public RenderStep
{
public:
	XrSetupCamera(const CameraState* camState, const ViewState* viewState)
		: cam(camState), view(viewState) {}

	virtual void setRenderSource(RenderSource *source) override {}
	virtual void setRenderTarget(RenderTarget *target) override {}

	virtual void reset(PipelineContext &) override {}

	virtual void run(PipelineContext &context) override
	{
		scene::ICameraSceneNode* cameraNode = context.client->getCamera()->getCameraNode();
		const auto& info = view->info;

		core::vector3df adjPos = info.Position * BS;
		cam->baseTransform.transformVect(adjPos);

		core::quaternion adjRot = info.Orientation * cam->baseRotation;

		// Scale device coordinates by BS
		cameraNode->setPosition(adjPos);
		cameraNode->updateAbsolutePosition();

		core::vector3df euler;
		adjRot.toEulerDeg(euler);
		cameraNode->setRotation(euler);
		cameraNode->setUpVector(euler.rotationToDirection(core::vector3df(0, 1, 0)));
		cameraNode->setNearValue(info.ZNear);
		cameraNode->setFarValue(info.ZFar);
		cameraNode->setFOV(info.AngleUp, info.AngleDown, info.AngleRight, info.AngleLeft);
		cameraNode->updateMatrices();
	}
private:
	const CameraState* cam;
	const ViewState* view;
};

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

static unique_ptr<RenderStep> createRenderViewPipeline(Client *client, CameraState *camState, ViewState *viewState)
{
	unique_ptr<RenderPipeline> inner(new RenderPipeline());
	RenderStep* draw3d = inner->own(create3DStage(client, v2f(1.0f, 1.0f)));
	RenderTarget* target = inner->createOwned<XrTarget>(viewState);
	inner->addStep<XrSetupCamera>(camState, viewState);
	inner->addStep(draw3d);
	draw3d->setRenderTarget(target);
	return inner;
}

void populateXrPipeline(RenderPipeline *pipeline, Client *client)
{
	CameraState* camState = pipeline->createOwned<CameraState>();
	ViewState* viewState = pipeline->createOwned<ViewState>();
	RenderStep* renderView = pipeline->own(createRenderViewPipeline(client, camState, viewState));
	pipeline->addStep<SaveCameraState>(camState);
	pipeline->addStep<XrForEachView>(viewState, renderView);
	pipeline->addStep<RestoreCameraState>(camState);
}
