import FieldAgents
import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

// PG-3c — the remote cut's goldens in THIS bundle: PG-3a's witness open, frames and resync, the field cut's
// project-key pair, and `phone-fold.golden.json` (the home's window over the witness, which 3d's fold is held to).
// Copies, byte for byte, in the named set "remote" (`pnpm check:ios-fixtures`). Read here so a copy is never inert
// until 3d, and so what only FieldMesh knows — the wire's date reading, the field cut's projection — is pinned beside
// the remote cut's words.

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

  /// T10p — the field cut collapses what the remote cut names: through the kit's projection a run with no cwd and one
  /// with only a workspace both read as their provider's label, where the remote rows name "Claude Code" and
  /// "vibe-field" (`agent-field.test.ts`, the project-key pair).
  @Test func theFieldCutCollapsesWhatTheRemoteCutNames() throws {
    let field = try AgentFieldSnapshot(json: try MeshFixture.json("agent-field-snapshot.project-keys"))
    #expect(field.rows.map(\.runtimeRunId) == ["run-h-nocwd", "run-h-root"])
    #expect(projectAgentField(rows: field.rows).agents.map(\.project) == ["Claude Code", "Claude Code"])

    let open = try AgentRemoteMeshOpen(json: try MeshFixture.json("agent-remote-mesh-open.witness"))
    let rows = open.devices.compactMap(\.snapshot).flatMap(\.rows)
    let named = ["run-h-nocwd", "run-h-root"].map { key in
      rows.first { $0.runtimeRunId == key }?.monitorRow.project.name
    }
    #expect(named == ["Claude Code", "vibe-field"])
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
}
