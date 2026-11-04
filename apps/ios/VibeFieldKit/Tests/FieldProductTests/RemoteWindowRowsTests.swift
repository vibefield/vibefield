import Foundation
import Testing

@testable import FieldProduct

// PG-3d — the window's rows on the phone (`window-rows.ts`, `window-local.ts`'s `boardJoins`), over the witness open
// folded and replicated as the window does it. The order and the standing are what a person sees; the one-body rule
// is the launcher hand-off's (`godview-window-view.test.ts:200`).
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

/// The witness folded, replicated under the home's joins, and drawn — one frame.
struct WindowStage {
  var fold = RemoteModelBoard()
  var replica = RemoteModelReplica()
  var previous: [String: String] = [:]

  init(_ open: AgentRemoteMeshOpen) {
    replica.apply(fold.open(open))
  }

  mutating func frame(_ frame: AgentRemoteMeshFrame) {
    if case .change(let change) = fold.frame(frame, now: Witness.now) { replica.apply(.change(change)) }
  }

  var joins: RemoteVisibility { .joins(held: fold.heldRows, here: fold.here) }
  var order: [String] { RemoteWindowRows.order(held: fold.heldRows, here: fold.here) }

  mutating func draw(standing: [String: AgentMeshDeviceState]? = nil) -> [RemoteFieldRow] {
    let joins = self.joins
    replica.setVisibility(joins)
    _ = replica.flush()
    let fold = self.fold
    let devices = Dictionary(fold.devices.map { ($0.device, $0.state) }) { first, _ in first }
    return RemoteWindowRows.rows(
      model: replica.model, held: { fold.held($0) }, standing: standing ?? devices, order: order,
      sessionByRow: joins.sessionByRow, previous: &previous)
  }

  static func ids(_ rows: [RemoteFieldRow]) -> [String] { rows.map { $0.id } }
}

@Suite struct RemoteWindowRowsTests {
  typealias W = Witness
  /// The fold golden's open `drawn`.
  static let openDrawn = [
    "pty-h1", "run-h-partial", "run-h-nocwd", "run-h-root", "run-h-quiet", "pty-h3", "pty-h2", "pty-p3", "pty-p1",
    "run-p-done", "run-a-idle",
  ]

  /// W1 — the home's joins are its panes: an agent hosted on the home stands for its pane's session, a bare terminal
  /// for its own; a run hosted nowhere and every peer's row join nothing, and with no home nothing joins.
  @Test func theHomesJoinsAreItsPanes() throws {
    let stage = WindowStage(try W.open())
    let joins = stage.joins.sessionByRow
    #expect(joins == ["pty-h1": "pty-h1", "pty-h2": "pty-h2", "pty-h3": "pty-h3"])
    let none = RemoteVisibility.joins(held: stage.fold.heldRows, here: nil)
    #expect(none.sessionByRow.isEmpty)

    // a bare terminal whose pane names no session stands for its own id; an agent's empty session joins nothing
    var open = try W.openJSON()
    open = edited(open, W.homeRows + [.row("pty-h2"), .key("terminal"), .key("runtimeSessionId")], nil)
    open = edited(open, W.homeRows + [.row("run-h-turn"), .key("terminal"), .key("runtimeSessionId")], .string(""))
    let reread = WindowStage(try AgentRemoteMeshOpen(json: open))
    let joined = reread.joins.sessionByRow
    #expect(joined == ["pty-h2": "pty-h2", "pty-h3": "pty-h3"])
  }

  /// W2 — the window's order: the home's agents by birth, its terminals, then each desktop in its place. A bare
  /// terminal whose doors are down names no pane and ranks with the agents; a promoted shell ranks by its run's birth.
  @Test func theOrderIsTheHomesAgentsThenItsTerminalsThenEachDesktop() throws {
    var stage = WindowStage(try W.open())
    let order = stage.order
    #expect(order == Self.openDrawn)
    let frames = try W.frames()
    stage.frame(frames[0])
    let promoted = stage.order
    #expect(promoted == Self.openDrawn)

    let doorless = edited(try W.openJSON(), W.homeRows + [.row("pty-h2"), .key("terminal")], nil)
    let down = WindowStage(try AgentRemoteMeshOpen(json: doorless))
    let first = down.order.first
    #expect(first == "pty-h2")
  }

  /// W4 (the review's [4]) — the home's bare terminals rank by birth, and an equal birth keeps held order, as
  /// JavaScript's stable sort does (`window-rows.ts:205-209`): never the id, so the equal pair is held against its
  /// id order.
  @Test func theHomesTerminalsRankByBirthThenHeldOrder() throws {
    let shell = try W.row(W.homeRows, "pty-h2")
    func terminal(_ id: String, _ createdAt: Int64) -> JSONValue {
      let row = W.moved(shell, key: id, id: id, createdAt: createdAt)
      return edited(row, [.key("terminal"), .key("runtimeSessionId")], .string(id))
    }
    let born = at(shell, [.key("monitorRow"), .key("createdAt")])?.intValue ?? 0
    let added = [
      terminal("pty-b", born + 2), terminal("pty-a", born + 1), terminal("pty-z", born + 5),
      terminal("pty-y", born + 5),
    ]
    let open = edited(try W.openJSON(), W.homeRows, .array(try W.rows(W.homeRows) + added))
    let stage = WindowStage(try AgentRemoteMeshOpen(json: open))
    let terminals = ["pty-h2", "pty-a", "pty-b", "pty-z", "pty-y"]
    let ranked = stage.order.filter { terminals.contains($0) }
    #expect(ranked == terminals)
    // the terminals come after every home agent and before the first peer
    let order = stage.order
    let firstTerminal = order.firstIndex(of: "pty-h2") ?? -1
    let lastAgent = order.firstIndex(of: "pty-h3") ?? -1
    let firstPeer = order.firstIndex(of: "pty-p3") ?? -1
    #expect(lastAgent < firstTerminal)
    #expect(order.firstIndex(of: "pty-y") == firstPeer - 1)
  }

  /// W3 — a peer greys by its desktop's standing, never its owner's clock, and a home row keeps its owner's `stale`;
  /// a dead failure the home holds a pane for is drawn.
  @Test func aPeerGreysByItsStandingAndAHomeRowKeepsItsOwn() throws {
    var stage = WindowStage(try W.open())
    let drawn = stage.draw()
    let ids = WindowStage.ids(drawn)
    #expect(ids == Self.openDrawn)
    let stale = drawn.filter { $0.stale }.map { $0.id }
    // the loft is live: pty-p3's owner says stale, the window does not; the attic is asleep
    #expect(stale == ["run-h-quiet", "pty-h3", "run-a-idle"])
    let keys = drawn.map { $0.key }
    #expect(keys.first == "run-h-turn")
    let crash = drawn.first { $0.id == "pty-h3" }
    #expect(crash?.key == "run-h-crash")

    var greyed = WindowStage(try W.open())
    let loftStale = greyed.draw(standing: [Remote.home: .live, Remote.loft: .stale, Remote.air: .live])
    let greyedIds = loftStale.filter { $0.stale }.map { $0.id }
    #expect(greyedIds == ["run-h-quiet", "pty-h3", "pty-p3", "pty-p1", "run-p-done"])
    // a desktop the board does not stand reads not live
    let unknown = greyed.draw(standing: [Remote.home: .live])
    let peers = unknown.filter { !$0.isSelf }.allSatisfy { $0.stale }
    #expect(peers)
  }

  /// V1 (`window-rows.ts:89-99`) — one body per visual identity: a launched agent hosted on the shell's session takes
  /// over its body while the shell's row is still here, and the shell is drawn again once the agent leaves.
  @Test func oneBodyPerVisualIdentity() throws {
    var stage = WindowStage(try W.open())
    let before = WindowStage.ids(stage.draw())
    #expect(before.contains("pty-h2"))

    let turn = try W.row(W.homeRows, "run-h-turn")
    var launch = W.moved(turn, key: "run-h-launch", id: "run-h-launch", createdAt: 1_790_800_700_000)
    launch = edited(launch, [.key("terminal"), .key("runtimeSessionId")], .string("pty-h2"))
    stage.frame(try W.delta(Remote.home, epoch: W.homeEpoch, since: 80, revision: 81, upserts: [launch]))
    let launched = stage.draw()
    let ids = WindowStage.ids(launched)
    #expect(ids.contains("run-h-launch"))
    #expect(!ids.contains("pty-h2"))
    let body = launched.first { $0.id == "run-h-launch" }
    #expect(body?.visualId == "pty-h2")
    // the shell is still the model's and the fold's: only the drawing yields
    #expect(stage.replica.model.byId["pty-h2"] != nil)

    stage.frame(try W.delta(Remote.home, epoch: W.homeEpoch, since: 81, revision: 82, removed: ["run-h-launch"]))
    let after = WindowStage.ids(stage.draw())
    #expect(after == before)
  }

  /// A drawn row keeps the visual id it wore last time (the carry-forward), even when its session moves.
  @Test func aDrawnRowKeepsItsVisualIdentity() throws {
    var stage = WindowStage(try W.open())
    let first = stage.draw()
    #expect(first.first?.visualId == "pty-h1")
    #expect(stage.previous["pty-h1"] == "pty-h1")
    let moved = edited(try W.row(W.homeRows, "run-h-turn"), [.key("terminal"), .key("runtimeSessionId")], .string("pty-h9"))
    stage.frame(try W.delta(Remote.home, epoch: W.homeEpoch, since: 80, revision: 81, upserts: [moved]))
    let joined = stage.joins.sessionByRow["pty-h1"]
    #expect(joined == "pty-h9")
    let again = stage.draw()
    #expect(again.first?.visualId == "pty-h1")
  }
}
