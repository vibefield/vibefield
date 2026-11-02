import Foundation
import Testing

@testable import FieldProduct

// PG-3d — the phone's fold, held to the window's (`godview-model-board.test.ts`). The TS cases run on the MODEL cut,
// which the kit does not mirror; these are rebuilt over PG-3a's witness goldens on the remote cut (`Witness`), with
// 3c's `edited`/`at`. A synthesized desktop gets fresh ids, keys and device together (a row re-sent under another
// device would overwrite the original's held row, and its standing is read by `monitorRow.device.id`).
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

enum Witness {
  static let now = "2026-11-01T00:00:00.000Z"
  static let homeEpoch = "fieldd-9b04c1e27a6d5f30.13"
  static let loftEpoch = "fieldd-5d2c8f1a0b7e4c93.4"
  static let loftReattached = "fieldd-5d2c8f1a0b7e4c93.5"
  static let airEpoch = "fieldd-0c1d7e9a4b2f6385.2"
  static let homeRows = Remote.homeRows
  static let loftRows: [Step] = [.key("devices"), .index(1), .key("snapshot"), .key("rows")]
  static let airRows: [Step] = [.key("devices"), .index(2), .key("snapshot"), .key("rows")]
  /// `fold.upserts` of the fold golden's open: the board's order.
  static let openOrder = [
    "pty-h1", "run-h-partial", "pty-h2", "run-h-nocwd", "run-h-root", "run-h-quiet", "pty-h3", "pty-p3", "pty-p1",
    "run-p-done", "run-a-idle",
  ]

  static func openJSON() throws -> JSONValue { try Remote.witnessOpen() }
  static func open() throws -> AgentRemoteMeshOpen { try AgentRemoteMeshOpen(json: try openJSON()) }
  static func frameJSON() throws -> [JSONValue] { try Remote.frames("agent-remote-mesh-frames.witness") }
  static func frames() throws -> [AgentRemoteMeshFrame] { try frameJSON().map(AgentRemoteMeshFrame.init(json:)) }
  static func resyncJSON() throws -> JSONValue { try Fixture.json("agent-remote-mesh-open.resync") }
  static func resync() throws -> AgentRemoteMeshOpen { try AgentRemoteMeshOpen(json: try resyncJSON()) }

  /// A row of the witness open, by its board key.
  static func row(_ rows: [Step], _ key: String) throws -> JSONValue {
    let open = try openJSON()
    let found = at(open, rows + [.row(key)])
    return try #require(found)
  }

  /// The rows of one desktop's board in the witness open.
  static func rows(_ rows: [Step]) throws -> [JSONValue] {
    let open = try openJSON()
    let found = at(open, rows)?.arrayValue
    return try #require(found)
  }

  /// `row` under another key, and (each when given) another model id, owner and birth.
  static func moved(
    _ row: JSONValue, key: String, id: String? = nil, device: String? = nil, createdAt: Int64? = nil
  ) -> JSONValue {
    var json = edited(row, [.key("runtimeRunId")], .string(key))
    if let id { json = edited(json, [.key("monitorRow"), .key("id")], .string(id)) }
    if let device {
      json = edited(json, [.key("device")], .string(device))
      json = edited(json, [.key("monitorRow"), .key("device"), .key("id")], .string(device))
    }
    if let createdAt { json = edited(json, [.key("monitorRow"), .key("createdAt")], .int(createdAt)) }
    return json
  }

  static func delta(
    _ device: String, epoch: String, since: Int64, revision: Int64, upserts: [JSONValue] = [], removed: [String] = []
  ) throws -> AgentRemoteMeshFrame {
    try AgentRemoteMeshFrame(
      json: .object([
        "device": .string(device),
        "delta": .object([
          "epoch": .string(epoch), "since": .int(since), "revision": .int(revision), "upserts": .array(upserts),
          "removed": .array(removed.map(JSONValue.string)),
        ]),
      ]))
  }

  static func snapshot(_ device: String, epoch: String, revision: Int64, rows: [JSONValue]) throws
    -> AgentRemoteMeshFrame
  {
    try AgentRemoteMeshFrame(
      json: .object([
        "device": .string(device),
        "snapshot": .object(["epoch": .string(epoch), "revision": .int(revision), "rows": .array(rows)]),
      ]))
  }

  static func state(_ device: String, _ state: String, asOf: String) throws -> AgentRemoteMeshFrame {
    try AgentRemoteMeshFrame(
      json: .object(["device": .string(device), "state": .string(state), "asOf": .string(asOf)]))
  }

  static func ids(_ update: RemoteModelUpdate) -> [String] {
    switch update {
    case .snapshot(_, let rows): rows.map { $0.id }
    case .change(let change): change.upserts.map { $0.id }
    }
  }
}

extension RemoteModelBoard.Outcome {
  var change: RemoteModelChange? {
    if case .change(let change) = self { return change }
    return nil
  }

  var isGap: Bool {
    if case .gap = self { return true }
    return false
  }
}

@Suite struct RemoteModelBoardTests {
  typealias W = Witness

  static func placed(_ fold: RemoteModelBoard) -> [String] { fold.heldRows.map { "\($0.device):\($0.row.id)" } }
  static func deviceIds(_ fold: RemoteModelBoard) -> [String] { fold.devices.map { $0.device } }
  static func upserts(_ outcome: RemoteModelBoard.Outcome) -> [String]? { outcome.change?.upserts.map { $0.id } }

  /// F1 (TS `:49-80`) — the open replaces everything: the home is the first desktop, every row comes up in the
  /// board's order, `isSelf` is the home's rows alone, and each row keeps its board row.
  @Test func theOpenReplacesEverything() throws {
    var fold = RemoteModelBoard()
    let update = fold.open(try W.open())
    #expect(fold.here == Remote.home)
    #expect(fold.revision == 1)
    #expect(update.revision == 1)
    let ids = W.ids(update)
    #expect(ids == W.openOrder)
    let held = fold.heldRows.map { $0.row.id }
    #expect(held == W.openOrder)
    guard case .snapshot(_, let rows) = update else {
      Issue.record("the open is a snapshot")
      return
    }
    let mine = rows.filter { $0.isSelf }.map { $0.id }
    #expect(mine == ["pty-h1", "run-h-partial", "pty-h2", "run-h-nocwd", "run-h-root", "run-h-quiet", "pty-h3"])
    let devices = Self.deviceIds(fold)
    let states = fold.devices.map { $0.state }
    #expect(devices == [Remote.home, Remote.loft, Remote.air])
    #expect(states == [.live, .live, .asleep])
    let loft = fold.devices.first { $0.device == Remote.loft }
    #expect(loft?.epoch == W.loftEpoch)
    #expect(loft?.revision == 30)
    let crash = fold.held("pty-h3")
    #expect(crash?.board.runtimeRunId == "run-h-crash")
    #expect(crash?.device == Remote.home)

    // a second open replaces the first, on the fold's chain
    let again = fold.open(try W.resync())
    #expect(again.revision == 2)
    #expect(fold.held("run-h-quiet") == nil)
  }

  /// F2 (TS `:82-99`) — the witness frames in order: each delta on its owner's chain is the fold's next link, a
  /// state frame moves the desktop and no row, and the old chain's delta after the re-attach is a gap.
  @Test func framesInOrder() throws {
    var fold = RemoteModelBoard()
    _ = fold.open(try W.open())
    let frames = try W.frames()
    var outcomes: [RemoteModelBoard.Outcome] = []
    for frame in frames { outcomes.append(fold.frame(frame, now: W.now)) }
    #expect(outcomes.count == 9)

    let whole = try Self.rows(fold, ["pty-h2"])
    #expect(outcomes[0] == .change(RemoteModelChange(since: 1, revision: 2, upserts: whole, removed: [])))
    let first = outcomes[0].change
    #expect(first?.since == 1)
    #expect(first?.revision == 2)
    #expect(Self.upserts(outcomes[0]) == ["pty-h2"])
    #expect(first?.removed == [])
    #expect(Self.upserts(outcomes[1]) == ["run-h-partial"])
    #expect(outcomes[1].change?.since == 2)
    #expect(Self.upserts(outcomes[2]) == ["pty-p3", "pty-p1", "run-p-done"])
    #expect(outcomes[2].change?.removed == [])
    #expect(outcomes[3] == .state)
    #expect(Self.upserts(outcomes[4]) == ["pty-p3", "run-p-done"])
    #expect(outcomes[4].change?.removed == ["pty-p1"])
    #expect(outcomes[5] == .state)
    #expect(Self.upserts(outcomes[6]) == [])
    #expect(outcomes[6].change?.removed == ["run-p-done"])
    #expect(outcomes[7].change?.removed == ["run-h-quiet"])
    #expect(outcomes[7].change?.revision == 7)
    #expect(outcomes[8].isGap)
    #expect(fold.revision == 7)
  }

  /// The fold's own upserts for `ids`, as it holds them (for an equality against a whole change).
  static func rows(_ fold: RemoteModelBoard, _ ids: [String]) throws -> [RemoteModelRow] {
    try ids.map { id in
      let held = fold.held(id)
      return try #require(held).row
    }
  }

  /// F2's state frames, read on their own: the desktop's standing moves, its rows stay.
  @Test func aStateFrameMovesTheDesktopAndNoRow() throws {
    var fold = RemoteModelBoard()
    _ = fold.open(try W.open())
    let frames = try W.frames()
    _ = fold.frame(frames[2], now: W.now)
    let before = Self.placed(fold)
    let revision = fold.revision
    let outcome = fold.frame(frames[3], now: W.now)
    #expect(outcome == .state)
    let loft = fold.devices.first { $0.device == Remote.loft }
    #expect(loft?.state == .stale)
    #expect(loft?.asOf == "2026-09-30T21:20:09.000Z")
    #expect(Self.placed(fold) == before)
    #expect(fold.revision == revision)
  }

  /// F3 (TS `:101-139`) — what the fold cannot follow is a gap, and a gap moves nothing: a `since` that skips, a
  /// desktop never met, a desktop known by its state alone, and the old chain's delta after a re-attach.
  @Test func whatTheFoldCannotFollowIsAGap() throws {
    var fold = RemoteModelBoard()
    _ = fold.open(try W.open())
    let placed = Self.placed(fold)

    let skips = fold.frame(try W.delta(Remote.home, epoch: W.homeEpoch, since: 79, revision: 81), now: W.now)
    #expect(skips.isGap)
    let other = fold.frame(try W.delta(Remote.home, epoch: "fieldd-9b04c1e27a6d5f30.14", since: 80, revision: 81), now: W.now)
    #expect(other.isGap)
    let stranger = fold.frame(try W.delta("dev-0NEVER", epoch: "fieldd-0.1", since: 0, revision: 1), now: W.now)
    #expect(stranger.isGap)
    let heard = fold.frame(try W.state("dev-0STATE", "live", asOf: "2026-09-30T21:20:00.000Z"), now: W.now)
    #expect(heard == .state)
    let stateOnly = fold.frame(try W.delta("dev-0STATE", epoch: "fieldd-0.1", since: 0, revision: 1), now: W.now)
    #expect(stateOnly.isGap)
    #expect(fold.revision == 1)
    let after = Self.placed(fold)
    #expect(after == placed)

    // the loft re-attaches on a new epoch: its board is replaced, and the old chain's delta is a gap
    let frames = try W.frames()
    let reattach = fold.frame(frames[4], now: W.now)
    #expect(reattach.change?.removed == ["pty-p1"])
    let loft = fold.devices.first { $0.device == Remote.loft }
    #expect(loft?.epoch == W.loftReattached)
    let old = fold.frame(frames[8], now: W.now)
    #expect(old.isGap)
    // …and the chain goes on on `.5`
    let next = fold.frame(frames[6], now: W.now)
    #expect(next.change?.removed == ["run-p-done"])
  }

  /// F4 (TS `:141-216`) — item 137: a shell promoted to an agent keeps its body — the run's key takes the shell's id
  /// as the shell's key leaves, in ONE delta — and back when the run ends; a key that leaves alone takes the row.
  @Test func item137PromotionAndDemotionKeepOneBody() throws {
    var fold = RemoteModelBoard()
    _ = fold.open(try W.open())
    let shell = try W.row(W.homeRows, "pty-h2")
    let frames = try W.frames()

    let promotion = fold.frame(frames[0], now: W.now)
    #expect(Self.upserts(promotion) == ["pty-h2"])
    #expect(promotion.change?.removed == [])
    let promoted = fold.held("pty-h2")
    #expect(promoted?.row.monitor.kind == .agent)
    #expect(promoted?.board.runtimeRunId == "run-h-typed")

    let demotion = fold.frame(
      try W.delta(Remote.home, epoch: W.homeEpoch, since: 81, revision: 82, upserts: [shell], removed: ["run-h-typed"]),
      now: W.now)
    #expect(Self.upserts(demotion) == ["pty-h2"])
    #expect(demotion.change?.removed == [])
    let demoted = fold.held("pty-h2")
    #expect(demoted?.row.monitor.kind == .terminal)
    #expect(demoted?.board.runtimeRunId == "pty-h2")
    // the body kept its place among the home's rows
    let order = fold.heldRows.map { $0.row.id }
    #expect(order == W.openOrder)

    let leaves = fold.frame(
      try W.delta(Remote.home, epoch: W.homeEpoch, since: 82, revision: 83, removed: ["pty-h2"]), now: W.now)
    #expect(Self.upserts(leaves) == [])
    #expect(leaves.change?.removed == ["pty-h2"])
    #expect(fold.held("pty-h2") == nil)

    // the removals come in the order the keys were released, never a set's
    let two = fold.frame(
      try W.delta(Remote.home, epoch: W.homeEpoch, since: 83, revision: 84, removed: ["run-h-root", "run-h-nocwd"]),
      now: W.now)
    #expect(two.change?.removed == ["run-h-root", "run-h-nocwd"])
    var other = RemoteModelBoard()
    _ = other.open(try W.open())
    let reversed = other.frame(
      try W.delta(Remote.home, epoch: W.homeEpoch, since: 80, revision: 81, removed: ["run-h-nocwd", "run-h-root"]),
      now: W.now)
    #expect(reversed.change?.removed == ["run-h-nocwd", "run-h-root"])
  }

  /// F5 (TS `:218-313`) — item 138: every desktop keeps its place. A first-heard desktop's rows join last; a peer's
  /// same-revision re-present, its re-attach on a new epoch, its birth (inside its own group), a re-present listing
  /// the newborn first, and a whole new open listing every board's rows in another order move nothing else.
  @Test func item138EveryDesktopKeepsItsPlace() throws {
    var fold = RemoteModelBoard()
    _ = fold.open(try W.open())
    let loft = try W.row(W.loftRows, "run-p-ask")
    let board = try W.rows(W.loftRows)

    // a desktop first heard by its board joins after the others
    let woke = W.moved(loft, key: "run-0aaa", id: "run-0aaa", device: "dev-0AAA")
    _ = fold.frame(try W.snapshot("dev-0AAA", epoch: "fieldd-0aaa.1", revision: 1, rows: [woke]), now: W.now)
    let before = Self.placed(fold)
    #expect(before.suffix(2) == ["\(Remote.air):run-a-idle", "dev-0AAA:run-0aaa"])
    #expect(Self.deviceIds(fold) == [Remote.home, Remote.loft, Remote.air, "dev-0AAA"])

    // the peer re-presents its board whole at the same revision: nothing moves
    let same = fold.frame(try W.snapshot(Remote.loft, epoch: W.loftEpoch, revision: 30, rows: board), now: W.now)
    #expect(same.change?.removed == [])
    #expect(Self.placed(fold) == before)
    // …nor when it re-attaches on a new epoch
    _ = fold.frame(try W.snapshot(Remote.loft, epoch: "fieldd-5d2c.9", revision: 1, rows: board), now: W.now)
    #expect(Self.placed(fold) == before)

    // a birth on the peer joins its own desktop's rows, ahead of the next desktop's
    let born = W.moved(loft, key: "run-p-born", id: "run-p-born", createdAt: 1_790_800_200_001)
    _ = fold.frame(
      try W.delta(Remote.loft, epoch: "fieldd-5d2c.9", since: 1, revision: 2, upserts: [born]), now: W.now)
    let grown = Self.placed(fold)
    let loftAndAfter = Array(grown.suffix(6))
    #expect(
      loftAndAfter == [
        "\(Remote.loft):pty-p3", "\(Remote.loft):pty-p1", "\(Remote.loft):run-p-done", "\(Remote.loft):run-p-born",
        "\(Remote.air):run-a-idle", "dev-0AAA:run-0aaa",
      ])

    // the peer re-presents with the newborn first: the rows it still holds keep their places
    _ = fold.frame(try W.snapshot(Remote.loft, epoch: "fieldd-5d2c.9", revision: 2, rows: [born] + board), now: W.now)
    #expect(Self.placed(fold) == grown)

    // …and so does a whole new open, its boards' rows in another order (the desktops in theirs)
    var open = try W.openJSON()
    let home = try W.rows(W.homeRows)
    open = edited(open, W.homeRows, .array(home.reversed()))
    open = edited(open, W.loftRows, .array([born] + board.reversed()))
    let entries = open["devices"]?.arrayValue ?? []
    let attic = JSONValue.object([
      "device": .string("dev-0AAA"), "state": .string("live"), "asOf": .string(W.now),
      "snapshot": .object(["epoch": .string("fieldd-0aaa.2"), "revision": .int(1), "rows": .array([woke])]),
    ])
    open = edited(open, [.key("devices")], .array(entries + [attic]))
    _ = fold.open(try AgentRemoteMeshOpen(json: open))
    #expect(Self.placed(fold) == grown)
  }

  /// F6 — a desktop the new open no longer lists leaves, rows and all; nothing held belongs to an unlisted desktop.
  @Test func aDeviceTheOpenNoLongerListsLeaves() throws {
    var fold = RemoteModelBoard()
    _ = fold.open(try W.open())
    let idle = fold.held("run-a-idle")
    #expect(idle?.device == Remote.air)

    let resync = edited(try W.resyncJSON(), [.key("devices"), .index(2)], nil)
    _ = fold.open(try AgentRemoteMeshOpen(json: resync))
    #expect(fold.held("run-a-idle") == nil)
    #expect(fold.held("run-h-quiet") == nil)
    #expect(fold.devices.count == 2)
    let listed = Set(Self.deviceIds(fold))
    let owners = Set(fold.heldRows.map { $0.device })
    #expect(owners.isSubset(of: listed))
    #expect(owners == [Remote.home, Remote.loft])
  }

  /// F7 (TS `:337-379`) — M41: the write policy rides every row, the owner's word as sent (`writable: false` beside
  /// `attachable: true` is kept), and `attachable`'s rule for a peer on an older daemon that sends none.
  @Test func writablePassesAndFillsFromAttachable() throws {
    var fold = RemoteModelBoard()
    _ = fold.open(try W.open())
    let ask = try W.row(W.loftRows, "run-p-ask")
    let parted = edited(edited(ask, [.key("monitorRow"), .key("writable")], .bool(false)), [.key("monitorRow"), .key("attachable")], .bool(true))
    let one = fold.frame(try W.delta(Remote.loft, epoch: W.loftEpoch, since: 30, revision: 31, upserts: [parted]), now: W.now)
    let partedRow = one.change?.upserts.first
    #expect(partedRow?.monitor.attachable == true)
    #expect(partedRow?.monitor.writable == false)
    #expect(partedRow?.isWritable == false)

    let older = edited(ask, [.key("monitorRow"), .key("writable")], nil)
    let closed = edited(older, [.key("monitorRow"), .key("attachable")], .bool(false))
    let two = fold.frame(try W.delta(Remote.loft, epoch: W.loftEpoch, since: 31, revision: 32, upserts: [closed]), now: W.now)
    let closedRow = two.change?.upserts.first
    #expect(closedRow?.monitor.writable == nil)
    #expect(closedRow?.isWritable == false)

    let open = edited(older, [.key("monitorRow"), .key("attachable")], .bool(true))
    let three = fold.frame(try W.delta(Remote.loft, epoch: W.loftEpoch, since: 32, revision: 33, upserts: [open]), now: W.now)
    let openRow = three.change?.upserts.first
    #expect(openRow?.isWritable == true)
    #expect(fold.held("pty-p3")?.row.isWritable == true)
  }
}
