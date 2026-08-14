#!/usr/bin/env sh
set -eu

SOURCE="${1:-ontheoasis13/MyWhiteBoard}"
REF="${2:-v0.2.0-alpha.1}"

if [ -d "$SOURCE" ]; then
  codex plugin marketplace add "$SOURCE"
else
  codex plugin marketplace add "$SOURCE" --ref "$REF"
fi
codex plugin add my-whiteboard@my-whiteboard

echo "My Whiteboard is installed. Start a new Codex task to use it."
