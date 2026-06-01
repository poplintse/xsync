#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <absolute-path-to-xsync-tray>" >&2
  exit 1
fi

HOST_PATH="$1"
APP_DIR="$HOME/Applications/xsync-url-handler.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
PLIST_FILE="$CONTENTS_DIR/Info.plist"
LAUNCHER="$MACOS_DIR/xsync-url-handler"

if [[ "$HOST_PATH" != /* ]]; then
  echo "Host path must be absolute." >&2
  exit 1
fi

mkdir -p "$MACOS_DIR"

cat > "$LAUNCHER" <<SH
#!/usr/bin/env bash
exec "$HOST_PATH" "\$@"
SH
chmod +x "$LAUNCHER"

cat > "$PLIST_FILE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>xsync-url-handler</string>
  <key>CFBundleIdentifier</key>
  <string>cc.xunit.xsync.url-handler</string>
  <key>CFBundleName</key>
  <string>xsync</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>xsync URL</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>xsync</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
PLIST

/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_DIR"
echo "Installed xsync URL handler at $APP_DIR"
