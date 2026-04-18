import AppKit
import SwiftUI

private let codexDesktopAppPath = "/Applications/Codex.app"
private let codexDesktopIconPath = "/Applications/Codex.app/Contents/Resources/electron.icns"

@MainActor
func loadCodexAppIcon() -> NSImage? {
    if FileManager.default.fileExists(atPath: codexDesktopIconPath),
       let icon = NSImage(contentsOfFile: codexDesktopIconPath) {
        icon.size = NSSize(width: 512, height: 512)
        return icon
    }

    guard FileManager.default.fileExists(atPath: codexDesktopAppPath) else {
        return nil
    }

    let icon = NSWorkspace.shared.icon(forFile: codexDesktopAppPath)
    icon.size = NSSize(width: 512, height: 512)
    return icon
}

struct AppGlyph: View {
    var size: CGFloat = 13

    var body: some View {
        Group {
            if let icon = loadCodexAppIcon() {
                Image(nsImage: icon)
                    .resizable()
                    .interpolation(.high)
            } else {
                Image(systemName: "app")
                    .font(.system(size: size, weight: .medium))
                    .foregroundStyle(.primary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
    }
}

func statusColor(for account: BridgeAccountSummary?) -> Color {
    guard let account else { return Color(nsColor: .tertiaryLabelColor) }

    switch account.usage.status {
    case .ok:
        if let remaining = account.fiveHourRemaining {
            if remaining <= 20 {
                return Color(nsColor: .systemRed)
            }
            if remaining <= 50 {
                return Color(nsColor: .systemOrange)
            }
        }
        return Color(nsColor: .labelColor)
    case .stale:
        return Color(nsColor: .systemOrange)
    case .error, .reloginRequired:
        return Color(nsColor: .systemRed)
    case .never:
        return Color(nsColor: .tertiaryLabelColor)
    }
}

func percentString(_ value: Double?) -> String {
    guard let value else { return "n/a" }
    return value.percentText
}

func relativeTimestamp(from milliseconds: Double?) -> String {
    guard let date = dateFromMillis(milliseconds) else { return "Never" }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .short
    return formatter.localizedString(for: date, relativeTo: Date())
}

func resetTimestamp(from seconds: Double?) -> String {
    guard let date = dateFromSeconds(seconds) else { return "n/a" }
    return date.formatted(date: .abbreviated, time: .shortened)
}

func timeRemaining(until seconds: Double?, now: Date) -> String {
    guard let date = dateFromSeconds(seconds) else { return "n/a" }
    if date <= now { return "now" }

    let components = Calendar.current.dateComponents([.hour, .minute], from: now, to: date)
    let hours = components.hour ?? 0
    let minutes = components.minute ?? 0

    if hours > 0 {
        return "\(hours)h \(minutes)m"
    }
    return "\(max(minutes, 0))m"
}

func statusNote(for account: BridgeAccountSummary?) -> String {
    guard let account else { return "No account" }

    switch account.usage.status {
    case .ok:
        return "Ready"
    case .stale:
        return "Stale"
    case .error:
        return account.isBlocked ? "Unavailable" : "Error"
    case .reloginRequired:
        return "Re-login required"
    case .never:
        return "Refresh needed"
    }
}

struct CompactUsageBar: View {
    let percent: Double?
    let color: Color
    var height: CGFloat = 6

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let normalized = CGFloat((percent ?? 0) / 100)

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.08))

                Capsule()
                    .fill(color.opacity(0.85))
                    .frame(width: width * max(0, min(normalized, 1)))
            }
        }
        .frame(height: height)
        .accessibilityLabel("Remaining five-hour usage")
    }
}

struct UsageLane: View {
    let label: String
    let percent: Double?
    let color: Color

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 22, alignment: .leading)

            CompactUsageBar(percent: percent, color: color, height: 5)
                .frame(height: 5)

            Text(percentString(percent))
                .font(.system(size: 10, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(width: 38, alignment: .trailing)
        }
    }
}

struct DualUsageView: View {
    let fiveHour: Double?
    let weekly: Double?
    let color: Color
    var spacing: CGFloat = 7

    var body: some View {
        VStack(spacing: spacing) {
            UsageLane(label: "5H", percent: fiveHour, color: color)
            UsageLane(label: "WK", percent: weekly, color: color.opacity(0.7))
        }
    }
}

struct StatusDot: View {
    let color: Color

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 7, height: 7)
    }
}

struct KeyValueRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
        }
        .font(.caption)
    }
}

struct PercentPill: View {
    let label: String
    let value: Double?

    var body: some View {
        HStack(spacing: 6) {
            Text(label)
                .foregroundStyle(.secondary)
            Text(percentString(value))
                .foregroundStyle(.primary)
        }
        .font(.caption.weight(.medium))
        .monospacedDigit()
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
            Capsule(style: .continuous)
                .fill(Color.primary.opacity(0.06))
        )
    }
}

struct ManagerMetricCard: View {
    let title: String
    let value: String
    let note: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)

            Text(value)
                .font(.system(size: 22, weight: .semibold))
                .monospacedDigit()

            Text(note)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.04))
        )
    }
}

struct EmptyStateView: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.title3.weight(.semibold))
            Text(detail)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct StatusBarLabelView: View {
    @EnvironmentObject private var model: CodexSwitchAppModel

    var body: some View {
        let account = model.activeAccount

        HStack(spacing: 4) {
            ZStack {
                Text(percentString(account?.fiveHourRemaining))
                    .font(.system(size: 11, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(.primary)
                    .opacity(model.currentOperation == nil ? 1 : 0)

                if model.currentOperation != nil {
                    ProgressView()
                        .controlSize(.small)
                        .scaleEffect(0.75)
                }
            }
            .frame(width: 34, alignment: .trailing)
        }
        .frame(width: 38, alignment: .center)
    }
}

struct BannerView: View {
    let banner: BannerState

    var color: Color {
        switch banner.kind {
        case .info:
            return .blue
        case .success:
            return .green
        case .warning:
            return .orange
        case .error:
            return .red
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            StatusDot(color: color)
            Text(banner.message)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
    }
}

struct MenuHeaderView: View {
    @EnvironmentObject private var model: CodexSwitchAppModel

    var body: some View {
        let account = model.activeAccount
        let tint = statusColor(for: account)

        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                HStack(spacing: 8) {
                    AppGlyph(size: 13)
                    Text(account?.displayName ?? "No active account")
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Spacer()
                Text(statusNote(for: account))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(width: 96, alignment: .trailing)
            }

            DualUsageView(
                fiveHour: account?.fiveHourRemaining,
                weekly: account?.weeklyRemaining,
                color: tint
            )

            HStack {
                Text("Updated \(relativeTimestamp(from: account?.usage.updatedAt))")
                Spacer()
                Text("5H \(timeRemaining(until: account?.usage.last5Hours.resetAt, now: model.now))")
                Text("WK \(timeRemaining(until: account?.usage.weekly.resetAt, now: model.now))")
            }
            .font(.caption)
            .monospacedDigit()
            .foregroundStyle(.secondary)

            if let operation = model.currentOperation {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text(operation.subtitle ?? operation.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }
}

struct ActionStripView: View {
    @EnvironmentObject private var model: CodexSwitchAppModel
    @Environment(\.openWindow) private var openWindow

    private func openManagerWindow() {
        openWindow(id: "manager")
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    var body: some View {
        HStack(spacing: 16) {
            Button("Refresh") {
                Task { await model.refreshAll() }
            }

            Button("Add") {
                model.openAddAccountFlow()
                openManagerWindow()
            }

            Button("Manage") {
                openManagerWindow()
            }

            Spacer()

            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
        }
        .buttonStyle(.plain)
        .font(.caption)
        .disabled(model.hasBlockingOperation)
    }
}

struct AccountRowView: View {
    let account: BridgeAccountSummary
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                StatusDot(color: account.isActive ? .green : Color.primary.opacity(0.12))

                Text(account.displayName)
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.tail)

                Spacer(minLength: 8)

                HStack(spacing: 6) {
                    PercentPill(label: "5H", value: account.fiveHourRemaining)
                    PercentPill(label: "WK", value: account.weeklyRemaining)
                }
            }

            HStack {
                Text(statusNote(for: account))
                Spacer()
                Text("5H \(timeRemaining(until: account.usage.last5Hours.resetAt, now: now))")
                Text("•")
                    .foregroundStyle(Color.primary.opacity(0.24))
                Text("WK \(timeRemaining(until: account.usage.weekly.resetAt, now: now))")
            }
            .font(.caption2)
            .monospacedDigit()
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

struct AddAccountSheet: View {
    @EnvironmentObject private var model: CodexSwitchAppModel
    @State private var label = ""
    @State private var deviceAuth = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                AppGlyph(size: 14)
                Text("Add account")
                    .font(.title3.weight(.semibold))
            }

            TextField("Label", text: $label)
                .textFieldStyle(.roundedBorder)

            Toggle("Use device auth", isOn: $deviceAuth)
                .toggleStyle(.switch)

            Text("Browser login is preferred. Use device auth if handoff fails.")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack {
                Spacer()
                Button("Cancel") {
                    model.isAddAccountSheetPresented = false
                }
                Button("Add") {
                    Task {
                        await model.addAccount(label: label, deviceAuth: deviceAuth)
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(model.hasBlockingOperation || label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 340)
    }
}

struct MenuContentView: View {
    @EnvironmentObject private var model: CodexSwitchAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 12) {
                MenuHeaderView()
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.primary.opacity(0.04))
            )

            if let banner = model.banner {
                BannerView(banner: banner)
            }

            ActionStripView()

            Rectangle()
                .fill(Color.primary.opacity(0.08))
                .frame(height: 1)

            if model.accounts.isEmpty {
                EmptyStateView(title: "No accounts", detail: "Use Add to connect a Codex login.")
                    .padding(.vertical, 4)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(model.accounts.enumerated()), id: \.element.id) { index, account in
                        Button {
                            guard account.canSwitch else { return }
                            Task { await model.switchAccount(id: account.id) }
                        } label: {
                            AccountRowView(account: account, now: model.now)
                        }
                        .buttonStyle(.plain)
                        .disabled(model.hasBlockingOperation || !account.canSwitch)

                        if index < model.accounts.count - 1 {
                            Divider()
                        }
                    }
                }
            }
        }
        .padding(18)
        .frame(width: 360)
        .fixedSize(horizontal: false, vertical: true)
        .onAppear {
            model.menuOpened()
        }
    }
}

struct ManagerWindowView: View {
    @EnvironmentObject private var model: CodexSwitchAppModel

    var body: some View {
        NavigationSplitView {
            List(selection: $model.selectedAccountID) {
                ForEach(model.accounts) { account in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            StatusDot(color: account.isActive ? .green : Color.primary.opacity(0.12))
                            Text(account.displayName)
                                .font(.headline)
                                .lineLimit(1)
                        }

                        HStack(spacing: 8) {
                            PercentPill(label: "5H", value: account.fiveHourRemaining)
                            PercentPill(label: "WK", value: account.weeklyRemaining)
                            Spacer()
                        }
                    }
                    .padding(.vertical, 6)
                    .tag(Optional(account.id))
                }
            }
            .navigationTitle("Accounts")
            .navigationSplitViewColumnWidth(min: 300, ideal: 330, max: 360)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let account = model.selectedAccount {
                        VStack(alignment: .leading, spacing: 16) {
                            HStack(alignment: .center) {
                                HStack(spacing: 8) {
                                    StatusDot(color: account.isActive ? .green : Color.primary.opacity(0.12))
                                    Text(account.displayName)
                                        .font(.title2.weight(.semibold))
                                }
                                Spacer()
                            }

                            LazyVGrid(
                                columns: [
                                    GridItem(.flexible(), spacing: 10),
                                    GridItem(.flexible(), spacing: 10),
                                ],
                                spacing: 10
                            ) {
                                ManagerMetricCard(
                                    title: "5 hour",
                                    value: percentString(account.fiveHourRemaining),
                                    note: "resets in \(timeRemaining(until: account.usage.last5Hours.resetAt, now: model.now))"
                                )
                                ManagerMetricCard(
                                    title: "Weekly",
                                    value: percentString(account.weeklyRemaining),
                                    note: "resets in \(timeRemaining(until: account.usage.weekly.resetAt, now: model.now))"
                                )
                                ManagerMetricCard(
                                    title: "Updated",
                                    value: relativeTimestamp(from: account.usage.updatedAt),
                                    note: resetTimestamp(from: account.usage.last5Hours.resetAt)
                                )
                                ManagerMetricCard(
                                    title: "Plan",
                                    value: (account.usage.planType ?? "unknown").uppercased(),
                                    note: resetTimestamp(from: account.usage.weekly.resetAt)
                                )
                            }

                            Divider()

                            VStack(alignment: .leading, spacing: 10) {
                                Text("Details")
                                    .font(.headline)
                                if let error = account.usage.error, !error.isEmpty {
                                    Text(error)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .textSelection(.enabled)
                                } else if account.usage.status != .ok {
                                    Text(statusNote(for: account))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Text(account.profileDir)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                            }

                            Divider()

                            VStack(alignment: .leading, spacing: 10) {
                                HStack(spacing: 12) {
                                    Button(account.isActive ? "Active" : "Switch") {
                                        Task { await model.switchAccount(id: account.id) }
                                    }
                                    .disabled(model.hasBlockingOperation || !account.canSwitch || account.isActive)

                                    Button("Remove", role: .destructive) {
                                        Task { await model.removeSelectedAccount() }
                                    }
                                    .disabled(model.hasBlockingOperation)
                                }

                                Toggle("Purge profile on remove", isOn: $model.purgeProfileOnRemove)
                                    .toggleStyle(.switch)
                                    .font(.caption)
                                    .frame(maxWidth: 220, alignment: .leading)
                            }
                        }
                    } else {
                        EmptyStateView(
                            title: "No account selected",
                            detail: "Choose an account to inspect usage, switch, or remove it."
                        )
                        .padding(.top, 80)
                    }

                    Divider()

                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Diagnostics")
                                .font(.headline)
                            Spacer()
                            Button("Refresh") {
                                Task { await model.loadDoctor() }
                            }
                            .disabled(model.hasBlockingOperation)
                        }

                        if let doctor = model.doctorReport {
                            ForEach(doctor.checks) { check in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack(spacing: 8) {
                                        StatusDot(color: check.ok ? .green : .orange)
                                        Text(check.name)
                                            .font(.subheadline.weight(.medium))
                                    }
                                    Text(check.details)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .textSelection(.enabled)
                                }
                                .padding(.vertical, 2)
                            }
                        } else {
                            Text("Diagnostics have not been loaded yet.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(18)
            }
        }
        .frame(minWidth: 920, minHeight: 560)
        .toolbar {
            ToolbarItemGroup {
                Button("Refresh") {
                    Task { await model.refreshAll() }
                }
                Button("Add") {
                    model.openAddAccountFlow()
                }
            }
        }
        .sheet(isPresented: $model.isAddAccountSheetPresented) {
            AddAccountSheet()
                .environmentObject(model)
        }
        .onAppear {
            model.managerOpened()
        }
    }
}
