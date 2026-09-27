#!/usr/bin/env bash
# Pull the CC0 sources of the prison square into scripts/hub/.src (git-ignored).
#   Ninja Adventure Asset Pack (Pixel-boy & AAA, CC0) — a full mirror on GitHub;
#   Kenney packs (CC0) — the Tiddybub/2d-assets index, only the folders we use.
# Blob-less sparse clones: a few MB each, not the whole repositories.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .src && cd .src
if [ ! -d na ]; then
  git clone --depth 1 --filter=blob:none --sparse \
    https://github.com/discover3d/DejanPopov__NinjaAdventure-Godot4.4-GDscript na
  git -C na sparse-checkout set Assets/Backgrounds Assets/Actor/Characters Assets/Actor/Animals Assets/Items Assets/FX
fi
if [ ! -d kenney ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/Tiddybub/2d-assets kenney
  git -C kenney sparse-checkout set fantasy/roguelike-indoors fantasy/rpg-urban-pack \
    fantasy/roguelike-modern-city fantasy/tiny-town fantasy/roguelike-characters
fi
echo "sources ready in $(pwd)"
