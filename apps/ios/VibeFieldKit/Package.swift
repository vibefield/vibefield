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
    .library(name: "FieldHistory", targets: ["FieldHistory"]),
    .library(name: "FieldWorkspace", targets: ["FieldWorkspace"]),
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
    // still carries 0.9.0's appearance parity and 0.7.0's reconnect layer.
    //
    // **ERRATUM (2026-09-14, TM-5).** The sentence that stood here — "and
    // remains the version whose TruffleTerminalMesh the desktop floor publishes
    // terminal hosts with (IOS-3's server)" — is FALSE and was false from
    // TM-1: that slice deleted `terminal_mesh.rs`, `with_terminal_mesh` and
    // the `ghosttea-truffle` dependency from the floor, so no version of it
    // publishes anything for this phone to read. It is doubly moot now — this
    // kit takes no `GhostteaTruffle` product at all, and the pin's whole job is
    // the RENDERER. The manifests are the authority for every number here, as
    // the errata rule says and this line failed to be.
    // 0.10.1 (2026-08-18, revision ad97fdb): the G13 Windows env-strip
    // case-fold + process_tree hardening — no Apple-plane delta; the pin
    // moves for the one-version law, same as every row above.
    .package(url: "https://github.com/vibecook-dev/ghosttea.git", exact: "0.10.1"),
    // Truffle, DIRECTLY since TM-5 — declared here instead of arriving
    // transitively through `GhostteaTruffle`.
    //
    // The phone's node was always truffle's (`MeshNode.startTailscale`,
    // `MeshConfiguration`, `Peer`, `MeshPhase`); what ghosttea's product added
    // was the TSP1 attach path, which retired with the protocol. Dropping the
    // product from `FieldMesh` therefore drops the only row that was carrying
    // truffle into this graph, so the dependency has to be stated rather than
    // inherited. EL8 binds it to field-native's `truffle-core`: two planes, ONE
    // revision, and the manifests are the authority for the number.
    //
    // **ERRATUM (2026-09-16).** The sentence that stood here — "EL8 unchanged:
    // `0.7.12` is field-native's `truffle-core` pin and the revision
    // `Package.resolved` already carries" — described a state this file did not
    // have: the RFC 025 petition window had moved the Rust pin to `=0.7.13` and
    // taken this row to a PATH package reached through `.window/truffle`, and a
    // path package records no revision, so `Package.resolved` carried no truffle
    // row at all. The rule the sentence stated was intact throughout; its
    // numbers were not.
    //
    // **THE WINDOW CLOSED ON 2026-09-16 (UA-P-X) — BUT NOT ON THIS PLANE.**
    // truffle 0.7.14 published RFC 025's login-scoped nodes (tag `v0.7.14`,
    // commit 9f0d6287), and cargo and npm both took it: `truffle-core` is a
    // registry pin again and apps/desktop installs the protocol-5 sidecar. This
    // row could not follow, and the reason is a VICE, not a choice — both ways
    // out are closed, each measured rather than assumed.
    //
    // Forward to 0.7.14 is UNSATISFIABLE. `ghosttea` declares
    // `.package(url: truffleRepository, exact: "0.7.12")` of its own, and every
    // published ghosttea Swift tag through v0.11.1 still reads
    // `let truffleVersion: Version = "0.7.12"` (checked at v0.10.1, v0.11.0 and
    // v0.11.1). Two EXACT requirements at different versions cannot both hold:
    //
    //     error: Dependencies could not be resolved because root depends on
    //     'truffle' 0.7.14. 'truffle' 0.7.12 is required because 'ghosttea'
    //     0.10.1 depends on 'truffle' 0.7.12 and root depends on 'ghosttea'
    //     0.10.1.
    //
    // Back to the released 0.7.12 DOES resolve — and then does not COMPILE,
    // because UA-P-5a (`77a771c7`) taught this kit the login API that shipped in
    // RFC 025 and exists in no 0.7.12:
    //
    //     FieldTruffleRuntime.swift:91: value of type 'MeshConfiguration' has no
    //       member 'loginAllow'
    //     FieldTruffleRuntime.swift:135: extra argument 'loginAllow' in call
    //     FieldTruffleRuntime.swift:143,179: 'MeshNode' has no member 'loginName'
    //     FieldTruffleRuntime.swift:157: 'MeshNode' has no member 'loginAllow'
    //     FieldStoreDoors+Mesh.swift:140: 'Peer' has no member 'loginName'
    //
    // So the path package STAYS until the one thing that can free it lands: a
    // ghosttea Swift release whose `truffleVersion` is 0.7.14. That is GT-4's
    // cargo conflict in the other direction and it resolves upstream the same
    // way — nothing in this repo can do it. Filed as the Apple plane's exit
    // precondition; the root Cargo.toml's closure note names it too.
    //
    // What the window's remaining half still is, and why it is shaped this way:
    // a path package's identity is its DIRECTORY NAME, so reaching the checkout
    // through a symlink named `truffle` is what lets this root-local package
    // OVERRIDE ghosttea's remote edge — pointed straight at `../truffle-rfc025`
    // the graph gets two packages and SwiftPM refuses ("multiple similar targets
    // 'TailscaleKit', 'Truffle', … appear in package 'truffle-rfc025' and
    // 'truffle'"). A path package records no revision, so `Package.resolved`
    // carries NO truffle row while this stands; that absence is the window's
    // shape, not a missing pin, and siblings.lock.json's SHA is the pin. SwiftPM
    // warns about the URL-vs-path identity conflict on every resolve and says it
    // will one day be an error — that warning is the cost of the override.
    //
    // The checkout this reads is the RELEASED code, not a pre-release: on
    // 2026-09-16 `../truffle-rfc025` was advanced to 9f0d6287, the commit tagged
    // `truffle-v0.7.14`, and siblings.lock.json pins exactly that (`pnpm
    // siblings:pin`, an EL8 event — and the one sibling pin that raises no
    // unpushed-revision warning, because it IS a published tag). So all three
    // planes now read 0.7.14; this one just reaches it through a path package
    // instead of a version, because ghosttea's exact pin will not let a version
    // through. That is the whole residue of the window, and the ghosttea release
    // is what ends it.
    .package(path: ".window/truffle"),
  ],
  targets: [
    // Design tokens and shared chrome — the godview monochrome language.
    // The chrome's glyph set rides as template SVGs (DESIGN.md §13; generated by
    // tooling/glyphs from the same drawings the desktop draws).
    .target(name: "FieldDesign", resources: [.process("Resources")]),
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
    // The mesh leg: the in-process Truffle/Tailscale runtime, login flow, peer
    // roster (IOS-2), the synced stores and the product-door join (IOS-4b).
    //
    // NO Ghosttea product since TM-5. It held one for exactly one reason — the
    // TSP1 peer directory and dialer the old attach path used — and the attach
    // is a routed T1 client now. What the mesh leg needs is truffle's node, so
    // truffle is what it names.
    .target(
      name: "FieldMesh",
      dependencies: [
        "FieldDesign",
        "FieldAgents",
        "FieldProduct",
        .product(name: "Truffle", package: "truffle"),
        .product(name: "TruffleTailscale", package: "truffle"),
      ],
      // The contracts' golden MESH board (`agent-mesh-open.valid.json`), byte
      // for byte, so `-vf-demo-field-slice` draws the swarm over REAL-shaped
      // rows through the real home path and the real fold (DS-8, 2026-10-01;
      // it was the golden `field.agents.v1` slice until DS-D14 retired that
      // reader). Only DEBUG code reads it (`FieldLink.goldenFixture`);
      // resources are not conditional, so ~6 KB of inert JSON rides along in
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
    // The History tab (IOS-9b, H-D4): the ledger, a project, a session's
    // document and search — chrome family only, over VALUES (`HistoryCorpus`)
    // that today only the mock fills (`-vf-mock`) and the index reads will.
    // Takes FieldDesign for the tokens and FieldAgents for the dealt project
    // colour; names no mesh and no Ghosttea product, so the tab's decisions
    // (`FieldHistoryModel`) test without a simulator.
    // SP-6 — the reads over a desktop's door (`HistoryDesktopReader`) take
    // FieldProduct for the client's two verbs and the tolerant readers; the
    // contracts' goldens under `Fixtures/` feed `-vf-demo-history-door`, the
    // real reads over an in-process door (byte-identical copies, the gate
    // keeps the word "copy" true). Still no mesh and no Ghosttea product.
    .target(
      name: "FieldHistory",
      dependencies: ["FieldDesign", "FieldAgents", "FieldProduct"],
      resources: [.copy("Fixtures")]
    ),
    // The home screen: the field's composition, bubble chrome, session card —
    // and since IOS-9a the tab bar the two views stand under.
    .target(name: "FieldWorkspace", dependencies: ["FieldProduct", "FieldDesign"], resources: [.copy("Fixtures")]),
    .testTarget(name: "FieldWorkspaceTests", dependencies: ["FieldWorkspace", "FieldProduct"], resources: [.copy("Fixtures")]),
    .target(
      name: "FieldHome",
      dependencies: [
        "FieldDesign", "SwarmPhysics", "FieldAgents", "FieldMesh", "FieldTerminal", "FieldInput",
        "FieldSwarm", "FieldHistory", "FieldWorkspace", "FieldProduct",
      ],
      resources: [.process("Resources")]
    ),
    .testTarget(name: "SwarmPhysicsTests", dependencies: ["SwarmPhysics"]),
    // The face (IOS-8a, DESIGN.md §2.8): the deal, the hash, the tilt and the
    // edge pinned to goldens computed from the contracts' own TypeScript, and
    // the die-cut witnessed on pixels.
    .testTarget(name: "FieldDesignTests", dependencies: ["FieldDesign"]),
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
    .testTarget(
      name: "FieldMeshTests",
      dependencies: ["FieldMesh"],
      // UA-P-5 — the contracts' OWN goldens, copied in (EL9 on the third
      // side). The store bus is live again on a gated node, so the slice
      // readers this target drives sit on a wire seam once more — and a reader
      // pinned by JSON a lane typed out by hand is pinned to that lane's idea
      // of the shape. `pnpm check:ios-fixtures` keeps the word "copy" true.
      resources: [.copy("Fixtures")]
    ),
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
    .testTarget(
      name: "FieldSwarmTests",
      dependencies: ["FieldSwarm"],
      // AC-5 — the contracts' OWN catalog golden, copied in (EL9 on the third
      // side): the mark atlas is held to the agents the catalog decides on,
      // not to a roster of its own. `pnpm check:ios-fixtures` keeps the word
      // "copy" true.
      resources: [.copy("Fixtures")]
    ),
    // The home screen's DECISIONS, which is all of it that is testable without
    // a simulator — and, until this target existed, all of it that was
    // untested: the integrator carried three state-machine bugs (the parked
    // poll, the card's ended face, the double attach) that no other target
    // could have caught.
    .testTarget(name: "FieldHomeTests", dependencies: ["FieldHome"]),
    // The History tab's DECISIONS (H-D4): ranking, the scope line, the search's
    // matching and counts, where a hit lands, the stepper's ring.
    .testTarget(
      name: "FieldHistoryTests",
      dependencies: ["FieldHistory", "FieldProduct"],
      // SP-6 — the contracts' OWN goldens, copied in (EL9 on the third side):
      // the fold reads the same bytes the TypeScript tests parse.
      resources: [.copy("Fixtures")]
    ),
  ]
)
