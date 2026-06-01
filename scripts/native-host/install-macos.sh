#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <extension-id> <absolute-path-to-xsync-tray>" >&2
  exit 1
fi

EXTENSION_ID="$1"
HOST_PATH="$2"
HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
HOST_FILE="$HOST_DIR/com.xunit.xsync.json"

if [[ "$HOST_PATH" != /* ]]; then
  echo "Host path must be absolute." >&2
  exit 1
fi

mkdir -p "$HOST_DIR"

cat > "$HOST_FILE" <<JSON
{
  "name": "com.xunit.xsync",
  "description": "xsync native messaging host",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
JSON

echo "Installed $HOST_FILE"
