import Foundation
import Testing
@testable import CodexSwitchMac

private func withTemporaryDirectory(_ body: (URL) throws -> Void) throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    try body(directory)
}

@Test
func timeRemainingFormatsHoursAndMinutes() {
    let now = Date(timeIntervalSince1970: 1_700_000_000)
    let target = now.addingTimeInterval((2 * 60 * 60) + (15 * 60))

    #expect(timeRemaining(until: target.timeIntervalSince1970, now: now) == "2h 15m")
}

@Test
func timeRemainingFormatsExpiredAsNow() {
    let now = Date(timeIntervalSince1970: 1_700_000_000)

    #expect(timeRemaining(until: now.addingTimeInterval(-30).timeIntervalSince1970, now: now) == "now")
}

@Test
func menuPerformanceMonitorIsDisabledByDefault() {
    let configuration = MenuPerformanceConfiguration.fromEnvironment([:])

    #expect(configuration.isEnabled == false)
    #expect(configuration.mainThreadPingIntervalTicks == 8)
}

@Test
func menuPerformanceMonitorCanBeEnabledFromEnvironment() {
    let configuration = MenuPerformanceConfiguration.fromEnvironment([
        "CODEX_SWITCH_ENABLE_MENU_PERF_MONITOR": "true",
    ])

    #expect(configuration.isEnabled == true)
}

@Test
func bundledBridgeDirectoryFindsBridgeInResourcesRoot() throws {
    try withTemporaryDirectory { directory in
        let bridgeDirectory = directory.appendingPathComponent("bridge", isDirectory: true)
        try FileManager.default.createDirectory(at: bridgeDirectory, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: bridgeDirectory.appendingPathComponent("bridge-cli.js").path, contents: Data())

        let resolved = CodexBridgeClient.bundledBridgeDirectory(resourcesURL: directory)

        #expect(resolved == bridgeDirectory)
    }
}

@Test
func bundledBridgeDirectoryFindsBridgeInNestedResourcesDirectory() throws {
    try withTemporaryDirectory { directory in
        let nestedResources = directory.appendingPathComponent("Resources", isDirectory: true)
        let bridgeDirectory = nestedResources.appendingPathComponent("bridge", isDirectory: true)
        try FileManager.default.createDirectory(at: bridgeDirectory, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: bridgeDirectory.appendingPathComponent("bridge-cli.js").path, contents: Data())

        let resolved = CodexBridgeClient.bundledBridgeDirectory(resourcesURL: directory)

        #expect(resolved == bridgeDirectory)
    }
}

@Test
func validatedWorkingDirectoryRejectsMissingDirectory() {
    let missingDirectory = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)

    #expect(CodexBridgeClient.validatedWorkingDirectory(missingDirectory) == nil)
}
