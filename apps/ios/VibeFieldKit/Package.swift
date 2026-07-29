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
    .library(name: "FieldHome", targets: ["FieldHome"]),
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
    // The home screen: swarm field rendering, bubble chrome, session card.
    .target(
      name: "FieldHome",
      dependencies: ["FieldDesign", "SwarmPhysics", "FieldAgents"],
      resources: [.process("Resources")]
    ),
    .testTarget(name: "SwarmPhysicsTests", dependencies: ["SwarmPhysics"]),
    .testTarget(name: "FieldAgentsTests", dependencies: ["FieldAgents"]),
  ]
)
