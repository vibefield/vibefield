// swift-tools-version: 6.0
// VibeFieldKit — all product code for the VibeField iOS companion.
// The Xcode project at ../VibeField.xcodeproj is a thin composition shell;
// features, design tokens, physics, and domain logic live here as library
// targets so they stay testable without a simulator where possible and the
// pbxproj never grows source references.
import PackageDescription

let package = Package(
  name: "VibeFieldKit",
  platforms: [
    // Floor matches the pinned TailscaleKit binary the Ghosttea/Truffle stack
    // requires (GhostteaApp README); raising it later is a deliberate event.
    .iOS("18.1")
  ],
  products: [
    .library(name: "FieldDesign", targets: ["FieldDesign"]),
    .library(name: "SwarmPhysics", targets: ["SwarmPhysics"]),
    .library(name: "FieldAgents", targets: ["FieldAgents"]),
    .library(name: "FieldMesh", targets: ["FieldMesh"]),
    .library(name: "FieldHome", targets: ["FieldHome"]),
  ],
  dependencies: [
    // The Ghosttea Apple stack (terminal + Truffle mesh). Exact pin — EL8:
    // bumping it is a deliberate upgrade event, moved in lockstep with
    // field-native's truffle-core pin (both planes ride truffle 0.7.11).
    .package(url: "https://github.com/vibecook-dev/ghosttea.git", exact: "0.6.1")
  ],
  targets: [
    // Design tokens and shared chrome — the godview monochrome language.
    .target(name: "FieldDesign"),
    // Matter.js-parity 2D solver for the bubble field. Pure Swift, no UI
    // imports, deterministic under an injected RNG — unit-tested headless.
    .target(name: "SwarmPhysics"),
    // Agent domain: chopsticks-shaped state, status classification, identity
    // color, and the scripted mock fleet that stands in for the daemon feed.
    .target(name: "FieldAgents", dependencies: ["SwarmPhysics"]),
    // The mesh leg: the in-process Truffle/Tailscale runtime, login flow,
    // and peer roster — the phone joins the tailnet here (IOS-2).
    .target(
      name: "FieldMesh",
      dependencies: [
        "FieldDesign",
        .product(name: "GhostteaTruffle", package: "ghosttea"),
      ]
    ),
    // The home screen: swarm field rendering, bubble chrome, session card.
    .target(
      name: "FieldHome",
      dependencies: ["FieldDesign", "SwarmPhysics", "FieldAgents", "FieldMesh"],
      resources: [.process("Resources")]
    ),
    .testTarget(name: "SwarmPhysicsTests", dependencies: ["SwarmPhysics"]),
    .testTarget(name: "FieldAgentsTests", dependencies: ["FieldAgents"]),
    .testTarget(name: "FieldMeshTests", dependencies: ["FieldMesh"]),
  ]
)
