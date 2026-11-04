import Foundation
import Testing

@testable import FieldProduct

// PG-3d — the phone's replica, held to the window's (`replica.test.ts` @ puppeteer v0.3.2, the revision the lock
// pins). Rows are the witness's `run-h-turn` model row with its id, kind and birth edited (`ReplicaRow.make`), read
// through the remote cut's own reader. Every row whose last word is "nothing" (nil, unchanged, hidden) first reads a
// publication a do-nothing replica cannot make.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

enum ReplicaRow {
  /// The witness's idle agent as a replica row, edited.
  static func make(
    _ id: String, kind: MonitorRowKind = .agent, createdAt: Int64 = 1_000, status: MonitorRowStatus = .idle,
    alive: Bool = true, wait: String? = nil, detail: String? = nil
  ) throws -> RemoteModelRow {
    let turn = try Remote.turnRow()
    let found = at(turn, [.key("monitorRow")])
    var json = try #require(found)
    json = edited(json, [.key("id")], .string(id))
    json = edited(json, [.key("kind")], .string(kind.rawValue))
    json = edited(json, [.key("createdAt")], .int(createdAt))
    json = edited(json, [.key("status")], .string(status.rawValue))
    json = edited(json, [.key("alive")], .bool(alive))
    if let wait { json = edited(json, [.key("wait")], .object(["kind": .string(wait), "since": .int(1)])) }
    if let detail { json = edited(json, [.key("detail")], .string(detail)) }
    let monitor = try MonitorAgentRow(json: json)
    return RemoteModelRow(monitor, here: Remote.home)
  }

  static func change(
    _ since: Int64, _ revision: Int64, upserts: [RemoteModelRow] = [], removed: [String] = []
  ) -> RemoteModelUpdate {
    .change(RemoteModelChange(since: since, revision: revision, upserts: upserts, removed: removed))
  }

  static func ids(_ model: RemoteModel) -> [String] { model.agents.map { $0.id } }
}

@Suite struct RemoteModelReplicaTests {
  typealias R = ReplicaRow

  /// R1 (`:124-145`) — a snapshot is published at the frame, in the contract's order: agents by birth, then
  /// terminals, ties by id.
  @Test func aSnapshotPublishesInTheContractsOrder() throws {
    var replica = RemoteModelReplica()
    let rows = [
      try R.make("t1", kind: .terminal, createdAt: 0), try R.make("b", createdAt: 2_000),
      try R.make("c", createdAt: 1_000), try R.make("a", createdAt: 1_000),
    ]
    let applied = replica.apply(.snapshot(revision: 7, rows: rows))
    #expect(applied)
    #expect(replica.model.agents.isEmpty)
    let published = replica.flush()
    let ids = R.ids(replica.model)
    let sorted = rows.sorted(by: compareMonitorRows).map { $0.id }
    #expect(ids == ["a", "c", "b", "t1"])
    #expect(ids == sorted)
    #expect(replica.model.revision == 7)
    let keys = replica.model.byId.keys.sorted()
    #expect(keys == ["a", "b", "c", "t1"])
    let third = replica.model.agents.dropFirst(2).first
    #expect(third != nil)
    #expect(replica.model.byId["b"] == third)
    #expect(published == RemotePublication(added: ["a", "c", "b", "t1"], updated: [], removed: []))
    #expect(replica.flush() == nil)
  }

  /// R2 (`:147-178`) — the dedup: an equal row off the wire is no change, and neither is a re-snapshot of the same
  /// content; a row that moved is the one `updated`.
  @Test func anEqualRowIsNoChange() throws {
    var replica = RemoteModelReplica()
    let a = try R.make("a")
    let b = try R.make("b", createdAt: 2_000)
    replica.apply(.snapshot(revision: 1, rows: [a, b]))
    let first = replica.flush()
    #expect(first != nil)
    let firstModel = replica.model

    let equal = replica.apply(R.change(1, 2, upserts: [try R.make("a")]))
    #expect(equal)
    #expect(replica.flush() == nil)
    #expect(replica.model == firstModel)

    let working = try R.make("b", createdAt: 2_000, status: .working)
    replica.apply(R.change(2, 3, upserts: [working]))
    let second = replica.flush()
    #expect(second == RemotePublication(added: [], updated: ["b"], removed: []))
    #expect(replica.model.revision == 3)
    #expect(replica.model.byId["a"] == firstModel.byId["a"])
    #expect(replica.model.byId["b"]?.monitor.status == .working)
    let secondModel = replica.model

    // a re-snapshot of the same content (the host healing a gap) publishes nothing
    replica.apply(.snapshot(revision: 3, rows: [a, working]))
    #expect(replica.flush() == nil)
    #expect(replica.model == secondModel)
  }

  /// R3 (`:180-195`) — a flip inside one frame, and a removal undone before the frame, are no change.
  @Test func aFlipInsideOneFrameIsNoChange() throws {
    var replica = RemoteModelReplica()
    let a = try R.make("a")
    let b = try R.make("b", createdAt: 2_000)
    replica.apply(.snapshot(revision: 1, rows: [a, b]))
    let first = replica.flush()
    #expect(first != nil)
    let firstModel = replica.model

    replica.apply(R.change(1, 2, upserts: [try R.make("a", status: .working)]))
    replica.apply(R.change(2, 3, upserts: [a]))
    replica.apply(R.change(3, 4, removed: ["b"]))
    replica.apply(R.change(4, 5, upserts: [b]))
    #expect(replica.flush() == nil)
    #expect(replica.model == firstModel)
  }

  /// R4 (`:197-217`) — removals leave, and a row whose birth moved is re-sorted, also when it left and came back
  /// with another birth inside one frame (which the window sorts by its `reorder` flag alone).
  @Test func removesAndResortsABirthThatMoved() throws {
    var replica = RemoteModelReplica()
    replica.apply(
      .snapshot(
        revision: 1,
        rows: [try R.make("a", createdAt: 1_000), try R.make("b", createdAt: 2_000), try R.make("c", createdAt: 3_000)]))
    _ = replica.flush()

    replica.apply(R.change(1, 2, upserts: [try R.make("c", createdAt: 500)], removed: ["b"]))
    let moved = replica.flush()
    let ids = R.ids(replica.model)
    #expect(ids == ["c", "a"])
    #expect(replica.model.byId["b"] == nil)
    #expect(moved == RemotePublication(added: [], updated: ["c"], removed: ["b"]))

    replica.apply(R.change(2, 3, removed: ["a"]))
    replica.apply(R.change(3, 4, upserts: [try R.make("a", createdAt: 100)]))
    let reborn = replica.flush()
    let again = R.ids(replica.model)
    #expect(again == ["a", "c"])
    #expect(reborn == RemotePublication(added: [], updated: ["a"], removed: []))
  }

  /// R5 (`:219-251`) — a change off the held revision is a gap: not applied, heard once, and healed by a snapshot.
  @Test func aChangeOffTheChainIsAGap() throws {
    var replica = RemoteModelReplica()
    // nothing held yet: a change has nothing to apply on
    let early = replica.apply(R.change(0, 1, upserts: [try R.make("early")]))
    #expect(!early)
    #expect(replica.gapsHeard == 1)

    replica.apply(.snapshot(revision: 4, rows: [try R.make("a")]))
    _ = replica.flush()
    let held = replica.model
    #expect(R.ids(held) == ["a"])

    let skipped = replica.apply(R.change(5, 6, upserts: [try R.make("b")]))
    #expect(!skipped)
    #expect(replica.gapsHeard == 2)
    // gapped: even a link that would chain is refused until the snapshot, and the gap is heard once
    let chaining = replica.apply(R.change(4, 5, upserts: [try R.make("c")]))
    let later = replica.apply(R.change(9, 10))
    #expect(!chaining)
    #expect(!later)
    #expect(replica.gapsHeard == 2)
    #expect(replica.flush() == nil)
    #expect(replica.model == held)

    let healed = replica.apply(.snapshot(revision: 10, rows: [try R.make("a"), try R.make("b", createdAt: 2_000)]))
    #expect(healed)
    _ = replica.flush()
    let ids = R.ids(replica.model)
    #expect(ids == ["a", "b"])
    #expect(replica.model.byId["a"] == held.byId["a"])

    let next = replica.apply(R.change(10, 11, removed: ["a"]))
    #expect(next)
    _ = replica.flush()
    let after = R.ids(replica.model)
    #expect(after == ["b"])
    #expect(replica.model.revision == 11)
    #expect(replica.gapsHeard == 2)
  }

  /// R6 (`:254-277`) — the changes heard during a gap are held, and the healing snapshot replays the ones it does
  /// not hold.
  @Test func aGapHoldsAndTheSnapshotReplays() throws {
    var replica = RemoteModelReplica()
    replica.apply(.snapshot(revision: 1, rows: [try R.make("a")]))
    _ = replica.flush()
    // 1→2 is lost on the way; 2→3 and 3→4 arrive before the snapshot the gap asked for
    let lost = replica.apply(R.change(2, 3, upserts: [try R.make("b", createdAt: 2_000)]))
    let ahead = replica.apply(R.change(3, 4, upserts: [try R.make("c", createdAt: 3_000)]))
    #expect(!lost)
    #expect(!ahead)
    #expect(replica.gapsHeard == 1)
    #expect(replica.flush() == nil)
    // taken at 3, the snapshot holds 1→2 and 2→3 but not 3→4, which is not lost
    let healed = replica.apply(
      .snapshot(
        revision: 3,
        rows: [try R.make("a"), try R.make("b", createdAt: 2_000), try R.make("x", createdAt: 2_500)]))
    #expect(healed)
    _ = replica.flush()
    #expect(replica.model.revision == 4)
    let ids = R.ids(replica.model)
    #expect(ids == ["a", "b", "x", "c"])
    // the chain goes on from 4, with no second gap
    let next = replica.apply(R.change(4, 5, removed: ["x"]))
    #expect(next)
    _ = replica.flush()
    let after = R.ids(replica.model)
    #expect(after == ["a", "b", "c"])
    #expect(replica.gapsHeard == 1)
  }

  /// R7 (`:313-334`) — a link missing behind the snapshot is a new gap, heard while the snapshot itself applies, and
  /// what follows it is held for the next snapshot.
  @Test func aLinkMissingBehindTheSnapshotIsANewGap() throws {
    var replica = RemoteModelReplica()
    replica.apply(.snapshot(revision: 1, rows: [try R.make("a")]))
    replica.apply(R.change(2, 3, upserts: [try R.make("b", createdAt: 2_000)]))
    replica.apply(R.change(3, 4, upserts: [try R.make("c", createdAt: 3_000)]))
    // 4→5 is lost too
    replica.apply(R.change(5, 6, upserts: [try R.make("d", createdAt: 4_000)]))
    #expect(replica.gapsHeard == 1)
    let applied = replica.apply(.snapshot(revision: 3, rows: [try R.make("a"), try R.make("b", createdAt: 2_000)]))
    #expect(applied)
    _ = replica.flush()
    #expect(replica.gapsHeard == 2)
    #expect(replica.model.revision == 4)
    let ids = R.ids(replica.model)
    #expect(ids == ["a", "b", "c"])
    replica.apply(R.change(6, 7, removed: ["a"]))
    replica.apply(
      .snapshot(
        revision: 6, rows: [try R.make("a"), try R.make("b", createdAt: 2_000), try R.make("c", createdAt: 3_000)]))
    _ = replica.flush()
    #expect(replica.model.revision == 7)
    let after = R.ids(replica.model)
    #expect(after == ["b", "c"])
    #expect(replica.gapsHeard == 2)
  }

  /// R8 (`:336-353`) — the hold is bounded: past it the held changes are dropped, the snapshot alone heals, and the
  /// next change is a new gap.
  @Test func theHoldIsBounded() throws {
    #expect(RemoteModelReplica().gapBuffer == 256)
    var replica = RemoteModelReplica(gapBuffer: 2)
    replica.apply(.snapshot(revision: 1, rows: [try R.make("a")]))
    for since in Int64(2)...5 {
      let held = replica.apply(R.change(since, since + 1, upserts: [try R.make("r\(since)")]))
      #expect(!held, "\(since)")
    }
    replica.apply(.snapshot(revision: 3, rows: [try R.make("a")]))
    _ = replica.flush()
    #expect(replica.model.revision == 3)
    let ids = R.ids(replica.model)
    #expect(ids == ["a"])
    #expect(replica.gapsHeard == 1)
    // what was dropped is missing, so the next change is a new gap and the host snapshots again
    let next = replica.apply(R.change(6, 7))
    #expect(!next)
    #expect(replica.gapsHeard == 2)
  }

  /// R9 — the phone's visibility (`phone-goldens.ts` `phoneVisible`, `failed-bodies.ts` `keepsFailure`): a dead
  /// failure is hidden until the home holds a session for it, and leaves when the session goes; a dead row that is
  /// not a failure stays hidden whatever the joins say. The default is the rule with no joins (alive only), where the
  /// TS replica's default shows every row.
  @Test func aDeadRowIsHiddenUnlessItsFailureHasASessionHere() throws {
    var replica = RemoteModelReplica()
    let crashed = try R.make("f", createdAt: 2_000, alive: false, wait: "failure")
    let asking = try R.make("q", createdAt: 3_000, alive: false, wait: "question")
    let shell = try R.make("t", kind: .terminal, createdAt: 4_000, alive: false, wait: "failure")
    replica.apply(.snapshot(revision: 1, rows: [try R.make("a"), crashed, asking, shell]))
    let first = replica.flush()
    #expect(first == RemotePublication(added: ["a"], updated: [], removed: []))

    let joined = RemoteVisibility(sessionByRow: ["f": "pty-f", "q": "pty-q", "t": "pty-t"])
    #expect(joined.shows(crashed))
    #expect(!joined.shows(asking))
    #expect(!joined.shows(shell))
    let moved = replica.setVisibility(joined)
    #expect(moved)
    let again = replica.setVisibility(joined)
    #expect(!again)
    let shown = replica.flush()
    #expect(shown == RemotePublication(added: ["f"], updated: [], removed: []))

    replica.setVisibility(RemoteVisibility())
    let dropped = replica.flush()
    #expect(dropped == RemotePublication(added: [], updated: [], removed: ["f"]))
    let ids = R.ids(replica.model)
    #expect(ids == ["a"])
  }

  /// R10 (`model.js:18`) — ties compare UTF-16 code units, as JavaScript's `<` does, in both argument orders; and kind
  /// and birth come first.
  @Test func tiesCompareUTF16CodeUnits() throws {
    let halfwidth = try R.make("a\u{FF61}")
    let emoji = try R.make("a\u{1F600}")
    // the emoji's high surrogate (0xD83D) is below 0xFF61; by Unicode scalars it is above
    #expect(compareMonitorRows(emoji, halfwidth))
    #expect(!compareMonitorRows(halfwidth, emoji))
    #expect("a\u{FF61}" < "a\u{1F600}")
    #expect(!compareMonitorRows(emoji, emoji))

    let terminal = try R.make("0", kind: .terminal, createdAt: 0)
    let older = try R.make("z", createdAt: 10)
    #expect(compareMonitorRows(older, terminal))
    #expect(!compareMonitorRows(terminal, older))
    #expect(compareMonitorRows(older, halfwidth))
    #expect(!compareMonitorRows(halfwidth, older))

    var replica = RemoteModelReplica()
    replica.apply(.snapshot(revision: 1, rows: [terminal, halfwidth, older, emoji]))
    _ = replica.flush()
    let ids = R.ids(replica.model)
    #expect(ids == ["z", "a\u{1F600}", "a\u{FF61}", "0"])
  }
}
