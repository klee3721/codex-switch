import AppKit
import SwiftUI

private let appGlyphBackground = Color(red: 15 / 255, green: 23 / 255, blue: 32 / 255)
private let appGlyphForeground = Color(red: 248 / 255, green: 250 / 255, blue: 252 / 255)

private enum CodexVisual {
    static let radiusSM: CGFloat = 10
    static let radiusMD: CGFloat = 14
    static let radiusLG: CGFloat = 18

    static let surface = Color(nsColor: .windowBackgroundColor)
    static let hairline = Color.primary.opacity(0.10)
    static let quietText = Color.secondary.opacity(0.86)
    static let gold = Color(red: 0.89, green: 0.58, blue: 0.28)
    static let softYellow = Color(red: 0.88, green: 0.76, blue: 0.34)
    static let strongYellow = Color(red: 0.94, green: 0.69, blue: 0.18)
    static let mint = Color(red: 0.28, green: 0.82, blue: 0.46)
}

@MainActor
private enum CodexFormatters {
    static let relativeTimestamp: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter
    }()

    static let resetDateTime = Date.FormatStyle(date: .abbreviated, time: .shortened)
    static let resetDate = Date.FormatStyle(date: .abbreviated, time: .omitted)
}

struct PremiumPanel<Content: View>: View {
    var cornerRadius: CGFloat = CodexVisual.radiusMD
    var padding: CGFloat = 14
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Color.primary.opacity(0.045))
                    .overlay(
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .strokeBorder(CodexVisual.hairline)
                    )
            )
    }
}

struct SectionDivider: View {
    var body: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [
                        Color.primary.opacity(0.04),
                        Color.primary.opacity(0.16),
                        Color.primary.opacity(0.04),
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .frame(height: 1)
    }
}

@MainActor
func makeRuntimeAppIcon(size: CGFloat = 512) -> NSImage? {
    let renderer = ImageRenderer(content:
        AppGlyph(size: size)
            .padding(size * 0.08)
    )
    renderer.scale = 2
    if let image = renderer.nsImage {
        image.size = NSSize(width: size, height: size)
        return image
    }
    return nil
}

struct AppGlyphMark: Shape {
    func path(in rect: CGRect) -> Path {
        let scaleX = rect.width / 1024
        let scaleY = rect.height / 1024

        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * scaleX, y: rect.minY + y * scaleY)
        }

        return Path { path in
            path.move(to: point(315, 311))
            path.addCurve(to: point(393, 233), control1: point(315, 267.922), control2: point(349.922, 233))
            path.addLine(to: point(545, 233))
            path.addCurve(to: point(623, 311), control1: point(588.078, 233), control2: point(623, 267.922))
            path.addLine(to: point(623, 357))
            path.addCurve(to: point(545, 435), control1: point(623, 400.078), control2: point(588.078, 435))
            path.addLine(to: point(479, 435))
            path.addCurve(to: point(401, 513), control1: point(435.922, 435), control2: point(401, 469.922))
            path.addLine(to: point(401, 555))
            path.addCurve(to: point(479, 633), control1: point(401, 598.078), control2: point(435.922, 633))
            path.addLine(to: point(631, 633))
            path.addCurve(to: point(709, 711), control1: point(674.078, 633), control2: point(709, 667.922))
            path.addLine(to: point(709, 713))
            path.addCurve(to: point(631, 791), control1: point(709, 756.078), control2: point(674.078, 791))
            path.addLine(to: point(393, 791))
            path.addCurve(to: point(315, 713), control1: point(349.922, 791), control2: point(315, 756.078))
            path.addLine(to: point(315, 667))
        }
    }
}

struct AppGlyph: View {
    var size: CGFloat = 13

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
                .fill(appGlyphBackground)

            AppGlyphMark()
                .stroke(appGlyphForeground, style: StrokeStyle(lineWidth: size * 0.112, lineCap: .round, lineJoin: .round))
                .padding(size * 0.12)
        }
        .frame(width: size, height: size)
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

func usageBarColor(for remainingPercent: Double?) -> Color {
    guard let remainingPercent else { return Color(nsColor: .tertiaryLabelColor) }

    if remainingPercent < 20 {
        return Color(nsColor: .systemRed)
    }
    if remainingPercent < 50 {
        return CodexVisual.strongYellow
    }
    if remainingPercent < 80 {
        return CodexVisual.softYellow
    }
    return Color(nsColor: .labelColor)
}

func percentString(_ value: Double?) -> String {
    guard let value else { return "n/a" }
    return value.percentText
}

@MainActor
func relativeTimestamp(from milliseconds: Double?) -> String {
    guard let date = dateFromMillis(milliseconds) else { return "Never" }
    return CodexFormatters.relativeTimestamp.localizedString(for: date, relativeTo: Date())
}

@MainActor
func resetTimestamp(from seconds: Double?) -> String {
    guard let date = dateFromSeconds(seconds) else { return "n/a" }
    return date.formatted(CodexFormatters.resetDateTime)
}

@MainActor
func resetDate(from seconds: Double?) -> String {
    guard let date = dateFromSeconds(seconds) else { return "n/a" }
    return date.formatted(CodexFormatters.resetDate)
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
        let normalized = max(0, min((percent ?? 0) / 100, 1))

        Capsule()
            .fill(Color.primary.opacity(0.075))
            .overlay(
                Capsule()
                    .strokeBorder(Color.primary.opacity(0.05))
            )
            .overlay(alignment: .leading) {
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [
                                color.opacity(0.72),
                                color.opacity(0.96),
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .scaleEffect(x: normalized, y: 1, anchor: .leading)
            }
        .frame(height: height)
        .accessibilityLabel("Remaining five-hour usage")
    }
}

struct UsageLane: View {
    let label: String
    let percent: Double?

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(CodexVisual.quietText)
                .frame(width: 24, alignment: .leading)

            CompactUsageBar(percent: percent, color: usageBarColor(for: percent), height: 5)
                .frame(height: 5)

            Text(percentString(percent))
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.primary.opacity(0.82))
                .frame(width: 42, alignment: .trailing)
        }
    }
}

struct DualUsageView: View {
    let fiveHour: Double?
    let weekly: Double?
    var spacing: CGFloat = 7

    var body: some View {
        VStack(spacing: spacing) {
            UsageLane(label: "5H", percent: fiveHour)
            UsageLane(label: "WK", percent: weekly)
        }
    }
}

struct StatusDot: View {
    let color: Color
    var size: CGFloat = 8

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .overlay(
                Circle()
                    .strokeBorder(Color.white.opacity(0.28), lineWidth: 0.75)
            )
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
                .foregroundStyle(CodexVisual.quietText)
            Text(percentString(value))
                .foregroundStyle(.primary)
        }
        .font(.system(size: 11, weight: .semibold, design: .rounded))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.86)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(minWidth: 64)
        .background(
            Capsule(style: .continuous)
                .fill(Color.primary.opacity(0.065))
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.06))
                )
        )
    }
}

struct AccountUsageMeter: View {
    let label: String
    let value: Double?

    var body: some View {
        HStack(spacing: 6) {
            Text(label)
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(CodexVisual.quietText)
                .frame(width: 20, alignment: .leading)

            CompactUsageBar(percent: value, color: usageBarColor(for: value), height: 4)
                .frame(width: 42, height: 4)

            Text(percentString(value))
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.82)
                .foregroundStyle(.primary.opacity(0.84))
                .frame(width: 38, alignment: .trailing)
        }
        .frame(width: 118, alignment: .trailing)
    }
}

struct AccountUsageStack: View {
    let fiveHour: Double?
    let weekly: Double?

    var body: some View {
        VStack(alignment: .trailing, spacing: 7) {
            AccountUsageMeter(label: "5H", value: fiveHour)
            AccountUsageMeter(label: "WK", value: weekly)
        }
    }
}

struct IconCommandButton: View {
    let title: String
    let systemImage: String
    var role: ButtonRole?
    var isProminent = false
    let action: () -> Void

    var body: some View {
        Button(role: role, action: action) {
            Label(title, systemImage: systemImage)
                .labelStyle(.titleAndIcon)
                .font(.system(size: 12, weight: .semibold))
                .padding(.horizontal, 10)
                .frame(height: 28)
                .background(
                    Capsule(style: .continuous)
                        .fill(isProminent ? CodexVisual.gold.opacity(0.18) : Color.primary.opacity(0.055))
                        .overlay(
                            Capsule(style: .continuous)
                                .strokeBorder(isProminent ? CodexVisual.gold.opacity(0.30) : Color.primary.opacity(0.07))
                        )
                )
        }
        .buttonStyle(.plain)
        .help(title)
    }
}

struct ManagerMetricCard: View {
    let title: String
    let value: String
    let note: String
    var tint: Color = CodexVisual.gold

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(CodexVisual.quietText)
                Spacer()
                Circle()
                    .fill(tint.opacity(0.86))
                    .frame(width: 6, height: 6)
            }

            Text(value)
                .font(.system(size: 24, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            Text(note)
                .font(.caption)
                .foregroundStyle(CodexVisual.quietText)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: CodexVisual.radiusMD, style: .continuous)
                .fill(Color.primary.opacity(0.045))
                .overlay(
                    RoundedRectangle(cornerRadius: CodexVisual.radiusMD, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.07))
                )
        )
    }
}

struct EmptyStateView: View {
    let title: String
    let detail: String

    var body: some View {
        PremiumPanel(cornerRadius: CodexVisual.radiusMD, padding: 16) {
            VStack(alignment: .leading, spacing: 9) {
                Image(systemName: "person.crop.circle.badge.plus")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(CodexVisual.gold)
                Text(title)
                    .font(.title3.weight(.semibold))
                Text(detail)
                    .font(.callout)
                    .foregroundStyle(CodexVisual.quietText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct StatusBarLabelView: View {
    @EnvironmentObject private var model: CodexSwitchAppModel

    var body: some View {
        let account = model.activeAccount
        let remaining = account?.fiveHourRemaining

        ZStack {
            CompactUsageBar(
                percent: remaining,
                color: statusBarUsageColor(for: remaining),
                height: 7
            )
                .frame(width: 30, height: 7)
                .background(
                    Capsule(style: .continuous)
                        .fill(Color.black.opacity(0.38))
                )
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(Color.white.opacity(0.88), lineWidth: 0.9)
                )
                .shadow(color: Color.black.opacity(0.40), radius: 0.5, y: 0.5)
                .opacity(model.currentOperation == nil ? 1 : 0)
                .accessibilityValue(percentString(remaining))

            if model.currentOperation != nil {
                ProgressView()
                    .controlSize(.small)
                    .scaleEffect(0.75)
            }
        }
        .frame(width: 38, alignment: .center)
    }
}

private func statusBarUsageColor(for remainingPercent: Double?) -> Color {
    guard let remainingPercent else { return Color.white.opacity(0.40) }

    if remainingPercent < 20 {
        return Color(nsColor: .systemRed)
    }
    if remainingPercent < 50 {
        return CodexVisual.strongYellow
    }
    return Color.white
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
            Image(systemName: banner.kind == .error ? "exclamationmark.triangle.fill" : "info.circle.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(color)
            Text(banner.message)
                .font(.caption.weight(.medium))
                .foregroundStyle(CodexVisual.quietText)
                .lineLimit(2)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: CodexVisual.radiusSM, style: .continuous)
                .fill(color.opacity(0.10))
                .overlay(
                    RoundedRectangle(cornerRadius: CodexVisual.radiusSM, style: .continuous)
                        .strokeBorder(color.opacity(0.18))
                )
        )
    }
}

struct MenuHeaderView: View {
    @EnvironmentObject private var model: CodexSwitchAppModel

    var body: some View {
        let account = model.activeAccount
        let tint = statusColor(for: account)

        PremiumPanel(cornerRadius: CodexVisual.radiusLG, padding: 16) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center, spacing: 11) {
                    AppGlyph(size: 24)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(account?.displayName ?? "No active account")
                            .font(.system(size: 15, weight: .semibold))
                            .lineLimit(1)
                            .truncationMode(.tail)

                        Text(account?.subtitle ?? "Connect a Codex login")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(CodexVisual.quietText)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    HStack(spacing: 6) {
                        StatusDot(color: tint, size: 7)
                        Text(statusNote(for: account))
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.primary.opacity(0.82))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(
                        Capsule(style: .continuous)
                            .fill(tint.opacity(0.10))
                            .overlay(
                                Capsule(style: .continuous)
                                    .strokeBorder(tint.opacity(0.16))
                            )
                    )
                }

                DualUsageView(
                    fiveHour: account?.fiveHourRemaining,
                    weekly: account?.weeklyRemaining,
                    spacing: 9
                )

                HStack(spacing: 10) {
                    Label("Updated \(relativeTimestamp(from: account?.usage.updatedAt))", systemImage: "clock")
                    Spacer(minLength: 8)
                    Text("5H \(timeRemaining(until: account?.usage.last5Hours.resetAt, now: model.now))")
                    Text("WK \(resetDate(from: account?.usage.weekly.resetAt))")
                }
                .font(.system(size: 11, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(CodexVisual.quietText)

                if let operation = model.currentOperation {
                    HStack(spacing: 8) {
                        ProgressView()
                            .controlSize(.small)
                            .scaleEffect(0.76)
                        Text(operation.subtitle ?? operation.title)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(CodexVisual.quietText)
                            .lineLimit(1)
                    }
                    .padding(.top, 1)
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
        HStack(spacing: 8) {
            Button {
                guard !model.isRefreshingAll, !model.hasBlockingOperation else { return }
                Task { await model.refreshAll() }
            } label: {
                HStack(spacing: 6) {
                    if model.isRefreshingAll {
                        ProgressView()
                            .controlSize(.small)
                            .scaleEffect(0.72)
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    Text("Refresh")
                }
                .font(.system(size: 12, weight: .semibold))
                .padding(.horizontal, 10)
                .frame(height: 28)
                .background(
                    Capsule(style: .continuous)
                        .fill(Color.primary.opacity(0.055))
                        .overlay(
                            Capsule(style: .continuous)
                                .strokeBorder(Color.primary.opacity(0.07))
                        )
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.isRefreshingAll || model.hasBlockingOperation)
            .help("Refresh all accounts")

            IconCommandButton(title: "Add", systemImage: "plus") {
                model.openAddAccountFlow()
                openManagerWindow()
            }
            .disabled(model.hasBlockingOperation)

            IconCommandButton(title: "Manage", systemImage: "slider.horizontal.3", isProminent: true) {
                openManagerWindow()
            }

            Spacer()

            IconCommandButton(title: "Quit", systemImage: "power", role: .destructive) {
                NSApplication.shared.terminate(nil)
            }
        }
    }
}

struct AccountRowView: View {
    let account: BridgeAccountSummary

    var body: some View {
        let tint = statusColor(for: account)

        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    StatusDot(color: account.isActive ? CodexVisual.mint : Color.primary.opacity(0.16), size: account.isActive ? 8 : 7)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(account.displayName)
                            .font(.system(size: 13, weight: .semibold))
                            .lineLimit(1)
                            .truncationMode(.tail)

                        if let email = account.email, email != account.displayName {
                            Text(email)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(CodexVisual.quietText)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                HStack(spacing: 6) {
                    Text(statusNote(for: account))
                    Text("•")
                        .foregroundStyle(Color.primary.opacity(0.24))
                    Text(resetDate(from: account.usage.weekly.resetAt))
                        .monospacedDigit()
                }
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(CodexVisual.quietText)
                    .lineLimit(1)
                    .padding(.leading, account.isActive ? 18 : 17)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            AccountUsageStack(
                fiveHour: account.fiveHourRemaining,
                weekly: account.weeklyRemaining
            )
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: CodexVisual.radiusMD, style: .continuous)
                .fill(account.isActive ? tint.opacity(0.10) : Color.clear)
                .overlay(
                    RoundedRectangle(cornerRadius: CodexVisual.radiusMD, style: .continuous)
                        .strokeBorder(account.isActive ? tint.opacity(0.18) : Color.clear)
                )
        )
        .contentShape(Rectangle())
    }
}

struct ManagerSidebarAccountRow: View {
    let account: BridgeAccountSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 9) {
                StatusDot(color: account.isActive ? CodexVisual.mint : Color.primary.opacity(0.16), size: 8)
                Text(account.displayName)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            HStack(spacing: 6) {
                PercentPill(label: "5H", value: account.fiveHourRemaining)
                PercentPill(label: "WK", value: account.weeklyRemaining)
            }
        }
        .padding(.vertical, 7)
    }
}

struct DetailHeaderView: View {
    let account: BridgeAccountSummary

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            ZStack {
                Circle()
                    .fill(statusColor(for: account).opacity(0.13))
                    .frame(width: 46, height: 46)
                AppGlyph(size: 24)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(account.displayName)
                    .font(.system(size: 24, weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)

                HStack(spacing: 8) {
                    StatusDot(color: account.isActive ? CodexVisual.mint : Color.primary.opacity(0.18), size: 7)
                    Text(account.isActive ? "Active profile" : statusNote(for: account))
                    if let email = account.email {
                        Text("•")
                            .foregroundStyle(Color.primary.opacity(0.24))
                        Text(email)
                            .truncationMode(.middle)
                    }
                }
                .font(.callout.weight(.medium))
                .foregroundStyle(CodexVisual.quietText)
                .lineLimit(1)
            }

            Spacer()
        }
        .padding(.bottom, 4)
    }
}

struct DetailSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(CodexVisual.quietText)
                .textCase(.uppercase)

            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: CodexVisual.radiusMD, style: .continuous)
                .fill(Color.primary.opacity(0.035))
                .overlay(
                    RoundedRectangle(cornerRadius: CodexVisual.radiusMD, style: .continuous)
                        .strokeBorder(Color.primary.opacity(0.07))
                )
        )
    }
}

struct AddAccountSheet: View {
    @EnvironmentObject private var model: CodexSwitchAppModel
    @State private var label = ""
    @State private var deviceAuth = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 11) {
                AppGlyph(size: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Add account")
                        .font(.title3.weight(.semibold))
                    Text("Create a named Codex login profile.")
                        .font(.caption)
                        .foregroundStyle(CodexVisual.quietText)
                }
            }

            TextField("Label", text: $label)
                .textFieldStyle(.roundedBorder)

            PremiumPanel(cornerRadius: CodexVisual.radiusSM, padding: 12) {
                HStack(alignment: .center, spacing: 10) {
                    Image(systemName: deviceAuth ? "number.square.fill" : "safari.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(CodexVisual.gold)

                    VStack(alignment: .leading, spacing: 3) {
                        Toggle("Use device auth", isOn: $deviceAuth)
                            .toggleStyle(.switch)
                        Text("Browser login is preferred. Use device auth if handoff fails.")
                            .font(.caption)
                            .foregroundStyle(CodexVisual.quietText)
                    }
                }
            }

            HStack {
                Spacer()
                Button("Cancel") {
                    model.isAddAccountSheetPresented = false
                }
                Button {
                    Task {
                        await model.addAccount(label: label, deviceAuth: deviceAuth)
                    }
                } label: {
                    Label("Add", systemImage: "plus")
                }
                .keyboardShortcut(.defaultAction)
                .disabled(model.hasBlockingOperation || label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(22)
        .frame(width: 380)
    }
}

struct MenuContentView: View {
    @EnvironmentObject private var model: CodexSwitchAppModel
    var onAppear: (() -> Void)? = nil
    private let maxAccountsListHeight: CGFloat = 352

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            MenuHeaderView()

            if let banner = model.banner, banner.kind != .success {
                BannerView(banner: banner)
            }

            ActionStripView()

            SectionDivider()

            if model.accounts.isEmpty {
                EmptyStateView(title: "No accounts", detail: "Use Add to connect a Codex login.")
                    .padding(.vertical, 4)
            } else {
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(model.accounts.enumerated()), id: \.element.id) { index, account in
                            Button {
                                guard account.canSwitch else { return }
                                Task { await model.switchAccount(id: account.id) }
                            } label: {
                                AccountRowView(account: account)
                            }
                            .buttonStyle(.plain)
                            .disabled(model.hasBlockingOperation || !account.canSwitch)

                            if index < model.accounts.count - 1 {
                                SectionDivider()
                                    .padding(.horizontal, 4)
                            }
                        }
                    }
                }
                .frame(maxHeight: maxAccountsListHeight, alignment: .top)
            }
        }
        .padding(16)
        .frame(width: 384)
        .background(
            CodexVisual.surface
                .overlay(
                    LinearGradient(
                        colors: [
                            CodexVisual.gold.opacity(0.055),
                            Color.clear,
                        ],
                        startPoint: .topLeading,
                        endPoint: .center
                    )
                )
        )
        .onAppear {
            model.menuOpened()
            onAppear?()
        }
    }
}

struct ManagerWindowView: View {
    @EnvironmentObject private var model: CodexSwitchAppModel

    var body: some View {
        NavigationSplitView {
            List(selection: $model.selectedAccountID) {
                ForEach(model.accounts) { account in
                    ManagerSidebarAccountRow(account: account)
                        .tag(Optional(account.id))
                }
            }
            .navigationTitle("Accounts")
            .navigationSplitViewColumnWidth(min: 300, ideal: 330, max: 360)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let banner = model.banner {
                        BannerView(banner: banner)
                            .padding(.bottom, 2)
                    }

                    if let account = model.selectedAccount {
                        VStack(alignment: .leading, spacing: 18) {
                            DetailHeaderView(account: account)

                            LazyVGrid(
                                columns: [
                                    GridItem(.flexible(), spacing: 12),
                                    GridItem(.flexible(), spacing: 12),
                                ],
                                spacing: 12
                            ) {
                                ManagerMetricCard(
                                    title: "5 hour",
                                    value: percentString(account.fiveHourRemaining),
                                    note: "resets in \(timeRemaining(until: account.usage.last5Hours.resetAt, now: model.now))",
                                    tint: statusColor(for: account)
                                )
                                ManagerMetricCard(
                                    title: "Weekly",
                                    value: percentString(account.weeklyRemaining),
                                    note: resetDate(from: account.usage.weekly.resetAt),
                                    tint: CodexVisual.gold
                                )
                                ManagerMetricCard(
                                    title: "Updated",
                                    value: relativeTimestamp(from: account.usage.updatedAt),
                                    note: resetTimestamp(from: account.usage.last5Hours.resetAt),
                                    tint: Color(nsColor: .systemBlue)
                                )
                                ManagerMetricCard(
                                    title: "Plan",
                                    value: (account.usage.planType ?? "unknown").uppercased(),
                                    note: resetTimestamp(from: account.usage.weekly.resetAt),
                                    tint: Color(nsColor: .systemPurple)
                                )
                            }

                            DetailSection(title: "Details") {
                                if let error = account.usage.error, !error.isEmpty {
                                    Text(error)
                                        .font(.caption)
                                        .foregroundStyle(CodexVisual.quietText)
                                        .textSelection(.enabled)
                                } else if account.usage.status != .ok {
                                    Text(statusNote(for: account))
                                        .font(.caption)
                                        .foregroundStyle(CodexVisual.quietText)
                                }

                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: "folder")
                                        .foregroundStyle(CodexVisual.gold)
                                    Text(account.profileDir)
                                        .font(.caption)
                                        .foregroundStyle(CodexVisual.quietText)
                                        .textSelection(.enabled)
                                        .lineLimit(2)
                                }
                            }

                            DetailSection(title: "Actions") {
                                HStack(spacing: 10) {
                                    Button {
                                        Task { await model.switchAccount(id: account.id) }
                                    } label: {
                                        Label(account.isActive ? "Active" : "Switch", systemImage: account.isActive ? "checkmark.circle.fill" : "arrow.triangle.2.circlepath")
                                    }
                                    .disabled(model.hasBlockingOperation || !account.canSwitch || account.isActive)

                                    Button(role: .destructive) {
                                        Task { await model.removeSelectedAccount() }
                                    } label: {
                                        Label("Remove", systemImage: "trash")
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

                    DetailSection(title: "Diagnostics") {
                        HStack {
                            Text("Codex environment")
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Button {
                                Task { await model.loadDoctor() }
                            } label: {
                                Label("Refresh", systemImage: "arrow.clockwise")
                            }
                            .disabled(model.hasBlockingOperation)
                        }

                        if let doctor = model.doctorReport {
                            ForEach(doctor.checks) { check in
                                VStack(alignment: .leading, spacing: 5) {
                                    HStack(spacing: 8) {
                                        StatusDot(color: check.ok ? CodexVisual.mint : .orange, size: 7)
                                        Text(check.name)
                                            .font(.subheadline.weight(.medium))
                                    }
                                    Text(check.details)
                                        .font(.caption)
                                        .foregroundStyle(CodexVisual.quietText)
                                        .textSelection(.enabled)
                                }
                                .padding(.vertical, 3)
                            }
                        } else {
                            Text("Diagnostics have not been loaded yet.")
                                .font(.caption)
                                .foregroundStyle(CodexVisual.quietText)
                        }
                    }
                }
                .padding(24)
            }
        }
        .frame(minWidth: 920, minHeight: 560)
        .toolbar {
            ToolbarItemGroup {
                Button {
                    Task { await model.refreshAll() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }

                Button {
                    model.openAddAccountFlow()
                } label: {
                    Label("Add", systemImage: "plus")
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
