import Foundation
import Testing

@testable import FieldProduct

// DS-8 — the mesh board's wire, read on the phone: what the remote cut shares with the field cut it replaced — a
// desktop's standing word and the chain's epoch — and the phone's one ask. (PG-3e, 2026-11-02: the field mesh board's
// decoders retired, `AgentMeshOpen`/`AgentMeshFrame` and their rows over `agent-mesh-open.valid.json` and
// `agent-mesh-frames.valid.json` with them, whose copies left this bundle; the remote mesh board's rows are in
// `RemoteShapeTests`.)

@Suite struct AgentMeshDeviceStateTests {
  /// The contracts' four words, and the one rule a phone draws by: only `live`
  /// is live. A word this build has never heard is kept verbatim and drawn as
  /// not live — greyed, never a failed parse (DS-L9: additions are tolerated).
  @Test func onlyLiveIsLiveAndAnUnheardWordIsKept() {
    #expect(AgentMeshDeviceState(wire: "live") == .live)
    #expect(AgentMeshDeviceState(wire: "stale") == .stale)
    #expect(AgentMeshDeviceState(wire: "asleep") == .asleep)
    #expect(AgentMeshDeviceState(wire: "incompatible") == .incompatible)
    let archived = AgentMeshDeviceState(wire: "archived")
    #expect(archived == .unrecognized("archived"))
    #expect(archived.wire == "archived")
    #expect(AgentMeshDeviceState.live.isLive)
    #expect(![AgentMeshDeviceState.stale, .asleep, .incompatible, archived].contains { $0.isLive })
  }
}

@Suite struct AgentFieldEpochTests {
  /// DS-3 put the chain's `epoch` on the field's own snapshot and delta; a
  /// reader reads it rather than carrying it as an unknown field.
  @Test func theSnapshotAndTheDeltaNameTheirChain() throws {
    let snapshot = try AgentFieldSnapshot(
      json: .object([
        "epoch": .string("fieldd-a.1"), "revision": .int(3), "rows": .array([]),
      ]))
    #expect(snapshot.epoch == "fieldd-a.1")
    #expect(!snapshot.unknownFields.contains("epoch"))
    let delta = try AgentFieldDelta(
      json: .object([
        "epoch": .string("fieldd-a.1"), "since": .int(3), "revision": .int(4),
        "upserts": .array([]), "removed": .array([]),
      ]))
    #expect(delta.epoch == "fieldd-a.1")
    #expect(!delta.unknownFields.contains("epoch"))
    // Absent on a door older than DS-3, and that is not a failure.
    let bare = try AgentFieldSnapshot(json: .object(["revision": .int(1), "rows": .array([])]))
    #expect(bare.epoch == nil)
  }
}

@Suite struct AgentRemoteSubscribeTests {
  /// PG-3c, as the phone asks since PG-3e: the home's REMOTE cut of its mesh board, with NO interval — the door floors
  /// it by the caller's kind (`boardFloor`, fieldd's `agent-field.ts`), so the kit holds no copy of a registry number.
  /// (DS-8's `phoneMesh`, the field projection at 250 ms, retired with its row.)
  @Test func thePhoneAsksTheHomeForTheRemoteCutWithNoInterval() {
    #expect(
      AgentSubscribeParams.phoneRemote.json
        == .object(["projection": .string("remote"), "scope": .string("mesh")]))
    #expect(AgentSubscribeParams.phoneRemote.minIntervalMs == nil)
    #expect(AgentSubscribeParams.Projection(rawValue: "remote") == .remote)
  }
}
