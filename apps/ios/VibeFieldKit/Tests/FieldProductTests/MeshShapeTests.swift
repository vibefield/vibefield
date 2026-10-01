import Foundation
import Testing

@testable import FieldProduct

// DS-8 — the mesh board's wire, read on the phone: `agent.subscribe
// {projection: "field", scope: "mesh"}` answers `AgentMeshOpen` and every later
// frame is one `AgentMeshFrame` (`packages/contracts/src/agent-field.ts`,
// `rows.ts`). `agent-mesh-open.valid.json` and `agent-mesh-frames.valid.json`
// under `Fixtures/` are the contracts' own goldens, byte for byte
// (`pnpm check:ios-fixtures` gates the copies), so a wire change upstream is a
// red here rather than a blank field on a phone.

@Suite struct AgentMeshOpenTests {
  /// Every self desktop the home's roster lists, each with its state, when that
  /// was established, and — once it has answered — its own board on its own
  /// chain. The answering desktop is first and live.
  @Test func theGoldenOpenReadsAsEveryDesktopOnItsOwnChain() throws {
    let open = try AgentMeshOpen(json: try Fixture.json("agent-mesh-open.valid"))
    #expect(open.devices.map(\.device) == [
      "dev-01HQ8ZK4M7", "dev-01HQ9S7UD1", "dev-01HQA1RL4P", "dev-01HQB3M1N1",
    ])
    #expect(open.devices.map(\.state) == [.live, .live, .asleep, .stale])
    #expect(open.droppedDevices.isEmpty)
    #expect(open.unknownFields.isEmpty)

    let home = try #require(open.devices.first?.snapshot)
    #expect(home.epoch == "fieldd-5d1e2a7c90b3f418.2")
    #expect(home.revision == 4)
    #expect(home.rows.map(\.runtimeRunId) == ["run-here-w"])

    // DS-L8 — the desktop that went to sleep keeps its last board, and says so
    // by its STATE, never by an absence.
    let asleep = try #require(open.devices.first { $0.state == .asleep })
    #expect(asleep.asOf == "2026-09-30T18:41:10.000Z")
    #expect(asleep.snapshot?.rows.map(\.runtimeRunId) == ["run-air-i"])

    // A desktop that has not answered is still LISTED, with no board.
    #expect(open.devices.last?.snapshot == nil)
  }

  /// The golden's boards are DESK rows (the reply line, the cost): a field
  /// reader reads them as field rows and keeps the rest as unread fields —
  /// the passthrough the contracts promise, and SP-L4's reason the phone asks
  /// `field` rather than `desk`.
  @Test func aDeskRowReadsAsAFieldRowWithTheRestUnread() throws {
    let open = try AgentMeshOpen(json: try Fixture.json("agent-mesh-open.valid"))
    let row = try #require(open.devices[1].snapshot?.rows.first)
    #expect(row.runtimeRunId == "run-studio-q")
    #expect(row.statusValue == .blocked)
    #expect(row.unknownFields.contains("lastAssistantMessage"))
  }

  /// One device entry that does not read costs that entry, never the board:
  /// it is dropped and named, and every other desktop stands.
  @Test func anUnreadableDeviceIsDroppedAndNamed() throws {
    var golden = try #require(try Fixture.json("agent-mesh-open.valid").objectValue)
    var devices = try #require(golden["devices"]?.arrayValue)
    devices.append(.object(["state": .string("live")]))
    golden["devices"] = .array(devices)
    let open = try AgentMeshOpen(json: .object(golden))
    #expect(open.devices.count == 4)
    #expect(open.droppedDevices.count == 1)
    #expect(open.droppedDevices[0].contains("device"))
  }

  /// An answer that is not the mesh's at all — a door that served a LOCAL
  /// board — is not read as one: it names no `devices`.
  @Test func aLocalBoardIsNotAMeshOpen() throws {
    let local = try Fixture.json("agent-field-snapshot.valid")
    #expect(throws: WireDecodeError.self) { _ = try AgentMeshOpen(json: local) }
  }
}

@Suite struct AgentMeshFrameTests {
  /// The three arms, in the golden's own order: one device's delta, its state,
  /// its RESET (a fresh snapshot on a new epoch), its state again, another
  /// device's delta, a sleeping device's reset on waking, its state.
  @Test func theGoldenFramesReadAsTheirThreeArms() throws {
    let frames = try #require(try Fixture.json("agent-mesh-frames.valid").arrayValue)
      .map(AgentMeshFrame.init(json:))
    #expect(frames.map(\.device) == [
      "dev-01HQ9S7UD1", "dev-01HQ9S7UD1", "dev-01HQ9S7UD1", "dev-01HQ9S7UD1",
      "dev-01HQ8ZK4M7", "dev-01HQA1RL4P", "dev-01HQA1RL4P",
    ])

    guard case .delta(_, let delta) = frames[0] else {
      Issue.record("frame 0 is not a delta")
      return
    }
    #expect(delta.epoch == "fieldd-9b04c1e27a6d5f30.7")
    #expect(delta.since == 40)
    #expect(delta.revision == 41)
    #expect(delta.upserts.map(\.statusValue) == [.working])

    guard case .state(_, let stale, let asOf) = frames[1] else {
      Issue.record("frame 1 is not a state change")
      return
    }
    #expect(stale == .stale)
    #expect(asOf == "2026-09-30T21:16:03.000Z")

    guard case .snapshot(_, let reset) = frames[2] else {
      Issue.record("frame 2 is not a reset")
      return
    }
    #expect(reset.epoch == "fieldd-9b04c1e27a6d5f30.8")
    #expect(reset.revision == 1)

    guard case .delta(_, let removal) = frames[4] else {
      Issue.record("frame 4 is not a delta")
      return
    }
    #expect(removal.removed == ["run-here-w"])
    #expect(removal.upserts.isEmpty)
  }

  /// A frame naming none of the three arms is not a frame this build can
  /// apply; the reader says so rather than guessing which it meant.
  @Test func aFrameWithNoArmDoesNotRead() {
    #expect(throws: WireDecodeError.self) {
      _ = try AgentMeshFrame(json: .object(["device": .string("dev-a")]))
    }
    #expect(throws: WireDecodeError.self) {
      _ = try AgentMeshFrame(json: .object(["state": .string("live"), "asOf": .string("x")]))
    }
  }
}

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

@Suite struct AgentMeshSubscribeTests {
  /// DS-8 — the phone's ONE subscription: the field projection of the home's
  /// mesh board, at the field's floor. Never `desk` (SP-L4), never `full`.
  @Test func thePhoneAsksTheHomeForTheMeshField() {
    #expect(
      AgentSubscribeParams.phoneMesh.json
        == .object([
          "projection": .string("field"), "scope": .string("mesh"), "minIntervalMs": .int(250),
        ]))
  }
}
