# xsync

Self-hosted Chrome bookmark sync. The lite version uses an API token as the
account identifier: clients with the same token sync within the same account.

Current scaffold includes:

- `src/server`: zero-dependency Node.js server.
- `extension`: Chrome Manifest V3 extension options page.
- `tray`: minimal Rust Native Messaging skeleton.
- `docs`: architecture and Native Messaging contract.

## Run the Server Locally

```sh
AUTH_MODE=api_token XSYNC_PORT=8792 XSYNC_BASE_PATH=/xsync-lite XSYNC_COOKIE_SECURE=false npm run dev:server
```

Open:

```text
http://127.0.0.1:8792/xsync-lite/
```

In lite mode, no xsso configuration is required. Generate a long random token,
for example:

```sh
openssl rand -hex 32
```

Configure that token in every client that should share an account. The server
stores only its SHA-256 hash. A different or mistyped token creates a separate
account.

The full device authorization flow remains available by setting
`AUTH_MODE=sso_ticket` and configuring:

- `XSSO_BASE_URL`
- `XSSO_APP_CODE`
- `XSSO_APP_SECRET`
- `XSSO_LOGIN_URL`

## Load the Chrome Extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load unpacked extension from `extension/`.
4. Open the xsync extension options page.
5. The production server URL defaults to `https://xunit.cc/xsync-lite/`. Use
   `http://127.0.0.1:8792/xsync-lite/` for local development.
6. Choose an existing token name and enter its token, or generate and name a
   new token. The server lists token names but never returns raw tokens.
7. Select one bookmark folder or bookmark. Its full bookmark path becomes the
   remote collection name.

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

The native shells are retained for the full `sso_ticket` device authorization
flow. The lite Chrome extension does not require them.

## Test

```sh
npm test
```

The test starts a temporary local xsync server on a random port and verifies:

- API token account sharing and isolation
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
