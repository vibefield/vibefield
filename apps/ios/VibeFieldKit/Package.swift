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
    .library(name: "FieldProduct", targets: ["FieldProduct"]),
    .library(name: "FieldMesh", targets: ["FieldMesh"]),
    .library(name: "FieldTerminal", targets: ["FieldTerminal"]),
    .library(name: "FieldRoutedTerminal", targets: ["FieldRoutedTerminal"]),
    .library(name: "FieldInput", targets: ["FieldInput"]),
    .library(name: "FieldSwarm", targets: ["FieldSwarm"]),
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
    // 0.10.1 (2026-08-18, revision ad97fdb): the G13 Windows env-strip
    // case-fold + process_tree hardening — no Apple-plane delta; the pin
    // moves for the one-version law, same as every row above.
    .package(url: "https://github.com/vibecook-dev/ghosttea.git", exact: "0.10.1")
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
    // The product-API client (IOS-4a, H-D3): JSON-RPC 2.0 over one WebSocket
    // to a desktop's capability URL, the tolerant readers for the shapes the
    // phone reads, and the subscription state machine. No UI and NO Ghosttea
    // product — the wall is the manifest's, not a habit: this target is what
    // the phone knows about fieldd, and the mesh leg below depends on IT for
    // the wire shapes rather than the other way round.
    .target(name: "FieldProduct"),
    // The mesh leg: the in-process Truffle/Tailscale runtime, login flow,
    // peer roster (IOS-2) — and since IOS-3, remote-session discovery, which
    // maps upstream's session summaries into FieldAgents' own vocabulary so
    // the projection that makes bubbles never learns a Ghosttea type.
    .target(
      name: "FieldMesh",
      dependencies: [
        "FieldDesign",
        "FieldAgents",
        "FieldProduct",
        .product(name: "GhostteaTruffle", package: "ghosttea"),
      ],
      // The contracts' golden board, byte for byte, so `-vf-demo-field-slice`
      // draws the swarm over REAL-shaped rows through the real reader and the
      // real fold. Only DEBUG code reads it (`FieldStoreDoors.goldenBoard`);
      // resources are not conditional, so ~4 KB of inert JSON rides along in
      // Release, which is the price of a screenshot gate with provenance.
      resources: [.copy("Fixtures")]
    ),
    // The terminal leg (IOS-3, re-footed at TM-5): everything that knows
    // Ghosttea's RENDERER exists — appearance → presentation config, the
    // attachment, the frame sink, the Metal surface. Kept apart from FieldHome
    // so the card composes a terminal without the field learning how one works.
    //
    // `GhostteaTruffle` left at TM-5 with the TSP1 lifecycle it was here for
    // (the peer directory, the compact dialer, the replica sink, the banner
    // presenter). What remains of Ghosttea in this target is the RENDERER and
    // nothing else; the wire is `FieldRoutedTerminal`'s, and `FieldProduct` is
    // named for the one type a ticket arrives as (`JSONValue`) — which is what
    // lets the composition layer hand one over without either side importing
    // the other's vocabulary.
    .target(
      name: "FieldTerminal",
      dependencies: [
        "FieldDesign",
        "FieldProduct",
        "FieldRoutedTerminal",
        .product(name: "GhostteaTerminal", package: "ghosttea"),
        .product(name: "GhostteaCore", package: "ghosttea"),
        .product(name: "GhostteaAppearance", package: "ghosttea"),
      ]
    ),
    // The ROUTED T1 client (TM-4): the phone's half of the terminal pipeline —
    // two `URLSessionWebSocketTask` legs to one cell's doors, the grant-carrying
    // handshake, per-session activation, byte credits, the presentation envelope
    // and its transfers. It takes FieldProduct for the tolerant-reader
    // vocabulary (`JSONValue`/`WireObject`) and NOTHING else: no Ghosttea
    // product, no design kit, no mesh. That is the manifest enforcing TM-D4 —
    // this code is written to move upstream into GhostteaKit as the third
    // routed-client core (petition G27), and the two FieldProduct types are the
    // whole of what such a move would have to take or replace.
    .target(name: "FieldRoutedTerminal", dependencies: ["FieldProduct"]),
    // The input card (IOS-5a): the composer, the rail, the latch — K-D1's own
    // target rather than more of FieldHome. The IOS-3 review's finding was that
    // every serious bug it found lived in the one module with no test target,
    // and a keyboard is state machines all the way down (a latch, two modes,
    // two first responders). It takes FieldTerminal for the KEYSTROKE
    // VOCABULARY ONLY and lists no Ghosttea product, which is what makes
    // "the card composes a terminal without knowing how one works" a fact the
    // manifest enforces rather than a habit.
    .target(name: "FieldInput", dependencies: ["FieldDesign", "FieldAgents", "FieldTerminal"]),
    // The swarm on Metal (IOS-6c, D-i11): the renderer — a transcription of
    // the reference's WebGPU swarm (puppeteer `packages/views`, RFC 005) —
    // its glyph and mark atlases, the stage that drives it from the physics,
    // the SwiftUI face the home screen mounts, and the design lab behind
    // `-vf-swarm-lab`. The six shaders ride as resources and compile at first
    // use (D-i14); the mark atlas is the reference's own png, byte for byte.
    // Takes FieldAgents for the body model and SwarmPhysics for the world and
    // names no Ghosttea product: the field knows nothing of terminals.
    .target(
      name: "FieldSwarm",
      dependencies: ["FieldDesign", "SwarmPhysics", "FieldAgents"],
      resources: [.copy("Shaders"), .copy("Resources/marks.png")],
      linkerSettings: [.linkedFramework("Metal"), .linkedFramework("MetalKit")]
    ),
    // The home screen: the field's composition, bubble chrome, session card.
    .target(
      name: "FieldHome",
      dependencies: [
        "FieldDesign", "SwarmPhysics", "FieldAgents", "FieldMesh", "FieldTerminal", "FieldInput",
        "FieldSwarm",
      ],
      resources: [.process("Resources")]
    ),
    .testTarget(name: "SwarmPhysicsTests", dependencies: ["SwarmPhysics"]),
    .testTarget(name: "FieldAgentsTests", dependencies: ["FieldAgents"]),
    .testTarget(
      name: "FieldProductTests",
      dependencies: ["FieldProduct"],
      // The contracts' OWN goldens, copied in (EL9 on the third side): the
      // bytes the TypeScript tests parse are the bytes these tests parse.
      resources: [.copy("Fixtures")]
    ),
    .testTarget(
      name: "FieldRoutedTerminalTests",
      dependencies: ["FieldRoutedTerminal"],
      // The contracts' OWN goldens, copied in (EL9 on the third side): the bytes
      // the TypeScript tests parse and the Rust cell's fixture tests parse are
      // the bytes these tests parse. `pnpm check:ios-fixtures` is what keeps the
      // word "copy" true.
      resources: [.copy("Fixtures")]
    ),
    .testTarget(name: "FieldMeshTests", dependencies: ["FieldMesh"]),
    .testTarget(
      name: "FieldTerminalTests",
      dependencies: ["FieldTerminal", "FieldRoutedTerminal"],
      // TM-5's witness needs two kinds of bytes. `tp-remote-open-ticket.valid`
      // is the contracts' OWN golden, copied in (EL9 on the third side) and
      // kept byte-identical by `pnpm check:ios-fixtures`; `trf1-frames.lane` is
      // a LANE fixture — two real frames from the repo's terminal-perf corpus,
      // which no contracts directory carries and the gate therefore ignores.
      resources: [.copy("Fixtures")]
    ),
    .testTarget(name: "FieldInputTests", dependencies: ["FieldInput"]),
    .testTarget(name: "FieldSwarmTests", dependencies: ["FieldSwarm"]),
    // The home screen's DECISIONS, which is all of it that is testable without
    // a simulator — and, until this target existed, all of it that was
    // untested: the integrator carried three state-machine bugs (the parked
    // poll, the card's ended face, the double attach) that no other target
    // could have caught.
    .testTarget(name: "FieldHomeTests", dependencies: ["FieldHome"]),
  ]
)
