// swift-tools-version: 6.3
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "SingalongPlayer",
    platforms: [
        .macOS(.v15),
    ],
    targets: [
        .executableTarget(
            name: "SingalongPlayer"
        ),
        .testTarget(
            name: "SingalongPlayerTests",
            dependencies: ["SingalongPlayer"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
