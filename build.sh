#!/bin/bash
# Build both apps, and optionally install them into ~/.claude.
#
#   ./build.sh            compile only, binaries land next to their sources
#   ./build.sh install    compile, then copy everything into ~/.claude
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "编译 clawd（学习陪伴）…"
swiftc -O -o clawd/clawd clawd/ClawdStudy.swift shared/Clawd.swift -framework AppKit

echo "编译 claude-pet（Claude Code 进度挂件）…"
swiftc -O -o pet/claude-pet pet/ClaudePet.swift shared/Clawd.swift -framework AppKit

[ "$1" = "install" ] || { echo "编译完成。加 install 参数可安装到 ~/.claude"; exit 0; }

mkdir -p ~/.claude/clawd ~/.claude/pet ~/.claude/shared
cp clawd/clawd clawd/clawd.sh clawd/ClawdStudy.swift ~/.claude/clawd/
cp pet/claude-pet pet/pet.sh pet/ClaudePet.swift pet/label.jq pet/todo.jq ~/.claude/pet/
cp shared/Clawd.swift ~/.claude/shared/
chmod +x ~/.claude/clawd/clawd.sh ~/.claude/pet/pet.sh
echo "装好了。跑 ~/.claude/clawd/clawd.sh start"
