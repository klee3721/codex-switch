import AppKit
import SwiftUI

func appLaunchActivationPolicy() -> NSApplication.ActivationPolicy {
    .accessory
}

@MainActor
@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    private static var sharedDelegate: AppDelegate?

    let model = CodexSwitchAppModel()
    private var managerWindow: NSWindow?
    private var statusBarController: StatusBarController?

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        sharedDelegate = delegate
        app.delegate = delegate
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(appLaunchActivationPolicy())
        if let icon = makeRuntimeAppIcon() {
            NSApplication.shared.applicationIconImage = icon
        }
        statusBarController = StatusBarController(model: model) { [weak self] in
            self?.showManagerWindow()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showManagerWindow()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    private func showManagerWindow() {
        if managerWindow == nil {
            let hostingController = NSHostingController(
                rootView: ManagerWindowView()
                    .environmentObject(model)
            )
            let window = NSWindow(contentViewController: hostingController)
            window.title = "Codex Switch Manager"
            window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
            window.setContentSize(NSSize(width: 920, height: 580))
            window.isReleasedWhenClosed = false
            window.center()
            managerWindow = window
        }

        NSApplication.shared.setActivationPolicy(appLaunchActivationPolicy())
        managerWindow?.makeKeyAndOrderFront(nil)
        managerWindow?.orderFrontRegardless()
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
}
