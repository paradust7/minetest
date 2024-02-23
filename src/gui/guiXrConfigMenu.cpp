/*
Part of Minetest
Copyright (C) 2013 celeron55, Perttu Ahola <celeron55@gmail.com>
Copyright (C) 2013 Ciaran Gultnieks <ciaran@ciarang.com>
Copyright (C) 2013 RealBadAngel, Maciej Kasatkin <mk@realbadangel.pl>

Permission to use, copy, modify, and distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
*/

#include "guiXrConfigMenu.h"
#include "debug.h"
#include "guiButton.h"
#include "guiScrollBar.h"
#include "serialization.h"
#include <algorithm>
#include <string>
#include <IGUICheckBox.h>
#include <IGUIButton.h>
#include <IGUIStaticText.h>
#include <IGUIFont.h>
#include "settings.h"

#include "gettext.h"

const int ID_xrConfigVipdText = 270;
const int ID_xrConfigExitButton = 271;
const int ID_xrConfigVipdSlider = 265;

GUIXRConfigMenu::GUIXRConfigMenu(gui::IGUIEnvironment* env,
		gui::IGUIElement* parent, s32 id,
		IMenuManager *menumgr, ISimpleTextureSource *tsrc
):
	GUIModalMenu(env, parent, id, menumgr),
	m_tsrc(tsrc)
{
}

void GUIXRConfigMenu::regenerateGui(v2u32 screensize)
{
	/*
		Remove stuff
	*/
	removeAllChildren();
	/*
		Calculate new sizes and positions
	*/
	const float s = m_gui_scale;
	DesiredRect = core::rect<s32>(
		screensize.X / 2 - 380 * s / 2,
		screensize.Y / 2 - 200 * s / 2,
		screensize.X / 2 + 380 * s / 2,
		screensize.Y / 2 + 200 * s / 2
	);
	recalculateAbsolutePosition(false);

	v2s32 size = DesiredRect.getSize();
	int vipd = (int)(g_settings->getFloat("xr_vipd") * 100);
	vipd = std::clamp(vipd, 50, 200);

	/*
		Add stuff
	*/
	{
		core::rect<s32> rect(0, 0, 300 * s, 20 * s);
		rect = rect + v2s32(size.X / 2 - 150 * s, size.Y / 2 - 70 * s);

		StaticText::add(Environment, fwgettext("Virtual IPD Scale: %d%%", vipd),
				rect, false, true, this, ID_xrConfigVipdText);
	}
	{
		core::rect<s32> rect(0, 0, 100 * s, 30 * s);
		rect = rect + v2s32(size.X / 2 - 100 * s / 2, size.Y / 2 + 55 * s);
		GUIButton::addButton(Environment, rect, m_tsrc, this, ID_xrConfigExitButton,
				wstrgettext("Exit").c_str());
	}
	{
		core::rect<s32> rect(0, 0, 300 * s, 20 * s);
		rect = rect + v2s32(size.X / 2 - 150 * s, size.Y / 2);
		auto e = make_irr<GUIScrollBar>(Environment, this,
				ID_xrConfigVipdSlider, rect, true, false, m_tsrc);
		e->setMax(150);
		e->setPos(vipd - 50);
	}
/*
	{
		core::rect<s32> rect(0, 0, 300 * s, 20 * s);
		rect = rect + v2s32(size.X / 2 - 150 * s, size.Y / 2 - 35 * s);
		Environment->addCheckBox(g_settings->getBool("mute_sound"), rect, this,
				ID_soundMuteButton, wstrgettext("Muted").c_str());
	}
*/
}

void GUIXRConfigMenu::drawMenu()
{
	gui::IGUISkin* skin = Environment->getSkin();
	if (!skin)
		return;
	video::IVideoDriver* driver = Environment->getVideoDriver();
	video::SColor bgcolor(140, 0, 0, 0);
	driver->draw2DRectangle(bgcolor, AbsoluteRect, &AbsoluteClippingRect);
	gui::IGUIElement::draw();
}

bool GUIXRConfigMenu::OnEvent(const SEvent& event)
{
	if (event.EventType == EET_KEY_INPUT_EVENT) {
		if (event.KeyInput.Key == KEY_ESCAPE && event.KeyInput.PressedDown) {
			quitMenu();
			return true;
		}

		if (event.KeyInput.Key == KEY_RETURN && event.KeyInput.PressedDown) {
			quitMenu();
			return true;
		}
	} else if (event.EventType == EET_GUI_EVENT) {
/*
		if (event.GUIEvent.EventType == gui::EGET_CHECKBOX_CHANGED) {
			gui::IGUIElement *e = getElementFromId(ID_soundMuteButton);
			if (e != NULL && e->getType() == gui::EGUIET_CHECK_BOX) {
				g_settings->setBool("mute_sound", ((gui::IGUICheckBox*)e)->isChecked());
			}

			Environment->setFocus(this);
			return true;
		}
*/

		if (event.GUIEvent.EventType == gui::EGET_BUTTON_CLICKED) {
			if (event.GUIEvent.Caller->getID() == ID_xrConfigExitButton) {
				quitMenu();
				return true;
			}
			Environment->setFocus(this);
		}

		if (event.GUIEvent.EventType == gui::EGET_ELEMENT_FOCUS_LOST
				&& isVisible()) {
			if (!canTakeFocus(event.GUIEvent.Element)) {
				infostream << "GUIXRConfigMenu: Not allowing focus change."
				<< std::endl;
				// Returning true disables focus change
				return true;
			}
		}
		if (event.GUIEvent.EventType == gui::EGET_SCROLL_BAR_CHANGED) {
			if (event.GUIEvent.Caller->getID() == ID_xrConfigVipdSlider) {
				s32 pos = static_cast<GUIScrollBar *>(event.GUIEvent.Caller)->getPos();
				int vipd = 50 + std::clamp(pos, 0, 150);

				g_settings->setFloat("xr_vipd", (float) vipd / 100);

				gui::IGUIElement *e = getElementFromId(ID_xrConfigVipdText);
				e->setText(fwgettext("Virtual IPD Scale: %d%%", vipd).c_str());
				return true;
			}
		}

	}

	return Parent ? Parent->OnEvent(event) : false;
}
