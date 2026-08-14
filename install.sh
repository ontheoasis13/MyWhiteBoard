#!/usr/bin/env sh
set -eu

SOURCE="${1:-ontheoasis13/MyWhiteBoard}"
REF="${2:-main}"

codex plugin marketplace add "$SOURCE" --ref "$REF"
codex plugin add my-whiteboard@my-whiteboard

echo "My Whiteboard is installed. Start a new Codex task to use it."
