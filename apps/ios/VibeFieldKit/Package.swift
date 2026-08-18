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
    // field-native's ghosttea and truffle-core pins (both planes ride truffle
    // 0.7.12 — this line read 0.7.11 until 2026-08-09, contradicting the very
    // next sentence; the manifests were always the authority).
    // 0.10.0 is THE meeting point: the TC petition bump (2026-08-18) moved
    // every desktop plane to it (cargo ghosttea + ghosttea-truffle "=0.10.0",
    // npm overrides) when the terminal-custody petition set G15–G21 landed
    // upstream in one release. Its Swift manifest still pins truffle 0.7.12 —
    // one wire, one Arc<Node> type, both planes. This plane consumes none of
    // the new surface yet (the G16/G17 consumers are fieldd's npm client; the
    // read-surface set waits on TC-S6): the pin moves to keep the one-version
    // law true, and the resolved revision 43361e53 is the same commit every
    // published 0.10.0 artifact was built from (npm gitHead + crate vcs-info,
    // checked — the later v0.10.0-retry.1 tag shipped in none of them). It
    // still carries 0.9.0's appearance parity and 0.7.0's reconnect layer, and
    // remains the version whose TruffleTerminalMesh the desktop floor
    // publishes terminal hosts with (IOS-3's server).
    .package(url: "https://github.com/vibecook-dev/ghosttea.git", exact: "0.10.0")
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
