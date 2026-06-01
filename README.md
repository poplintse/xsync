# xsync

Self-hosted Chrome bookmark sync managed by xsso.

Current scaffold includes:

- `src/server`: zero-dependency Node.js server.
- `extension`: Chrome Manifest V3 extension options page.
- `tray`: minimal Rust Native Messaging skeleton.
- `docs`: architecture and Native Messaging contract.

## Run the Server Locally

```sh
AUTH_MODE=local XSYNC_PORT=8791 XSYNC_COOKIE_SECURE=false npm run dev:server
```

Open:

```text
http://127.0.0.1:8791/xsync/
```

In production, set `AUTH_MODE=sso_ticket` and configure:

- `XSSO_BASE_URL`
- `XSSO_APP_CODE`
- `XSSO_APP_SECRET`
- `XSSO_LOGIN_URL`

## Load the Chrome Extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load unpacked extension from `extension/`.
4. Open the xsync extension options page.
5. Use `http://127.0.0.1:8791/xsync` as the server URL for local development.

Until the tray app stores tokens in the OS credential store, use the server device authorization page to create a code, call `/api/device/authorize/finish`, and paste the returned access token into the extension.

The extension now tries Native Messaging first:

```text
com.xunit.xsync -> {"type":"getAccessToken"}
```

If the tray app is not installed or does not return a token yet, the manually pasted access token remains the development fallback. The current tray skeleton can also return `XSYNC_ACCESS_TOKEN` from its environment for local Native Messaging testing.

## Install Native Messaging Host

After building `xsync-tray`, install the Chrome Native Messaging host manifest.

macOS:

```sh
native/macos/build.sh
scripts/native-host/install-macos.sh <chrome-extension-id> /Users/iclawtse/workspace/projects/xsync/dist/macos/xsync-native-host
```

Windows PowerShell:

```powershell
scripts/native-host/install-windows.ps1 -ExtensionId <chrome-extension-id> -HostPath C:\absolute\path\xsync-tray.exe
```

Install the `xsync://` callback handler too.

macOS:

```sh
scripts/native-host/install-macos-url-scheme.sh /Users/iclawtse/workspace/projects/xsync/dist/macos/xsync-native-host
```

Windows PowerShell:

```powershell
scripts/native-host/install-windows-url-scheme.ps1 -HostPath C:\absolute\path\xsync-tray.exe
```

## Build Native Shells

macOS menu bar app:

```sh
native/macos/build.sh
```

This also builds the macOS Native Messaging host at `dist/macos/xsync-native-host`.

Windows tray app:

```powershell
native/windows/build.ps1
```

The visible tray/menu app opens xsync authorization and console pages. On macOS, credential-sensitive token exchange is handled by the Swift Native Messaging host at `dist/macos/xsync-native-host`. The Rust host remains as a cross-platform target for later packaging.

## Test

```sh
npm test
```

The test starts a temporary local xsync server on a random port and verifies:

- local login callback
- device authorization code creation
- access token issuance
- refresh token rotation
- local-over-server sync upload
- collection listing

## Docker

```sh
docker compose up --build
```

The compose file binds the service to `127.0.0.1:8791` by default and stores data in `../data/xsync`.
