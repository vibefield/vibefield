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
    .library(name: "FieldTerminal", targets: ["FieldTerminal"]),
    .library(name: "FieldHome", targets: ["FieldHome"]),
  ],
  dependencies: [
    // The Ghosttea Apple stack (terminal + Truffle mesh). Exact pin — EL8:
    // bumping it is a deliberate upgrade event, moved in lockstep with
    // field-native's truffle-core pin (both planes ride truffle 0.7.11).
    // 0.9.2 is THE meeting point: GT-4a2 moved every desktop plane to it
    // (cargo ghosttea + ghosttea-truffle "=0.9.2", truffle-core "=0.7.12"),
    // and 0.9.2's Swift manifest pins the same truffle 0.7.12 — one wire, one
    // Arc<Node> type, both planes. It carries 0.9.0's appearance parity and
    // 0.7.0's reconnect layer, and it is the version whose TruffleTerminalMesh
    // the desktop floor now publishes terminal hosts with (IOS-3's server).
    .package(url: "https://github.com/vibecook-dev/ghosttea.git", exact: "0.9.2")
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
    // peer roster (IOS-2) — and since IOS-3, remote-session discovery, which
    // maps upstream's session summaries into FieldAgents' own vocabulary so
    // the projection that makes bubbles never learns a Ghosttea type.
    .target(
      name: "FieldMesh",
      dependencies: [
        "FieldDesign",
        "FieldAgents",
        .product(name: "GhostteaTruffle", package: "ghosttea"),
      ]
    ),
    // The terminal leg (IOS-3): everything that knows Ghosttea's renderer
    // exists — appearance → presentation config, the attachment lifecycle,
    // and the Metal surface. Kept apart from FieldHome so the card composes
    // a terminal without the field learning how one works.
    .target(
      name: "FieldTerminal",
      dependencies: [
        "FieldDesign",
        .product(name: "GhostteaTruffle", package: "ghosttea"),
        .product(name: "GhostteaTerminal", package: "ghosttea"),
        .product(name: "GhostteaCore", package: "ghosttea"),
        .product(name: "GhostteaAppearance", package: "ghosttea"),
      ]
    ),
    // The home screen: swarm field rendering, bubble chrome, session card.
    .target(
      name: "FieldHome",
      dependencies: [
        "FieldDesign", "SwarmPhysics", "FieldAgents", "FieldMesh", "FieldTerminal",
      ],
      resources: [.process("Resources")]
    ),
    .testTarget(name: "SwarmPhysicsTests", dependencies: ["SwarmPhysics"]),
    .testTarget(name: "FieldAgentsTests", dependencies: ["FieldAgents"]),
    .testTarget(name: "FieldMeshTests", dependencies: ["FieldMesh"]),
    .testTarget(name: "FieldTerminalTests", dependencies: ["FieldTerminal"]),
    // The home screen's DECISIONS, which is all of it that is testable without
    // a simulator — and, until this target existed, all of it that was
    // untested: the integrator carried three state-machine bugs (the parked
    // poll, the card's ended face, the double attach) that no other target
    // could have caught.
    .testTarget(name: "FieldHomeTests", dependencies: ["FieldHome"]),
  ]
)
