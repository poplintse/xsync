import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let serverUrl = ProcessInfo.processInfo.environment["XSYNC_SERVER_URL"] ?? "https://xunit.cc/xsync"

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let button = statusItem.button {
            button.title = "xsync"
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open Authorization", action: #selector(openAuthorization), keyEquivalent: "a"))
        menu.addItem(NSMenuItem(title: "Open Web Console", action: #selector(openConsole), keyEquivalent: "w"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q"))

        for item in menu.items {
            item.target = self
        }
        statusItem.menu = menu
    }

    @objc private func openAuthorization() {
        var components = URLComponents(string: "\(serverUrl)/device/authorize")
        components?.queryItems = [
            URLQueryItem(name: "device_name", value: "macOS Menu Bar"),
            URLQueryItem(name: "platform", value: "macos"),
            URLQueryItem(name: "callback_url", value: "xsync://device-authorized")
        ]
        if let url = components?.url {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func openConsole() {
        if let url = URL(string: serverUrl) {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
