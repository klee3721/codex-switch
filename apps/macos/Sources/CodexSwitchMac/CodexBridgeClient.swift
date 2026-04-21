import Foundation

enum BridgeClientError: LocalizedError {
    case bundledBridgeNotBuilt(URL)
    case repoNotFound
    case cliNotBuilt(URL)
    case bunNotFound
    case transport(String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .bundledBridgeNotBuilt(let url):
            return "Missing bundled bridge at \(url.path). Rebuild the app bundle."
        case .repoNotFound:
            return "Unable to locate the codex-switch repository root. Set CODEX_SWITCH_REPO_ROOT before launching the macOS app."
        case .cliNotBuilt(let url):
            return "Missing built bridge at \(url.path). Run `npm run build` first."
        case .bunNotFound:
            return "Unable to locate Bun. Install Bun 1.2+ or launch the app with PATH including the Bun binary."
        case .transport(let message), .decoding(let message):
            return message
        }
    }
}

final class CodexBridgeClient: @unchecked Sendable {
    private struct BridgeCommand {
        let workingDirectory: URL
        let executableURL: URL
        let argumentsPrefix: [String]
    }

    private let decoder = JSONDecoder()
    private let initialCommand: BridgeCommand
    private let fallbackCommand: BridgeCommand?
    private let environment: [String: String]
    private let bunURL: URL

    init() throws {
        let environment = Self.buildBridgeEnvironment()
        let bunURL = try Self.resolveBunExecutable(environment: environment)

        self.environment = environment
        self.bunURL = bunURL

        if let bundledBridge = Self.resolveBundledBridge(bunURL: bunURL) {
            self.initialCommand = bundledBridge
            self.fallbackCommand = nil
            return
        }

        let repoCommand = try Self.resolveRepoBridge(bunURL: bunURL)
        self.initialCommand = repoCommand
        self.fallbackCommand = nil

    }

    func fetchStatus() async throws -> BridgeStatusPayload {
        try await run(["status"], as: BridgeStatusPayload.self)
    }

    func linkCurrent() async throws -> BridgeLinkCurrentPayload {
        try await run(["link-current"], as: BridgeLinkCurrentPayload.self)
    }

    func refreshActive() async throws -> BridgeActionPayload {
        try await run(["refresh", "--active"], as: BridgeActionPayload.self)
    }

    func refreshAll() async throws -> BridgeActionPayload {
        try await run(["refresh", "--all"], as: BridgeActionPayload.self)
    }

    func switchAccount(id: String) async throws -> BridgeUsePayload {
        try await run(["use", "--account", id], as: BridgeUsePayload.self)
    }

    func addAccount(label: String, deviceAuth: Bool) async throws -> BridgeActionPayload {
        var arguments = ["add", "--label", label]
        if deviceAuth {
            arguments.append("--device-auth")
        }
        return try await run(arguments, as: BridgeActionPayload.self)
    }

    func removeAccount(id: String, purge: Bool) async throws -> BridgeActionPayload {
        var arguments = ["remove", "--account", id]
        if purge {
            arguments.append("--purge")
        }
        return try await run(arguments, as: BridgeActionPayload.self)
    }

    func doctor() async throws -> BridgeDoctorPayload {
        try await run(["doctor"], as: BridgeDoctorPayload.self)
    }

    private func run<Payload: Decodable & Sendable>(_ arguments: [String], as type: Payload.Type) async throws -> Payload {
        let command = Self.resolveBundledBridge(bunURL: bunURL) ?? fallbackCommand ?? initialCommand
        return try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            let stdout = Pipe()
            let stderr = Pipe()

            process.executableURL = command.executableURL
            process.arguments = command.argumentsPrefix + arguments
            process.currentDirectoryURL = command.workingDirectory
            process.environment = environment
            process.standardOutput = stdout
            process.standardError = stderr

            process.terminationHandler = { [decoder] process in
                let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
                let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()

                do {
                    if !stdoutData.isEmpty {
                        let envelope = try decoder.decode(BridgeEnvelope<Payload>.self, from: stdoutData)
                        if envelope.ok, let payload = envelope.data {
                            continuation.resume(returning: payload)
                            return
                        }

                        if let bridgeError = envelope.error {
                            throw BridgeClientError.transport(bridgeError.message)
                        }
                    }

                    let stderrText = String(data: stderrData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    if !stderrText.isEmpty {
                        throw BridgeClientError.transport(stderrText)
                    }

                    throw BridgeClientError.transport("Bridge command failed with exit code \(process.terminationStatus).")
                } catch let error as BridgeClientError {
                    continuation.resume(throwing: error)
                } catch {
                    let raw = String(data: stdoutData, encoding: .utf8) ?? "<empty>"
                    continuation.resume(throwing: BridgeClientError.decoding("Failed to decode bridge response: \(raw)"))
                }
            }

            do {
                try process.run()
            } catch {
                continuation.resume(throwing: BridgeClientError.transport("Failed to launch bridge: \(error.localizedDescription)"))
            }
        }
    }

    private static func resolveBundledBridge(bunURL: URL) -> BridgeCommand? {
        guard let resourcesURL = Bundle.main.resourceURL else {
            return nil
        }

        let bridgeDirectory = resourcesURL.appendingPathComponent("bridge", isDirectory: true)
        let cliURL = bridgeDirectory.appendingPathComponent("bridge-cli.js")
        guard FileManager.default.fileExists(atPath: cliURL.path) else {
            return nil
        }

        return BridgeCommand(
            workingDirectory: bridgeDirectory,
            executableURL: bunURL,
            argumentsPrefix: [cliURL.path]
        )
    }

    private static func resolveRepoBridge(bunURL: URL) throws -> BridgeCommand {
        let repoRoot = try resolveRepoRoot()
        let cliURL = repoRoot.appendingPathComponent("dist/bridge-cli.js")
        guard FileManager.default.fileExists(atPath: cliURL.path) else {
            throw BridgeClientError.cliNotBuilt(cliURL)
        }

        return BridgeCommand(
            workingDirectory: repoRoot,
            executableURL: bunURL,
            argumentsPrefix: [cliURL.path]
        )
    }

    private static func buildBridgeEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["HOME"] = environment["HOME"] ?? NSHomeDirectory()

        let inheritedPath = environment["PATH"] ?? ""
        let loginShellPath = resolveLoginShellPath()
        let commonPaths = [
            "\(NSHomeDirectory())/.bun/bin",
            "\(NSHomeDirectory())/.local/bin",
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ].joined(separator: ":")

        environment["PATH"] = mergePathEntries([loginShellPath, inheritedPath, commonPaths])
        return environment
    }

    private static func resolveLoginShellPath() -> String {
        let environment = ProcessInfo.processInfo.environment
        let shellPath = environment["SHELL"].flatMap { $0.isEmpty ? nil : $0 } ?? "/bin/zsh"
        guard FileManager.default.isExecutableFile(atPath: shellPath) else {
            return ""
        }

        let process = Process()
        let stdout = Pipe()
        process.executableURL = URL(fileURLWithPath: shellPath)
        process.arguments = ["-lc", "printf '%s' \"$PATH\""]
        process.standardOutput = stdout
        process.standardError = Pipe()

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return ""
        }

        guard process.terminationStatus == 0 else {
            return ""
        }

        let data = stdout.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private static func mergePathEntries(_ pathValues: [String]) -> String {
        var seen = Set<String>()
        var entries: [String] = []

        for pathValue in pathValues where !pathValue.isEmpty {
            for entry in pathValue.split(separator: ":").map(String.init) where !entry.isEmpty {
                if seen.insert(entry).inserted {
                    entries.append(entry)
                }
            }
        }

        return entries.joined(separator: ":")
    }

    private static func resolveBunExecutable(environment: [String: String]) throws -> URL {
        let fileManager = FileManager.default
        let pathValue = environment["PATH"] ?? ""

        for directory in pathValue.split(separator: ":").map(String.init) where !directory.isEmpty {
            let bunURL = URL(fileURLWithPath: directory).appendingPathComponent("bun")
            if fileManager.isExecutableFile(atPath: bunURL.path) {
                return bunURL
            }
        }

        throw BridgeClientError.bunNotFound
    }

    private static func resolveRepoRoot() throws -> URL {
        let fileManager = FileManager.default
        let env = ProcessInfo.processInfo.environment

        if let explicit = env["CODEX_SWITCH_REPO_ROOT"], !explicit.isEmpty {
            let url = URL(fileURLWithPath: explicit)
            if isRepoRoot(url) {
                return url
            }
        }

        let cwd = URL(fileURLWithPath: fileManager.currentDirectoryPath)
        if let resolved = walkAncestors(from: cwd) {
            return resolved
        }

        if let executableURL = Bundle.main.executableURL, let resolved = walkAncestors(from: executableURL.deletingLastPathComponent()) {
            return resolved
        }

        if let firstArgument = CommandLine.arguments.first, !firstArgument.isEmpty {
            let commandURL = URL(fileURLWithPath: firstArgument)
            if let resolved = walkAncestors(from: commandURL.deletingLastPathComponent()) {
                return resolved
            }
        }

        throw BridgeClientError.repoNotFound
    }

    private static func walkAncestors(from start: URL) -> URL? {
        var current = start.standardizedFileURL

        while true {
            if isRepoRoot(current) {
                return current
            }

            let parent = current.deletingLastPathComponent()
            if parent.path == current.path {
                return nil
            }
            current = parent
        }
    }

    private static func isRepoRoot(_ url: URL) -> Bool {
        let packageJSON = url.appendingPathComponent("package.json").path
        let distBridgeCLI = url.appendingPathComponent("dist/bridge-cli.js").path
        return FileManager.default.fileExists(atPath: packageJSON) && FileManager.default.fileExists(atPath: distBridgeCLI)
    }
}
