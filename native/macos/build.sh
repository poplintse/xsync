#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="$ROOT_DIR/dist/macos/xsync.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
HOST_PATH="$ROOT_DIR/dist/macos/xsync-native-host"

mkdir -p "$MACOS_DIR"
swiftc "$ROOT_DIR/native/macos/XsyncMenuBar/main.swift" -o "$MACOS_DIR/XsyncMenuBar"
swiftc "$ROOT_DIR/native/macos/XsyncNativeHost/main.swift" -o "$HOST_PATH"
cp "$ROOT_DIR/native/macos/XsyncMenuBar/Info.plist" "$CONTENTS_DIR/Info.plist"

echo "Built $APP_DIR"
echo "Built $HOST_PATH"
