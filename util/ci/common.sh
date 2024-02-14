#!/bin/bash -e

# Linux build only
install_linux_deps() {
	local pkgs=(
		cmake gettext postgresql
		libpng-dev libjpeg-dev libxi-dev libgl1-mesa-dev
		libsqlite3-dev libhiredis-dev libogg-dev libgmp-dev libvorbis-dev
		libopenal-dev libpq-dev libleveldb-dev libcurl4-openssl-dev libzstd-dev
		libopenxr-dev libsdl2-dev
	)

	if [[ "$1" == "--no-irr" ]]; then
		shift
	else
		local ver=$(cat misc/irrlichtmt_tag.txt)
		mkdir -p lib/irrlichtmt
		git clone https://github.com/paradust7/irrlicht lib/irrlichtmt --depth 5 -b xr
		git -C lib/irrlichtmt reset --hard "$ver"
	fi

	sudo apt-get update
	sudo apt-get install -y --no-install-recommends "${pkgs[@]}" "$@"

	sudo systemctl start postgresql.service
	sudo -u postgres psql <<<"
		CREATE USER minetest WITH PASSWORD 'minetest';
		CREATE DATABASE minetest;
	"
}

# macOS build only
install_macos_deps() {
	local pkgs=(
		cmake gettext freetype gmp jpeg-turbo jsoncpp leveldb
		libogg libpng libvorbis luajit zstd
	)
	export HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1
	export HOMEBREW_NO_INSTALL_CLEANUP=1
	# contrary to how it may look --auto-update makes brew do *less*
	brew update --auto-update
	brew install --display-times "${pkgs[@]}"
	brew unlink $(brew ls --formula)
	brew link "${pkgs[@]}"
}
