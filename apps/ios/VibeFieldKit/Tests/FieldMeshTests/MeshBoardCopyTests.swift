import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

// DS-8 — the phone's copy of its home's mesh board, pure: an open seeds every
// desktop on its own chain, a frame moves one desktop, and a frame that does
// not continue its desktop's chain is a GAP whose only repair is a fresh open
// (DS-L3: a mismatch is a reset, never a repair). Driven by the contracts' own
// goldens (`agent-mesh-open.valid.json`, `agent-mesh-frames.valid.json`, byte
// for byte under `Fixtures/`).

private func goldenOpen() throws -> AgentMeshOpen {
  try AgentMeshOpen(json: try MeshFixture.json("agent-mesh-open.valid"))
}

private func goldenFrames() throws -> [AgentMeshFrame] {
  try #require(try MeshFixture.json("agent-mesh-frames.valid").arrayValue)
    .map(AgentMeshFrame.init(json:))
}

private func row(_ id: String, device: String = "dev-a", status: String = "working") -> JSONValue {
  .object([
    "runtimeRunId": .string(id), "revision": .int(1), "kind": .string("claude"),
    "label": .string("Claude Code"), "tier": .string("managed"), "device": .string(device),
    "status": .string(status), "statusSince": .string("2026-10-01T12:00:00.000Z"),
    "stateChangedAt": .string("2026-10-01T12:00:00.000Z"),
    "createdAt": .string("2026-10-01T11:00:00.000Z"), "alive": .bool(true),
    "blockers": .array([]),
  ])
}

private func open(_ devices: [(String, String, [JSONValue]?)]) throws -> AgentMeshOpen {
  try AgentMeshOpen(
    json: .object([
      "devices": .array(
        devices.map { device, state, rows in
          var entry: [String: JSONValue] = [
            "device": .string(device), "state": .string(state),
            "asOf": .string("2026-10-01T12:00:00.000Z"),
          ]
          if let rows {
            entry["snapshot"] = .object([
              "epoch": .string("\(device).1"), "revision": .int(1), "rows": .array(rows),
            ])
          }
          return .object(entry)
        })
    ]))
}

private func delta(
  _ device: String, epoch: String? = nil, since: Int64, revision: Int64,
  upserts: [JSONValue] = [], removed: [String] = []
) throws -> AgentMeshFrame {
  var body: [String: JSONValue] = [
    "since": .int(since), "revision": .int(revision), "upserts": .array(upserts),
    "removed": .array(removed.map(JSONValue.string)),
  ]
  body["epoch"] = .string(epoch ?? "\(device).1")
  return try AgentMeshFrame(json: .object(["device": .string(device), "delta": .object(body)]))
}

@Suite struct MeshBoardCopyTests {
  /// The open seeds every desktop the home lists, each on its own chain — the
  /// sleeping one WITH its kept board, the stale one listed with none.
  @Test func theOpenSeedsEveryDesktopOnItsOwnChain() throws {
    var copy = MeshBoardCopy()
    copy.reset(try goldenOpen())
    #expect(copy.deviceIds == ["dev-01HQ8ZK4M7", "dev-01HQ9S7UD1", "dev-01HQA1RL4P", "dev-01HQB3M1N1"])
    #expect(copy.devices["dev-01HQ9S7UD1"]?.board?.revision == 40)
    #expect(copy.devices["dev-01HQ9S7UD1"]?.board?.epoch == "fieldd-9b04c1e27a6d5f30.7")
    let asleep = try #require(copy.devices["dev-01HQA1RL4P"])
    #expect(asleep.state == .asleep)
    #expect(asleep.board?.ordered.map(\.runtimeRunId) == ["run-air-i"])
    #expect(copy.devices["dev-01HQB3M1N1"]?.state == .stale)
    #expect(copy.devices["dev-01HQB3M1N1"]?.board == nil)
  }

  /// The golden's seven frames in order, every one applied: a delta, a state, a
  /// reset on a NEW epoch, the state back, another desktop's removal, and the
  /// sleeping desktop's fresh board on waking.
  @Test func theGoldenFramesApplyInOrder() throws {
    var copy = MeshBoardCopy()
    copy.reset(try goldenOpen())
    for frame in try goldenFrames() {
      #expect(copy.apply(frame) == .applied, "\(frame.device)")
    }
    let studio = try #require(copy.devices["dev-01HQ9S7UD1"])
    #expect(studio.state == .live)
    #expect(studio.board?.epoch == "fieldd-9b04c1e27a6d5f30.8")
    #expect(studio.board?.revision == 1)
    #expect(studio.board?.ordered.map(\.statusValue) == [.working])
    let home = try #require(copy.devices["dev-01HQ8ZK4M7"])
    #expect(home.board?.revision == 5)
    #expect(home.board?.ordered.isEmpty == true)
    let woken = try #require(copy.devices["dev-01HQA1RL4P"])
    #expect(woken.state == .live)
    #expect(woken.board?.epoch == "fieldd-c3a9e0d7b1f24856.1")
  }

  /// DS-L8 — a desktop going to sleep sends only its state: the copy keeps its
  /// board, and the state is what says how far to believe it.
  @Test func aStateChangeKeepsTheBoard() throws {
    var copy = MeshBoardCopy()
    copy.reset(try open([("dev-a", "live", [row("run-1"), row("run-2")])]))
    #expect(
      copy.apply(.state(device: "dev-a", .asleep, asOf: "2026-10-01T12:05:00.000Z")) == .applied)
    #expect(copy.devices["dev-a"]?.state == .asleep)
    #expect(copy.devices["dev-a"]?.asOf == "2026-10-01T12:05:00.000Z")
    #expect(copy.devices["dev-a"]?.board?.ordered.map(\.runtimeRunId) == ["run-1", "run-2"])
  }

  /// A delta whose `since` is not this desktop's revision lost a frame: a GAP,
  /// and the copy is left exactly as it was for the fresh open to replace.
  @Test func aDeltaThatDoesNotContinueItsChainIsAGap() throws {
    var copy = MeshBoardCopy()
    copy.reset(try open([("dev-a", "live", [row("run-1")])]))
    let before = copy
    guard case .gap = copy.apply(try delta("dev-a", since: 7, revision: 8, upserts: [row("run-9")]))
    else {
      Issue.record("a delta since 7 continued a board at revision 1")
      return
    }
    #expect(copy == before)
  }

  /// The same revision on ANOTHER chain is a different board's revision — two
  /// chains are never compared (DS-L3's epoch).
  @Test func aDeltaOnAnotherChainIsAGap() throws {
    var copy = MeshBoardCopy()
    copy.reset(try open([("dev-a", "live", [row("run-1")])]))
    guard case .gap = copy.apply(try delta("dev-a", epoch: "dev-a.2", since: 1, revision: 2))
    else {
      Issue.record("a delta on chain dev-a.2 continued a board on dev-a.1")
      return
    }
  }

  /// A delta for a desktop with no board here has nothing to continue — the
  /// home's own device id moving under a reader (fieldd's fallback id swapped
  /// for the mesh identity) arrives exactly like this, and re-opens.
  @Test func aDeltaForADesktopWithNoBoardIsAGap() throws {
    var copy = MeshBoardCopy()
    copy.reset(try open([("dev-a", "stale", nil)]))
    guard case .gap = copy.apply(try delta("dev-a", since: 1, revision: 2)) else {
      Issue.record("a delta applied to a desktop with no board")
      return
    }
    guard case .gap = copy.apply(try delta("dev-nobody", since: 1, revision: 2)) else {
      Issue.record("a delta applied to a desktop the copy has never seen")
      return
    }
  }

  /// A desktop's reset replaces THAT desktop and nothing else; a continuing
  /// delta applies upserts, then removals, then the owner's revision.
  @Test func aResetMovesOneDesktopAndADeltaMovesItsRows() throws {
    var copy = MeshBoardCopy()
    copy.reset(try open([("dev-a", "live", [row("run-1")]), ("dev-b", "live", [row("b-1", device: "dev-b")])]))
    let reset = try AgentMeshFrame(
      json: .object([
        "device": .string("dev-a"),
        "snapshot": .object([
          "epoch": .string("dev-a.2"), "revision": .int(1), "rows": .array([row("run-5")]),
        ]),
      ]))
    #expect(copy.apply(reset) == .applied)
    #expect(copy.devices["dev-a"]?.board?.ordered.map(\.runtimeRunId) == ["run-5"])
    #expect(copy.devices["dev-b"]?.board?.ordered.map(\.runtimeRunId) == ["b-1"])
    #expect(
      copy.apply(
        try delta(
          "dev-a", epoch: "dev-a.2", since: 1, revision: 2, upserts: [row("run-6")],
          removed: ["run-5"])) == .applied)
    #expect(copy.devices["dev-a"]?.board?.ordered.map(\.runtimeRunId) == ["run-6"])
    #expect(copy.devices["dev-a"]?.board?.revision == 2)
  }

  /// A board that names one run twice draws it once — nothing on the field is
  /// drawn twice, whatever a frame carried.
  @Test func aRepeatedRowIsHeldOnce() throws {
    var copy = MeshBoardCopy()
    copy.reset(try open([("dev-a", "live", [row("run-1"), row("run-1", status: "idle")])]))
    #expect(copy.devices["dev-a"]?.board?.ordered.map(\.runtimeRunId) == ["run-1"])
    #expect(copy.devices["dev-a"]?.board?.ordered.first?.statusValue == .idle)
  }

  /// A fresh open REPLACES the copy: a desktop the new home does not list is
  /// gone from it, never kept beside the new answer.
  @Test func aFreshOpenReplacesTheCopy() throws {
    var copy = MeshBoardCopy()
    copy.reset(try open([("dev-a", "live", [row("run-1")]), ("dev-b", "live", [row("b-1", device: "dev-b")])]))
    copy.reset(try open([("dev-b", "live", [row("b-2", device: "dev-b")])]))
    #expect(copy.deviceIds == ["dev-b"])
    #expect(copy.devices["dev-b"]?.board?.ordered.map(\.runtimeRunId) == ["b-2"])
  }
}
