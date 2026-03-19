// swift-tools-version: 5.9

import PackageDescription

let package = Package(
  name: "keychain-helper",
  platforms: [
    .macOS(.v12),
  ],
  products: [
    .executable(name: "keychain-helper", targets: ["keychain-helper"]),
  ],
  targets: [
    .executableTarget(
      name: "keychain-helper",
      linkerSettings: [
        .linkedFramework("Security"),
      ],
    ),
  ],
)
