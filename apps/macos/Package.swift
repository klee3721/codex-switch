// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CodexSwitchMac",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(name: "CodexSwitchMac", targets: ["CodexSwitchMac"]),
    ],
    targets: [
        .executableTarget(
            name: "CodexSwitchMac",
            path: "Sources/CodexSwitchMac",
            resources: [
                .copy("Resources"),
            ]
        ),
        .testTarget(
            name: "CodexSwitchMacTests",
            dependencies: ["CodexSwitchMac"],
            path: "Tests/CodexSwitchMacTests"
        ),
    ]
)
