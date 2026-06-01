# xsync Native Messaging Contract

Chrome extension connects to:

```text
com.xunit.xsync
```

## Messages

### ping

Request:

```json
{
  "type": "ping"
}
```

Response:

```json
{
  "ok": true,
  "type": "pong"
}
```

### getAccessToken

Request:

```json
{
  "type": "getAccessToken"
}
```

Response:

```json
{
  "ok": true,
  "accessToken": "short-lived-token"
}
```

If no token exists:

```json
{
  "ok": false,
  "error": "not_authorized"
}
```

Development fallback:

- The current tray skeleton returns `XSYNC_ACCESS_TOKEN` from the environment if present.
- Production should store refresh token in macOS Keychain / Windows Credential Manager and call `/xsync/api/device/token/refresh`.

### startAuthorization

Request:

```json
{
  "type": "startAuthorization",
  "serverUrl": "https://xunit.cc/xsync",
  "deviceName": "Chrome Extension",
  "platform": "chrome"
}
```

Expected behavior:

1. Tray app opens the browser to `/xsync/device/authorize`.
2. User logs in through xsso.
3. xsync redirects to the tray app URL scheme.
4. Tray app exchanges the one-time code for device tokens.
5. Refresh token is stored in the OS credential store.

Current skeleton response:

```json
{
  "ok": true,
  "authUrl": "https://xunit.cc/xsync/device/authorize?device_name=Chrome%20Extension&platform=chrome",
  "opened": true
}
```

## Server Token Refresh

The tray app should use:

```http
POST /xsync/api/device/token/refresh
Content-Type: application/json

{
  "refresh_token": "stored-refresh-token"
}
```

Successful response:

```json
{
  "access_token": "new-access-token",
  "refresh_token": "new-refresh-token",
  "token_type": "Bearer"
}
```

Refresh tokens are rotated. The old refresh token becomes invalid after a successful refresh.
