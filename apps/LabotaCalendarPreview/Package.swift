// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LabotaCalendarPreview",
    platforms: [.iOS(.v18), .macOS(.v15)],
    targets: [
        .executableTarget(
            name: "LabotaCalendarPreview",
            path: "Sources",
            exclude: ["Info.plist"]
        ),
    ]
)
