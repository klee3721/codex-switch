import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = CodexSwitchAppModel()
    private var statusBarController: StatusBarController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)
        if let icon = makeRuntimeAppIcon() {
            NSApplication.shared.applicationIconImage = icon
        }
        statusBarController = StatusBarController(model: model)
    }
}

@main
struct CodexSwitchMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Window("Codex Switch Manager", id: "manager") {
            ManagerWindowView()
                .environmentObject(appDelegate.model)
        }
        .defaultSize(width: 920, height: 580)
    }
}
