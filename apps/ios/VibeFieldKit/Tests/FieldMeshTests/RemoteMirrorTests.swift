import FieldAgents
import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

// PG-3c — the remote cut's goldens in THIS bundle: PG-3a's witness open, frames and resync, the field cut's
// project-key pair, `phone-fold.golden.json` (the home's window over the witness, which 3d's fold is held to) and,
// since PG-3e, `phone-body.golden.json` (the window's bodies, which the drawn rows' bubbles are held to).
// Copies, byte for byte, in the named set "remote" (`pnpm check:ios-fixtures`). Read here so a copy is never inert
// until 3d, and so what only FieldMesh knows — the wire's date reading, the project ledger through the drawn rows — is
// pinned beside the remote cut's words. (PG-3e, 2026-11-02: "the field cut's projection" until it retired.)

@Suite struct RemoteMirrorTests {
  static let witness = [
    "agent-remote-mesh-open.witness", "agent-remote-mesh-frames.witness", "agent-remote-mesh-open.resync",
  ]

  /// T10m — every `asOf` the witness carries, on a device entry or a state arm, is a date the phone reads.
  @Test(arguments: witness) func everyWitnessAsOfIsADate(name: String) throws {
    let json = try MeshFixture.json(name)
    var stamps: [String] = []
    if let frames = json.arrayValue {
      for frame in try frames.map(AgentRemoteMeshFrame.init(json:)) {
        if case .state(_, _, let asOf) = frame { stamps.append(asOf) }
      }
    } else {
      stamps = try AgentRemoteMeshOpen(json: json).devices.map(\.asOf)
    }
    #expect(!stamps.isEmpty)
    for stamp in stamps { #expect(parseWireDate(stamp) != nil, "\(stamp)") }
  }

  /// K1 (PG-3e; T10p until it, which read the field cut through `projectAgentField`, retired with it) — the switch moves
  /// no colour already dealt. The field cut drew both `run-h-nocwd` and `run-h-root` under the provider's label,
  /// "Claude Code" (T10p pinned it); the remote rows name "Claude Code" and "vibe-field" (`agent-field.test.ts`, the
  /// project-key pair, still in this bundle). A ledger dealt under the field cut's names keeps every seq through the
  /// drawn rows' names, and the root run moves to its folder's colour — the seq `run-h-turn`'s folder already holds,
  /// or a new deal on a ledger that holds none (J-E2).
  @Test func theLedgerKeepsItsKeysAndARootRunMovesToItsFolder() throws {
    let field = try AgentFieldSnapshot(json: try MeshFixture.json("agent-field-snapshot.project-keys"))
    let pair = field.rows.map { $0.runtimeRunId }
    #expect(pair == ["run-h-nocwd", "run-h-root"])

    // the baseline: what the field cut dealt, the home's folders first, then the provider's label for the pair
    let before = ProjectLedger.empty.dealing(["vibe-field", "puppeteer", "Claude Code"])
    let dealt = before.seqByKey
    #expect(dealt == ["vibe-field": 0, "puppeteer": 1, "Claude Code": 2])

    let bubbles = try RemoteRows.drawn().map {
      fieldBubble(from: $0, fieldIsLive: true, catalog: .empty, suppressUnread: false)
    }
    let named = ["run-h-nocwd", "run-h-root"].map { key in bubbles.first { $0.runKey == key }?.project }
    #expect(named == ["Claude Code", "vibe-field"])

    let after = before.dealing(bubbles.map { $0.project })
    let kept = dealt.keys.sorted().map { after.seqByKey[$0] }
    let wanted = dealt.keys.sorted().map { dealt[$0] }
    #expect(kept == wanted, "no colour already dealt moves")
    let root = after.seqByKey["vibe-field"]
    #expect(root == 0, "the root run takes its folder's colour")
    // a ledger that held only the provider's label deals the root run's folder anew
    let alone = ProjectLedger.empty.dealing(["Claude Code"]).dealing(["Claude Code", "vibe-field"])
    let fresh = alone.seqByKey
    #expect(fresh == ["Claude Code": 0, "vibe-field": 1])
  }

  /// T10f — the fold golden's inputs are all in this bundle, and each reads as an open or a frame list.
  @Test func theFoldGoldensInputsAreInThisBundle() throws {
    let golden = try MeshFixture.json("phone-fold.golden")
    // hoisted out of the macros: a key-path argument at the top of an #expect/#require call
    // expands into a closure the compiler reads as throwing (kit build, 2026-11-01 23:26Z)
    let listed = golden["inputs"]?.arrayValue ?? []
    let inputs = listed.compactMap { $0.stringValue }
    #expect(inputs.count == 3)
    #expect(inputs.count == listed.count)
    for input in inputs {
      let name = input.hasSuffix(".json") ? String(input.dropLast(".json".count)) : input
      let json = try MeshFixture.json(name)
      if let frames = json.arrayValue {
        let read = try frames.map(AgentRemoteMeshFrame.init(json:))
        #expect(!read.isEmpty, "\(name)")
      } else {
        let devices = try AgentRemoteMeshOpen(json: json).devices
        #expect(!devices.isEmpty, "\(name)")
      }
    }
  }

  /// T10b (PG-3e) — the body golden is in this bundle, beside the fold golden and its inputs: the open, the eight
  /// frames, the resync and the gap, eleven steps, read as JSON before the parity suite reads them as bodies.
  @Test func theBodyGoldenIsInThisBundle() throws {
    let golden = try MeshFixture.json("phone-body.golden")
    let steps = golden["steps"]?.arrayValue ?? []
    #expect(steps.count == 11)
    let listed = golden["inputs"]?.arrayValue ?? []
    let inputs = listed.compactMap { $0.stringValue }
    #expect(inputs == Self.witness.map { "\($0).json" })
  }
}
