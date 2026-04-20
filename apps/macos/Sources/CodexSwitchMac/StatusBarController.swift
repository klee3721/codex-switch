import AppKit
import SwiftUI

@MainActor
final class StatusBarController: NSObject {
    private static let itemWidth: CGFloat = 38

    private let statusItem: NSStatusItem
    private let popover: NSPopover
    private let model: CodexSwitchAppModel
    private let hostingView: NSHostingView<AnyView>
    private let statusMenu: NSMenu

    init(model: CodexSwitchAppModel) {
        self.model = model
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        self.popover = NSPopover()
        self.statusMenu = NSMenu()
        self.hostingView = NSHostingView(
            rootView: AnyView(StatusBarLabelView().environmentObject(model))
        )
        super.init()
        configureMenu()
        configureStatusItem()
        configurePopover()
    }

    @objc
    func togglePopover(_ sender: Any?) {
        guard let button = statusItem.button else { return }

        if popover.isShown {
            popover.performClose(sender)
            return
        }

        let anchorRect = NSRect(
            x: button.bounds.midX - 1,
            y: 0,
            width: 2,
            height: button.bounds.height
        )

        popover.show(relativeTo: anchorRect, of: button, preferredEdge: .minY)
    }

    @objc
    func handleStatusItemClick(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else {
            togglePopover(sender)
            return
        }

        if event.type == .rightMouseUp || event.modifierFlags.contains(.control) {
            if popover.isShown {
                popover.performClose(sender)
            }

            statusItem.menu = statusMenu
            sender.performClick(nil)
            statusItem.menu = nil
            return
        }

        togglePopover(sender)
    }

    @objc
    func openManagerWindow(_ sender: Any?) {
        NSApp.sendAction(#selector(NSWindowController.showWindow(_:)), to: nil, from: nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    @objc
    func refreshAllAccounts(_ sender: Any?) {
        Task {
            await model.refreshAll()
        }
    }

    @objc
    func addAccount(_ sender: Any?) {
        model.openAddAccountFlow()
        openManagerWindow(sender)
    }

    @objc
    func quitApp(_ sender: Any?) {
        NSApplication.shared.terminate(sender)
    }

    private func configureStatusItem() {
        guard let button = statusItem.button else { return }

        statusItem.length = Self.itemWidth
        button.title = ""
        button.image = nil
        button.target = self
        button.action = #selector(handleStatusItemClick(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        button.setAccessibilityLabel("Codex Switch")

        hostingView.translatesAutoresizingMaskIntoConstraints = false
        button.addSubview(hostingView)

        NSLayoutConstraint.activate([
            hostingView.leadingAnchor.constraint(equalTo: button.leadingAnchor),
            hostingView.trailingAnchor.constraint(equalTo: button.trailingAnchor),
            hostingView.topAnchor.constraint(equalTo: button.topAnchor),
            hostingView.bottomAnchor.constraint(equalTo: button.bottomAnchor),
            hostingView.heightAnchor.constraint(equalToConstant: 22),
        ])
    }

    private func configureMenu() {
        let openManager = NSMenuItem(title: "Open Manager", action: #selector(openManagerWindow(_:)), keyEquivalent: "")
        openManager.target = self
        statusMenu.addItem(openManager)

        let refresh = NSMenuItem(title: "Refresh All", action: #selector(refreshAllAccounts(_:)), keyEquivalent: "")
        refresh.target = self
        statusMenu.addItem(refresh)

        let add = NSMenuItem(title: "Add Account", action: #selector(addAccount(_:)), keyEquivalent: "")
        add.target = self
        statusMenu.addItem(add)

        statusMenu.addItem(.separator())

        let quit = NSMenuItem(title: "Quit", action: #selector(quitApp(_:)), keyEquivalent: "")
        quit.target = self
        statusMenu.addItem(quit)
    }

    private func configurePopover() {
        popover.behavior = .transient
        popover.animates = true
        popover.contentSize = NSSize(width: 384, height: 560)
        popover.contentViewController = NSHostingController(
            rootView: MenuContentView().environmentObject(model)
        )
    }
}
