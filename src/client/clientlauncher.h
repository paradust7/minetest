// Luanti
// SPDX-License-Identifier: LGPL-2.1-or-later
// Copyright (C) 2010-2013 celeron55, Perttu Ahola <celeron55@gmail.com>

#pragma once

#include <string>

class ChatBackend;

class RenderingEngine;
class Settings;
class MyEventReceiver;
class InputHandler;
struct GameStartData;
struct MainMenuData;
class FrameMarker;

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
	void init_joysticks();

	static void setting_changed_callback(const std::string &name, void *data);
	void config_guienv();

	void launch_game(std::function<void(bool)> resolve);
	void after_main_menu(std::function<void(bool)> resolve);

	void main_menu(std::function<void()> resolve);
	void main_menu_wait_loop(std::function<void()> resolve);
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
	volatile std::sig_atomic_t *kill = nullptr;
	FrameMarker *framemarker = nullptr;

	// locals for launch_game
	std::string server_name;
	std::string server_description;
	MainMenuData *menudata_addr = nullptr;
};
