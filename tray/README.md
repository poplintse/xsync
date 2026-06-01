# xsync Tray App

The tray app is intentionally tiny. It will eventually provide:

- macOS menu bar / Windows tray entry.
- Native Messaging host for the Chrome extension.
- Device authorization callback handling.
- Secure token storage in macOS Keychain / Windows Credential Manager.

Current implementation is only the Native Messaging stdio skeleton. It supports:

```json
{"type":"ping"}
```

and returns:

```json
{"ok":true,"type":"pong"}
```

It also supports:

```json
{"type":"getAccessToken"}
```

For development, it returns the `XSYNC_ACCESS_TOKEN` environment variable if set. Otherwise it returns:

```json
{"ok":false,"error":"not_authorized"}
```

and:

```json
{"type":"startAuthorization","serverUrl":"https://xunit.cc/xsync","deviceName":"Chrome Extension","platform":"chrome"}
```

which currently returns the authorization URL instead of opening it directly.

The implementation now stores refresh tokens through the OS credential store via `keyring`, refreshes access tokens with `/api/device/token/refresh`, and can handle `xsync://device-authorized?code=...` callback URLs.

The visible tray menu and packaged app installers are still pending. The current environment does not have Rust installed, so this source has not been compiled locally in Codex.
