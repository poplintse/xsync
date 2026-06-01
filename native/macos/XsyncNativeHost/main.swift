import Foundation
import Security

let service = "xsync"
let refreshAccount = "refresh_token"
let serverAccount = "server_url"

if CommandLine.arguments.count > 1, CommandLine.arguments[1].hasPrefix("xsync://") {
    handleCallback(CommandLine.arguments[1])
    exit(0)
}

runNativeMessagingHost()

func runNativeMessagingHost() {
    while true {
        guard let message = readNativeMessage() else { return }
        let response = handleMessage(message)
        writeNativeMessage(response)
    }
}

func handleMessage(_ data: Data) -> [String: Any] {
    guard
        let object = try? JSONSerialization.jsonObject(with: data),
        let request = object as? [String: Any],
        let type = request["type"] as? String
    else {
        return ["ok": false, "error": "invalid_request"]
    }

    switch type {
    case "ping":
        return ["ok": true, "type": "pong"]
    case "startAuthorization":
        let serverUrl = stringValue(request["serverUrl"]) ?? stringValue(request["server_url"]) ?? readSecret(serverAccount) ?? "https://xunit.cc/xsync"
        let deviceName = stringValue(request["deviceName"]) ?? stringValue(request["device_name"]) ?? "Chrome Extension"
        let platform = stringValue(request["platform"]) ?? "chrome"
        return startAuthorization(serverUrl: serverUrl, deviceName: deviceName, platform: platform)
    case "exchangeAuthorizationCode":
        guard let code = stringValue(request["code"]) else {
            return ["ok": false, "error": "missing_code"]
        }
        let serverUrl = stringValue(request["serverUrl"]) ?? stringValue(request["server_url"]) ?? readSecret(serverAccount) ?? "https://xunit.cc/xsync"
        return exchangeAuthorizationCode(serverUrl: serverUrl, code: code)
    case "getAccessToken":
        let serverUrl = stringValue(request["serverUrl"]) ?? stringValue(request["server_url"]) ?? readSecret(serverAccount) ?? "https://xunit.cc/xsync"
        return getAccessToken(serverUrl: serverUrl)
    default:
        return ["ok": false, "error": "unknown_message_type"]
    }
}

func startAuthorization(serverUrl: String, deviceName: String, platform: String) -> [String: Any] {
    saveSecret(serverAccount, serverUrl)
    var components = URLComponents(string: "\(trimTrailingSlash(serverUrl))/device/authorize")
    components?.queryItems = [
        URLQueryItem(name: "device_name", value: deviceName),
        URLQueryItem(name: "platform", value: platform),
        URLQueryItem(name: "callback_url", value: "xsync://device-authorized")
    ]
    guard let url = components?.url else {
        return ["ok": false, "error": "invalid_authorization_url"]
    }

    let opened = Process.launchedProcess(launchPath: "/usr/bin/open", arguments: [url.absoluteString])
    opened.waitUntilExit()
    return ["ok": true, "authUrl": url.absoluteString, "opened": opened.terminationStatus == 0]
}

func getAccessToken(serverUrl: String) -> [String: Any] {
    if let envToken = ProcessInfo.processInfo.environment["XSYNC_ACCESS_TOKEN"], !envToken.isEmpty {
        return ["ok": true, "accessToken": envToken]
    }
    guard let refreshToken = readSecret(refreshAccount), !refreshToken.isEmpty else {
        return ["ok": false, "error": "not_authorized"]
    }
    switch refreshDeviceToken(serverUrl: serverUrl, refreshToken: refreshToken) {
    case .success(let token):
        saveSecret(refreshAccount, token.refreshToken)
        saveSecret(serverAccount, serverUrl)
        return ["ok": true, "accessToken": token.accessToken]
    case .failure(let error):
        return ["ok": false, "error": error.description]
    }
}

func exchangeAuthorizationCode(serverUrl: String, code: String) -> [String: Any] {
    let url = "\(trimTrailingSlash(serverUrl))/api/device/authorize/finish"
    switch postJson(url: url, body: ["code": code]) {
    case .success(let object):
        guard let token = TokenResponse(object) else {
            return ["ok": false, "error": "invalid_token_response"]
        }
        saveSecret(refreshAccount, token.refreshToken)
        saveSecret(serverAccount, serverUrl)
        return ["ok": true, "accessToken": token.accessToken, "device": token.device ?? [:], "user": token.user ?? [:]]
    case .failure(let error):
        return ["ok": false, "error": error.description]
    }
}

func refreshDeviceToken(serverUrl: String, refreshToken: String) -> Result<TokenResponse, XsyncError> {
    let url = "\(trimTrailingSlash(serverUrl))/api/device/token/refresh"
    return postJson(url: url, body: ["refresh_token": refreshToken]).flatMap { object in
        guard let token = TokenResponse(object) else {
            return .failure(XsyncError("invalid_token_response"))
        }
        return .success(token)
    }
}

func handleCallback(_ callback: String) {
    guard
        let components = URLComponents(string: callback),
        components.scheme == "xsync",
        components.host == "device-authorized",
        let code = components.queryItems?.first(where: { $0.name == "code" })?.value
    else {
        return
    }
    let serverUrl = readSecret(serverAccount) ?? "https://xunit.cc/xsync"
    _ = exchangeAuthorizationCode(serverUrl: serverUrl, code: code)
}

func postJson(url: String, body: [String: String]) -> Result<[String: Any], XsyncError> {
    guard let endpoint = URL(string: url) else {
        return .failure(XsyncError("invalid_url"))
    }
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)

    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<[String: Any], XsyncError> = .failure(XsyncError("request_not_started"))
    URLSession.shared.dataTask(with: request) { data, response, error in
        defer { semaphore.signal() }
        if let error {
            result = .failure(XsyncError("request_failed: \(error.localizedDescription)"))
            return
        }
        guard let http = response as? HTTPURLResponse else {
            result = .failure(XsyncError("invalid_response"))
            return
        }
        guard (200..<300).contains(http.statusCode) else {
            result = .failure(XsyncError("http_\(http.statusCode)"))
            return
        }
        guard
            let data,
            let object = try? JSONSerialization.jsonObject(with: data),
            let dictionary = object as? [String: Any]
        else {
            result = .failure(XsyncError("invalid_json"))
            return
        }
        result = .success(dictionary)
    }.resume()
    semaphore.wait()
    return result
}

struct XsyncError: Error, CustomStringConvertible {
    let description: String

    init(_ description: String) {
        self.description = description
    }
}

struct TokenResponse {
    let accessToken: String
    let refreshToken: String
    let device: [String: Any]?
    let user: [String: Any]?

    init?(_ object: [String: Any]) {
        guard
            let accessToken = object["access_token"] as? String,
            let refreshToken = object["refresh_token"] as? String
        else {
            return nil
        }
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.device = object["device"] as? [String: Any]
        self.user = object["user"] as? [String: Any]
    }
}

func readNativeMessage() -> Data? {
    let input = FileHandle.standardInput
    let lengthData = input.readData(ofLength: 4)
    if lengthData.count == 0 { return nil }
    if lengthData.count != 4 { return nil }
    let length = lengthData.withUnsafeBytes { pointer in
        pointer.load(as: UInt32.self).littleEndian
    }
    return input.readData(ofLength: Int(length))
}

func writeNativeMessage(_ object: [String: Any]) {
    let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data(#"{"ok":false,"error":"serialization_failed"}"#.utf8)
    var length = UInt32(data.count).littleEndian
    let lengthData = Data(bytes: &length, count: 4)
    FileHandle.standardOutput.write(lengthData)
    FileHandle.standardOutput.write(data)
}

@discardableResult
func saveSecret(_ account: String, _ value: String) -> Bool {
    let data = Data(value.utf8)
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account
    ]
    let attributes: [String: Any] = [kSecValueData as String: data]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecSuccess { return true }
    if status != errSecItemNotFound { return false }

    var addQuery = query
    addQuery[kSecValueData as String] = data
    return SecItemAdd(addQuery as CFDictionary, nil) == errSecSuccess
}

func readSecret(_ account: String) -> String? {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else {
        return nil
    }
    guard let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
}

func stringValue(_ value: Any?) -> String? {
    value as? String
}

func trimTrailingSlash(_ value: String) -> String {
    String(value.drop { _ in false }).replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
}
