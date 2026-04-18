import Foundation

enum BridgeClientError: LocalizedError {
    case repoNotFound
    case cliNotBuilt(URL)
    case transport(String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .repoNotFound:
            return "Unable to locate the codex-switch repository root. Set CODEX_SWITCH_REPO_ROOT before launching the macOS app."
        case .cliNotBuilt(let url):
            return "Missing built bridge at \(url.path). Run `npm run build` first."
        case .transport(let message), .decoding(let message):
            return message
        }
    }
}

final class CodexBridgeClient: @unchecked Sendable {
    private let decoder = JSONDecoder()
    private let repoRoot: URL
    private let cliURL: URL

    init() throws {
        let repoRoot = try Self.resolveRepoRoot()
        let cliURL = repoRoot.appendingPathComponent("dist/cli.js")
        guard FileManager.default.isExecutableFile(atPath: cliURL.path) else {
            throw BridgeClientError.cliNotBuilt(cliURL)
        }

        self.repoRoot = repoRoot
        self.cliURL = cliURL
    }

    func fetchStatus() async throws -> BridgeStatusPayload {
        try await run(["bridge", "status"], as: BridgeStatusPayload.self)
    }

    func linkCurrent() async throws -> BridgeLinkCurrentPayload {
        try await run(["bridge", "link-current"], as: BridgeLinkCurrentPayload.self)
    }

    func refreshActive() async throws -> BridgeActionPayload {
        try await run(["bridge", "refresh", "--active"], as: BridgeActionPayload.self)
    }

    func refreshAll() async throws -> BridgeActionPayload {
        try await run(["bridge", "refresh", "--all"], as: BridgeActionPayload.self)
    }

    func switchAccount(id: String) async throws -> BridgeUsePayload {
        try await run(["bridge", "use", "--account", id], as: BridgeUsePayload.self)
    }

    func addAccount(label: String, deviceAuth: Bool) async throws -> BridgeActionPayload {
        var arguments = ["bridge", "add", "--label", label]
        if deviceAuth {
            arguments.append("--device-auth")
        }
        return try await run(arguments, as: BridgeActionPayload.self)
    }

    func removeAccount(id: String, purge: Bool) async throws -> BridgeActionPayload {
        var arguments = ["bridge", "remove", "--account", id]
        if purge {
            arguments.append("--purge")
        }
        return try await run(arguments, as: BridgeActionPayload.self)
    }

    func doctor() async throws -> BridgeDoctorPayload {
        try await run(["bridge", "doctor"], as: BridgeDoctorPayload.self)
    }

    private func run<Payload: Decodable & Sendable>(_ arguments: [String], as type: Payload.Type) async throws -> Payload {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            let stdout = Pipe()
            let stderr = Pipe()

            process.executableURL = cliURL
            process.arguments = arguments
            process.currentDirectoryURL = repoRoot
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
        let distCli = url.appendingPathComponent("dist/cli.js").path
        return FileManager.default.fileExists(atPath: packageJSON) && FileManager.default.fileExists(atPath: distCli)
    }
}
