/*
Minetest
Copyright (C) 2010-2013 celeron55, Perttu Ahola <celeron55@gmail.com>

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

#pragma once

#include "irrlichttypes_extrabloated.h"
#include "client/inputhandler.h"
#include "gameparams.h"
#include "chat.h"

class RenderingEngine;

class ClientLauncher
{
public:
	ClientLauncher(GameStartData &start_data_, const Settings &cmd_args_)
        : start_data(start_data_),
          cmd_args(cmd_args_) {
	}

	~ClientLauncher();

	void run(std::function<void(bool)> resolve);
	void run_loop(std::function<void(bool)> resolve);
	void run_after_launch_game(std::function<void(bool)> resolve, bool should_run_game);
	void run_cleanup(std::function<void(bool)> resolve);
	void after_the_game(std::function<void(bool)> resolve);

private:
	void init_args(GameStartData &start_data, const Settings &cmd_args);
	bool init_engine();
	void init_input();
	void init_guienv(gui::IGUIEnvironment *guienv);

	void launch_game(std::function<void(bool)> resolve);
	void after_main_menu(std::function<void(bool)> resolve);

	void main_menu(std::function<void()> resolve);
	void main_menu_loop(std::function<void()> resolve);
	void main_menu_after_loop(std::function<void()> resolve);
	void main_menu_after_guiengine(std::function<void()> resolve);

	GameStartData &start_data;
	const Settings &cmd_args;

	bool skip_main_menu = false;
	bool random_input = false;
	RenderingEngine *m_rendering_engine = nullptr;
	InputHandler *input = nullptr;
	MyEventReceiver *receiver = nullptr;
	ChatBackend *chat_backend = nullptr;
	bool reconnect_requested = false;
	std::string error_message;
	bool first_loop = true;
	bool retval = true;
	bool *kill = nullptr;

	// locals for launch_game
	std::string server_name;
	std::string server_description;
	MainMenuData *menudata_addr = nullptr;
};
