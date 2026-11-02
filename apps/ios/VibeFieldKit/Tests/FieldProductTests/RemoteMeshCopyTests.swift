import Foundation
import Testing

@testable import FieldProduct

// PG-3d — the phone's copy of its home's board, beyond the golden: the differences the phone makes on purpose and
// the guards the window keeps, each over the witness (`Witness`). The golden itself is `PhoneFoldParityTests`'.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

extension RemoteMeshCopy {
  /// The witness open, and frames 0 through `last`, each published as the window draws it.
  static func witness(through last: Int? = nil) throws -> RemoteMeshCopy {
    var copy = RemoteMeshCopy()
    copy.open(try Witness.open(), now: Witness.now)
    _ = copy.publish()
    if let last {
      for frame in try Witness.frames()[0...last] {
        _ = copy.frame(frame, now: Witness.now)
        _ = copy.publish()
      }
    }
    return copy
  }

  func drawnIds(hiding devices: Set<String> = []) -> [String] { drawn(hiding: devices).map { $0.id } }
  func row(_ id: String) -> RemoteFieldRow? { drawn().first { $0.id == id } }
  func device(_ id: String) -> RemoteModelBoard.Device? { devices.first { $0.device == id } }
}

@Suite struct RemoteMeshCopyTests {
  typealias W = Witness

  /// D1 — UA-P-5's foreign-door filter comes AFTER the fold, outside the golden: a hidden desktop leaves `drawn`
  /// and nothing else — the model and the fold still hold its rows, nothing is published, and the other rows keep
  /// their order.
  @Test func aForeignDoorHidesItsDesktopAfterTheFold() throws {
    var copy = try RemoteMeshCopy.witness()
    let all = copy.drawnIds()
    #expect(all.contains("pty-p3"))
    #expect(all.contains("pty-p1"))
    #expect(all.contains("run-p-done"))

    let hidden = copy.drawnIds(hiding: [Remote.loft])
    let rest = all.filter { !["pty-p3", "pty-p1", "run-p-done"].contains($0) }
    #expect(hidden == rest)
    let model = copy.model.agents.map { $0.id }
    #expect(model.contains("pty-p3"))
    #expect(copy.held("run-p-done") != nil)
    let quiet = copy.publish()
    #expect(!quiet.moved)
    #expect(copy.drawnIds() == all)
  }

  /// D2 — each row keeps its board key beside its model id. The key lives in the fold, never in the replica's row:
  /// a key-only change publishes nothing, and `drawn` reads the new key. (3e's seam: a resume names the key, a
  /// report-shown the id.)
  @Test func aRowKeepsItsBoardKeyBesideItsModelId() throws {
    var copy = try RemoteMeshCopy.witness()
    let keys = ["pty-h1", "pty-h3", "pty-p3"].map { copy.row($0)?.key }
    #expect(keys == ["run-h-turn", "run-h-crash", "run-p-ask"])

    _ = copy.frame(try W.frames()[0], now: W.now)
    _ = copy.publish()
    #expect(copy.row("pty-h2")?.key == "run-h-typed")

    // the same row, re-keyed: the run's key moves, its model id and every field stay
    let turn = try W.row(W.homeRows, "run-h-turn")
    let rekeyed = W.moved(turn, key: "run-h-turn2")
    let outcome = copy.frame(
      try W.delta(Remote.home, epoch: W.homeEpoch, since: 81, revision: 82, upserts: [rekeyed], removed: ["run-h-turn"]),
      now: W.now)
    #expect(outcome == .applied)
    // the fold handed the row up; the replica found it equal
    let handed = copy.handed.map(W.ids)
    #expect(handed == ["pty-h1"])
    let published = copy.publish()
    #expect(published.changes == nil)
    #expect(copy.row("pty-h1")?.key == "run-h-turn2")
    #expect(copy.held("pty-h1")?.board.runtimeRunId == "run-h-turn2")
  }

  /// D3 — a desktop first heard by its board is live, not stale (`model-board.ts:231-237`): listed LAST, though its
  /// id sorts first, and its rows drawn unstale under that standing whatever their owner's clock says.
  @Test func aDesktopFirstHeardByItsBoardIsLive() throws {
    var copy = try RemoteMeshCopy.witness()
    let ask = try W.row(W.loftRows, "run-p-ask")
    // fresh ids, keys and device together: a re-send under the loft's ids would overwrite the loft's own rows
    let row = W.moved(ask, key: "run-0aaa", id: "run-0aaa", device: "dev-0AAA")
    let owner = at(row, [.key("monitorRow"), .key("stale")])?.boolValue
    #expect(owner == true)
    let outcome = copy.frame(try W.snapshot("dev-0AAA", epoch: "fieldd-0aaa.1", revision: 1, rows: [row]), now: W.now)
    #expect(outcome == .applied)
    _ = copy.publish()
    let ids = copy.devices.map { $0.device }
    #expect(ids == [Remote.home, Remote.loft, Remote.air, "dev-0AAA"])
    let heard = copy.device("dev-0AAA")
    #expect(heard?.state == .live)
    #expect(heard?.asOf == W.now)
    let drawn = copy.row("run-0aaa")
    #expect(drawn?.stale == false)
    #expect(drawn?.isSelf == false)
    #expect(copy.drawnIds().last == "run-0aaa")
  }

  /// I1 — on the remote path a refused row is no row, and greys its desktop: the loft's `run-p-done` re-sent with a
  /// status this build cannot read leaves the fold and the model, the loft reads `incompatible` at `now`, and its
  /// other rows are drawn stale; a later readable upsert of that key brings the loft back to the wire's last word.
  @Test func aRefusedPeerRowLeavesAndGreysItsDesktop() throws {
    var copy = try RemoteMeshCopy.witness(through: 5)
    // the baselines: the row is held and drawn, the loft is live and its rows unstale
    #expect(copy.held("run-p-done") != nil)
    #expect(copy.device(Remote.loft)?.state == .live)
    #expect(copy.row("pty-p3")?.stale == false)

    let done = try W.row(W.loftRows, "run-p-done")
    let sleeping = edited(done, [.key("monitorRow"), .key("status")], .string("sleeping"))
    var six = try W.frameJSON()[6]
    six = edited(six, [.key("delta"), .key("removed")], .array([]))
    six = edited(six, [.key("delta"), .key("upserts")], .array([sleeping]))
    let refused = copy.frame(try AgentRemoteMeshFrame(json: six), now: W.now)
    #expect(refused == .applied)
    let published = copy.publish()
    let removed = published.changes?.removed ?? []
    #expect(removed.contains("run-p-done"))
    #expect(copy.held("run-p-done") == nil)
    #expect(copy.screen.holds(Remote.loft))
    let loft = copy.device(Remote.loft)
    #expect(loft?.state == .incompatible)
    #expect(loft?.asOf == W.now)
    #expect(copy.row("pty-p3")?.stale == true)
    #expect(published.standingMoved)

    // the healing upsert chains on the loft's re-attached chain (since 4, epoch `.5`)
    let healed = copy.frame(
      try W.delta(Remote.loft, epoch: W.loftReattached, since: 4, revision: 5, upserts: [done]), now: W.now)
    #expect(healed == .applied)
    _ = copy.publish()
    let back = copy.device(Remote.loft)
    #expect(back?.state == .live)
    #expect(back?.asOf == "2026-09-30T21:20:14.000Z")
    #expect(copy.row("pty-p3")?.stale == false)
    #expect(copy.row("run-p-done") != nil)
  }

  /// G1 (`model-replica.ts:156-161`, `:178-179`) — after a gap nothing is followed until the open: the copy stands as
  /// it is drawn, a frame that would chain is ignored and hands nothing, and a fresh open applies.
  @Test func afterAGapNothingIsFollowedUntilTheOpen() throws {
    var copy = try RemoteMeshCopy.witness(through: 5)
    let frames = try W.frames()
    let six = copy.frame(frames[6], now: W.now)
    #expect(six == .applied)
    _ = copy.publish()
    let standing = copy.drawnIds()

    let old = copy.frame(frames[8], now: W.now)
    guard case .gap = old else {
      Issue.record("the old chain's delta is a gap, not \(old)")
      return
    }
    let seven = copy.frame(frames[7], now: W.now)
    #expect(seven == .ignored)
    #expect(copy.handed == nil)
    #expect(copy.drawnIds() == standing)
    #expect(copy.held("run-h-quiet") != nil)

    let reopened = copy.open(try W.resync(), now: W.now)
    #expect(reopened == .applied)
    _ = copy.publish()
    let next = copy.frame(
      try W.delta(Remote.home, epoch: W.homeEpoch, since: 84, revision: 85, removed: ["run-h-root"]), now: W.now)
    #expect(next == .applied)
    _ = copy.publish()
    #expect(!copy.drawnIds().contains("run-h-root"))
  }

  /// S1 — the replica keeps `cost.series` (spend draws it, PG-5…8), though the fold golden leaves it out
  /// (`phone-goldens.ts` `costOf`): each drawn row's series is the wire's, the open's and then each frame's.
  @Test func costKeepsItsSeries() throws {
    let open = try W.open()
    let rows = open.devices.compactMap { $0.snapshot }.flatMap { $0.rows }
    func wire(_ id: String, _ from: [AgentRemoteRow]) -> MonitorSeries? {
      from.first { $0.monitorRow.id == id }?.monitorRow.cost?.series
    }
    var copy = try RemoteMeshCopy.witness()
    for id in ["pty-h1", "run-h-partial", "pty-p3"] {
      let series = copy.row(id)?.cost?.series
      #expect(series != nil, "\(id)")
      #expect(series == wire(id, rows), "\(id)")
    }
    let nocwd = copy.row("run-h-nocwd")?.cost
    #expect(nocwd != nil)
    #expect(nocwd?.series == nil)

    let frames = try W.frames()
    func upserts(_ frame: AgentRemoteMeshFrame) -> [AgentRemoteRow] {
      switch frame {
      case .delta(_, let delta): delta.upserts
      case .snapshot(_, let snapshot): snapshot.rows
      case .state: []
      }
    }
    for index in 0...7 {
      _ = copy.frame(frames[index], now: W.now)
      _ = copy.publish()
      if index == 1 {
        let partial = copy.row("run-h-partial")?.cost?.series
        let opened = wire("run-h-partial", rows)
        #expect(partial == wire("run-h-partial", upserts(frames[1])))
        #expect(partial != opened)
      }
      if index == 4 {
        let ask = copy.row("pty-p3")?.cost?.series
        #expect(ask == wire("pty-p3", upserts(frames[4])))
        #expect(ask != wire("pty-p3", rows))
      }
    }
    let resync = try W.resync()
    copy.open(resync, now: W.now)
    _ = copy.publish()
    let again = resync.devices.compactMap { $0.snapshot }.flatMap { $0.rows }
    let turn = copy.row("pty-h1")?.cost?.series
    #expect(turn != nil)
    #expect(turn == wire("pty-h1", again))
  }

  /// L5 (PG-L5's reset, what 3d pins of it) — the copy is a value: a fresh one holds nothing of the old — no screen
  /// memory, no held rows or chains, no published model, no drawn row — and its open publishes every row as new, the
  /// formerly incompatible desktop at the wire's word. (3e owns FieldLink's `stop()` line and its test.)
  @Test func aFreshCopyHoldsNothing() throws {
    var copy = try RemoteMeshCopy.witness(through: 5)
    let done = try W.row(W.loftRows, "run-p-done")
    let sleeping = edited(done, [.key("monitorRow"), .key("status")], .string("sleeping"))
    var six = try W.frameJSON()[6]
    six = edited(six, [.key("delta"), .key("removed")], .array([]))
    six = edited(six, [.key("delta"), .key("upserts")], .array([sleeping]))
    _ = copy.frame(try AgentRemoteMeshFrame(json: six), now: W.now)
    _ = copy.publish()
    // the baselines: the old copy draws rows and holds the loft's unreadable row
    #expect(!copy.drawn().isEmpty)
    #expect(copy.screen.holds(Remote.loft))
    #expect(copy.device(Remote.loft)?.state == .incompatible)

    copy = RemoteMeshCopy()
    #expect(copy.devices.isEmpty)
    #expect(copy.model.agents.isEmpty)
    #expect(copy.drawn().isEmpty)
    #expect(copy.here == nil)
    #expect(!copy.screen.holds(Remote.loft))
    let nothing = copy.publish()
    #expect(!nothing.moved)

    copy.open(try W.open(), now: W.now)
    let opened = copy.publish()
    let added = opened.changes?.added ?? []
    #expect(added.count == 11)
    #expect(Set(added) == Set(W.openOrder))
    #expect(copy.device(Remote.loft)?.state == .live)
    #expect(copy.device(Remote.loft)?.asOf == "2026-09-30T21:19:58.000Z")
  }
}
