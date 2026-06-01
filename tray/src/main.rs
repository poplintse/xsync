use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::io::{self, Read, Write};
use url::Url;

const SERVICE: &str = "xsync";
const ACCOUNT_REFRESH_TOKEN: &str = "refresh_token";
const ACCOUNT_SERVER_URL: &str = "server_url";

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum NativeRequest {
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "getAccessToken")]
    GetAccessToken {
        #[serde(default)]
        server_url: Option<String>,
        #[serde(default)]
        serverUrl: Option<String>,
    },
    #[serde(rename = "startAuthorization")]
    StartAuthorization {
        #[serde(default)]
        server_url: Option<String>,
        #[serde(default)]
        serverUrl: Option<String>,
        #[serde(default)]
        device_name: Option<String>,
        #[serde(default)]
        deviceName: Option<String>,
        #[serde(default)]
        platform: Option<String>,
    },
    #[serde(rename = "exchangeAuthorizationCode")]
    ExchangeAuthorizationCode {
        code: String,
        #[serde(default)]
        server_url: Option<String>,
        #[serde(default)]
        serverUrl: Option<String>,
    },
}

#[derive(Debug, Deserialize, Serialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    token_type: String,
    #[serde(default)]
    device: Value,
    #[serde(default)]
    user: Value,
}

fn main() -> io::Result<()> {
    if let Some(arg) = env::args().nth(1) {
        if arg.starts_with("xsync://") {
            handle_url_callback(&arg);
            return Ok(());
        }
    }

    run_native_host()
}

fn run_native_host() -> io::Result<()> {
    loop {
        let Some(message) = read_native_message()? else {
            return Ok(());
        };
        let response = handle_native_message(&message);
        write_native_message(response.to_string().as_bytes())?;
    }
}

fn handle_native_message(message: &[u8]) -> Value {
    let request = serde_json::from_slice::<NativeRequest>(message);
    match request {
        Ok(NativeRequest::Ping) => json!({ "ok": true, "type": "pong" }),
        Ok(NativeRequest::GetAccessToken { server_url, serverUrl }) => {
            match get_access_token(resolve_server_url(server_url, serverUrl)) {
                Ok(token) => json!({ "ok": true, "accessToken": token }),
                Err(error) => json!({ "ok": false, "error": error }),
            }
        }
        Ok(NativeRequest::StartAuthorization {
            server_url,
            serverUrl,
            device_name,
            deviceName,
            platform,
        }) => {
            let server_url = resolve_server_url(server_url, serverUrl);
            let device_name = device_name.or(deviceName).unwrap_or_else(|| "Chrome Extension".to_string());
            let platform = platform.unwrap_or_else(|| "chrome".to_string());
            match start_authorization(&server_url, &device_name, &platform) {
                Ok((auth_url, opened)) => json!({ "ok": true, "authUrl": auth_url, "opened": opened }),
                Err(error) => json!({ "ok": false, "error": error }),
            }
        }
        Ok(NativeRequest::ExchangeAuthorizationCode { code, server_url, serverUrl }) => {
            let server_url = resolve_server_url(server_url, serverUrl);
            match exchange_authorization_code(&server_url, &code) {
                Ok(token) => json!({ "ok": true, "accessToken": token.access_token, "device": token.device, "user": token.user }),
                Err(error) => json!({ "ok": false, "error": error }),
            }
        }
        Err(error) => json!({ "ok": false, "error": format!("invalid_request: {error}") }),
    }
}

fn start_authorization(server_url: &str, device_name: &str, platform: &str) -> Result<(String, bool), String> {
    store_secret(ACCOUNT_SERVER_URL, server_url)?;
    let mut url = Url::parse(&format!("{}/device/authorize", trim_trailing_slash(server_url)))
        .map_err(|error| format!("invalid_server_url: {error}"))?;
    url.query_pairs_mut()
        .append_pair("device_name", device_name)
        .append_pair("platform", platform)
        .append_pair("callback_url", "xsync://device-authorized");
    let auth_url = url.to_string();
    let opened = open::that(&auth_url).is_ok();
    Ok((auth_url, opened))
}

fn get_access_token(server_url: String) -> Result<String, String> {
    if let Ok(token) = env::var("XSYNC_ACCESS_TOKEN") {
        if !token.trim().is_empty() {
            return Ok(token);
        }
    }

    let refresh_token = read_secret(ACCOUNT_REFRESH_TOKEN)?;
    let token = refresh_device_token(&server_url, &refresh_token)?;
    store_secret(ACCOUNT_REFRESH_TOKEN, &token.refresh_token)?;
    store_secret(ACCOUNT_SERVER_URL, &server_url)?;
    Ok(token.access_token)
}

fn exchange_authorization_code(server_url: &str, code: &str) -> Result<TokenResponse, String> {
    let client = reqwest::blocking::Client::new();
    let response = client
        .post(format!("{}/api/device/authorize/finish", trim_trailing_slash(server_url)))
        .json(&json!({ "code": code }))
        .send()
        .map_err(|error| format!("request_failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("authorization_failed: {}", response.status()));
    }
    let token = response
        .json::<TokenResponse>()
        .map_err(|error| format!("invalid_token_response: {error}"))?;
    store_secret(ACCOUNT_REFRESH_TOKEN, &token.refresh_token)?;
    store_secret(ACCOUNT_SERVER_URL, server_url)?;
    Ok(token)
}

fn refresh_device_token(server_url: &str, refresh_token: &str) -> Result<TokenResponse, String> {
    let client = reqwest::blocking::Client::new();
    let response = client
        .post(format!("{}/api/device/token/refresh", trim_trailing_slash(server_url)))
        .json(&json!({ "refresh_token": refresh_token }))
        .send()
        .map_err(|error| format!("request_failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("refresh_failed: {}", response.status()));
    }
    response
        .json::<TokenResponse>()
        .map_err(|error| format!("invalid_token_response: {error}"))
}

fn handle_url_callback(callback: &str) {
    let Ok(url) = Url::parse(callback) else {
        return;
    };
    if url.scheme() != "xsync" || url.host_str() != Some("device-authorized") {
        return;
    }
    let Some(code) = url.query_pairs().find(|(key, _)| key == "code").map(|(_, value)| value.to_string()) else {
        return;
    };
    let server_url = read_secret(ACCOUNT_SERVER_URL).unwrap_or_else(|_| "https://xunit.cc/xsync".to_string());
    let _ = exchange_authorization_code(&server_url, &code);
}

fn resolve_server_url(primary: Option<String>, secondary: Option<String>) -> String {
    primary
        .or(secondary)
        .or_else(|| read_secret(ACCOUNT_SERVER_URL).ok())
        .unwrap_or_else(|| "https://xunit.cc/xsync".to_string())
}

fn store_secret(account: &str, value: &str) -> Result<(), String> {
    Entry::new(SERVICE, account)
        .map_err(|error| format!("keyring_unavailable: {error}"))?
        .set_password(value)
        .map_err(|error| format!("keyring_write_failed: {error}"))
}

fn read_secret(account: &str) -> Result<String, String> {
    Entry::new(SERVICE, account)
        .map_err(|error| format!("keyring_unavailable: {error}"))?
        .get_password()
        .map_err(|_| "not_authorized".to_string())
}

fn read_native_message() -> io::Result<Option<Vec<u8>>> {
    let mut length_bytes = [0_u8; 4];
    match io::stdin().read_exact(&mut length_bytes) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }

    let length = u32::from_le_bytes(length_bytes) as usize;
    let mut message = vec![0_u8; length];
    io::stdin().read_exact(&mut message)?;
    Ok(Some(message))
}

fn write_native_message(message: &[u8]) -> io::Result<()> {
    let length = message.len() as u32;
    io::stdout().write_all(&length.to_le_bytes())?;
    io::stdout().write_all(message)?;
    io::stdout().flush()
}

fn trim_trailing_slash(value: &str) -> String {
    value.trim_end_matches('/').to_string()
}
