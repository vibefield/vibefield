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
  /// Item 464 — the hand-off's lineage, carried beside `previous`.
  var lineage = RemoteLineage()
  /// The home's chain in the witness open: the next home delta applies on top of it (`home`).
  var homeRevision: Int64 = 80

  init(_ open: AgentRemoteMeshOpen) {
    replica.apply(fold.open(open))
  }

  mutating func frame(_ frame: AgentRemoteMeshFrame) {
    if case .change(let change) = fold.frame(frame, now: Witness.now) { replica.apply(.change(change)) }
  }

  /// One delta on the home's chain, the next link after the last.
  mutating func home(upserts: [JSONValue] = [], removed: [String] = []) throws {
    let delta = try Witness.delta(
      Remote.home, epoch: Witness.homeEpoch, since: homeRevision, revision: homeRevision + 1, upserts: upserts,
      removed: removed)
    frame(delta)
    homeRevision += 1
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
      sessionByRow: joins.sessionByRow, succeedsByRow: joins.succeedsByRow, previous: &previous,
      lineage: &lineage)
  }

  static func ids(_ rows: [RemoteFieldRow]) -> [String] { rows.map { $0.id } }

  /// Each drawn row's visual id, by model id.
  static func visuals(_ rows: [RemoteFieldRow]) -> [String: String] {
    Dictionary(rows.map { ($0.id, $0.visualId) }) { first, _ in first }
  }
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

/// Item 464 (2026-11-16) — a session born in another's place says so on its pane join (`terminal.succeeds`), and the
/// phone draws the newborn on the body the other wore: one bubble through a launch, an agent's end, and the frames
/// between them. The window's rule is `pane-transitions.ts`, read by `window-rows.ts:99-115`.
@Suite struct RemoteLineageTests {
  typealias W = Witness

  /// After every home agent of the witness open.
  static let launchedAt: Int64 = 1_790_800_700_000
  static let endedAt: Int64 = 1_790_800_900_000

  /// A home run born in a session of its own, `session` (a launch's run), saying it succeeds `succeeds` when given.
  static func run(_ key: String, session: String, succeeds: String?, createdAt: Int64) throws -> JSONValue {
    let turn = try W.row(W.homeRows, "run-h-turn")
    var row = W.moved(turn, key: key, id: key, createdAt: createdAt)
    row = edited(row, [.key("terminal"), .key("runtimeSessionId")], .string(session))
    if let succeeds { row = edited(row, [.key("terminal"), .key("succeeds")], .string(succeeds)) }
    return row
  }

  /// A home bare terminal whose floor session is `session` (its key and its model id), saying it succeeds `succeeds`.
  static func shell(_ session: String, succeeds: String?, createdAt: Int64) throws -> JSONValue {
    let shell = try W.row(W.homeRows, "pty-h2")
    var row = W.moved(shell, key: session, id: session, createdAt: createdAt)
    row = edited(row, [.key("terminal"), .key("runtimeSessionId")], .string(session))
    if let succeeds { row = edited(row, [.key("terminal"), .key("succeeds")], .string(succeeds)) }
    return row
  }

  /// The row said again without its claim: fieldd's lapse, or what it says once the predecessor is released.
  static func unclaimed(_ row: JSONValue) -> JSONValue { edited(row, [.key("terminal"), .key("succeeds")], nil) }

  /// The witness open with its shell (`pty-h2`) typed into.
  static func typedShell() throws -> WindowStage {
    let open = edited(
      try W.openJSON(), W.homeRows + [.row("pty-h2"), .key("monitorRow"), .key("inputUsed")], .bool(true))
    return WindowStage(try AgentRemoteMeshOpen(json: open))
  }

  /// The launch's run: session `pty-h9`, in the shell's place.
  static func launch() throws -> JSONValue {
    try run("run-h-launch", session: "pty-h9", succeeds: "pty-h2", createdAt: launchedAt)
  }

  /// J1 — the home's claims are joined beside its sessions: a bare terminal's, and an agent's hosted on the home with
  /// a session. A claim of the row's own session, an empty one, one from a run hosted nowhere and a peer's join
  /// nothing.
  @Test func theHomesClaimsAreJoinedBesideItsSessions() throws {
    var open = try W.openJSON()
    open = edited(open, W.homeRows + [.row("pty-h2"), .key("terminal"), .key("succeeds")], .string("pty-h0"))
    open = edited(open, W.homeRows + [.row("run-h-turn"), .key("terminal"), .key("succeeds")], .string("pty-h2"))
    open = edited(open, W.homeRows + [.row("run-h-crash"), .key("terminal"), .key("succeeds")], .string("pty-h3"))
    open = edited(open, W.homeRows + [.row("run-h-partial"), .key("terminal"), .key("succeeds")], .string("pty-h2"))
    open = edited(open, W.loftRows + [.row("pty-p1"), .key("terminal"), .key("succeeds")], .string("pty-p0"))
    let stage = WindowStage(try AgentRemoteMeshOpen(json: open))
    let claims = stage.joins.succeedsByRow
    #expect(claims == ["pty-h2": "pty-h0", "pty-h1": "pty-h2"])
    let sessions = stage.joins.sessionByRow
    #expect(sessions == ["pty-h1": "pty-h1", "pty-h2": "pty-h2", "pty-h3": "pty-h3"])

    let blank = edited(
      try W.openJSON(), W.homeRows + [.row("pty-h2"), .key("terminal"), .key("succeeds")], .string(""))
    let none = WindowStage(try AgentRemoteMeshOpen(json: blank)).joins.succeedsByRow
    #expect(none.isEmpty)
    let homeless = RemoteVisibility.joins(held: stage.fold.heldRows, here: nil).succeedsByRow
    #expect(homeless.isEmpty)
  }

  /// L1 — a launch: the run joins a NEW session and says it succeeds the shell's. The run is drawn on the shell's
  /// body and the shell is not drawn, though the model and the fold still hold it; when the shell's row goes, and when
  /// the claim is no longer said, the run keeps that body.
  @Test func aLaunchTakesTheShellsBody() throws {
    var stage = WindowStage(try W.open())
    let before = stage.draw()
    let shellBody = WindowStage.visuals(before)["pty-h2"]
    #expect(shellBody == "pty-h2")

    let run = try Self.launch()
    try stage.home(upserts: [run])
    let claims = stage.joins.succeedsByRow
    #expect(claims == ["run-h-launch": "pty-h2"])
    let launched = stage.draw()
    let ids = WindowStage.ids(launched)
    #expect(ids.contains("run-h-launch"))
    #expect(!ids.contains("pty-h2"))
    let body = WindowStage.visuals(launched)["run-h-launch"]
    #expect(body == "pty-h2")
    // only the drawing yields: the shell is still the model's and the fold's
    let modelHolds = stage.replica.model.byId["pty-h2"] != nil
    #expect(modelHolds)
    let foldHolds = stage.fold.held("pty-h2") != nil
    #expect(foldHolds)

    // the shell's row goes while the claim is still said, then the claim goes: the run keeps the body throughout
    try stage.home(removed: ["pty-h2"])
    let released = stage.draw()
    let kept = WindowStage.visuals(released)["run-h-launch"]
    #expect(kept == "pty-h2")
    try stage.home(upserts: [Self.unclaimed(run)])
    let settled = stage.draw()
    let still = WindowStage.visuals(settled)["run-h-launch"]
    #expect(still == "pty-h2")
    // every other row draws as it did
    let others = WindowStage.ids(settled).filter { $0 != "run-h-launch" }
    let was = WindowStage.ids(before).filter { $0 != "pty-h2" }
    #expect(others == was)
  }

  /// L2 — an agent's end, after its launch: a new bare terminal says it succeeds the run's session. The terminal is
  /// drawn on the run's body (the shell's before the launch: one bubble through both) and the ended run is not drawn;
  /// when the run's row goes, the terminal keeps the body.
  @Test func anAgentsEndGivesItsBodyToTheShellAfterIt() throws {
    var stage = WindowStage(try W.open())
    _ = stage.draw()
    let run = try Self.launch()
    try stage.home(upserts: [run])
    _ = stage.draw()
    try stage.home(upserts: [Self.unclaimed(run)], removed: ["pty-h2"])
    let launched = stage.draw()
    let runBody = WindowStage.visuals(launched)["run-h-launch"]
    #expect(runBody == "pty-h2")

    let after = try Self.shell("pty-h10", succeeds: "pty-h9", createdAt: Self.endedAt)
    try stage.home(upserts: [after])
    let ended = stage.draw()
    let ids = WindowStage.ids(ended)
    #expect(ids.contains("pty-h10"))
    #expect(!ids.contains("run-h-launch"))
    let body = WindowStage.visuals(ended)["pty-h10"]
    #expect(body == "pty-h2")
    let runHeld = stage.replica.model.byId["run-h-launch"] != nil
    #expect(runHeld)

    try stage.home(removed: ["run-h-launch"])
    let gone = stage.draw()
    let kept = WindowStage.visuals(gone)["pty-h10"]
    #expect(kept == "pty-h2")
  }

  /// L3 — the gap: the predecessor's row leaves in one frame and its successor arrives in the next, naming it. The
  /// successor still takes the body: the lineage keeps a departed session's body for a while.
  @Test func aSuccessorAFrameLateStillTakesTheBody() throws {
    var stage = WindowStage(try W.open())
    _ = stage.draw()
    try stage.home(removed: ["pty-h2"])
    let left = WindowStage.ids(stage.draw())
    #expect(!left.contains("pty-h2"))
    let departed = stage.lineage.departed
    #expect(departed == ["pty-h2"])

    try stage.home(upserts: [try Self.launch()])
    let arrived = stage.draw()
    let body = WindowStage.visuals(arrived)["run-h-launch"]
    #expect(body == "pty-h2")
  }

  /// L4 — retained: the shell was typed into (`monitorRow.inputUsed`), so its owner keeps it beside the run. The run
  /// still takes the shell's body, and the shell is drawn on a body of its own, `retained:<session>`
  /// (`pane-transitions.ts:64-67`).
  @Test func aTypedShellIsRetainedOnABodyOfItsOwn() throws {
    var stage = try Self.typedShell()
    _ = stage.draw()
    try stage.home(upserts: [try Self.launch()])
    let launched = stage.draw()
    let ids = WindowStage.ids(launched)
    #expect(ids.contains("pty-h2"))
    let visuals = WindowStage.visuals(launched)
    #expect(visuals["run-h-launch"] == "pty-h2")
    #expect(visuals["pty-h2"] == "retained:pty-h2")
  }

  /// L5 — the lapse (or a hand-off the home's window rolled back, which reads here as one): the successor is said
  /// again WITHOUT its claim while the hidden predecessor still stands. The predecessor is drawn again on its old body
  /// and the successor on its own.
  @Test func aLapsedClaimGivesThePredecessorItsBodyBack() throws {
    var stage = WindowStage(try W.open())
    _ = stage.draw()
    let run = try Self.launch()
    try stage.home(upserts: [run])
    let launched = WindowStage.ids(stage.draw())
    #expect(!launched.contains("pty-h2"))

    try stage.home(upserts: [Self.unclaimed(run)])
    let lapsed = WindowStage.visuals(stage.draw())
    #expect(lapsed["pty-h2"] == "pty-h2")
    #expect(lapsed["run-h-launch"] == "pty-h9")
    // and it stays so
    let again = WindowStage.visuals(stage.draw())
    #expect(again == lapsed)
  }

  /// L6 — the lapse with a retained predecessor: both bodies are drawn already, so nothing moves.
  @Test func aLapsedClaimOverARetainedShellMovesNothing() throws {
    var stage = try Self.typedShell()
    _ = stage.draw()
    let run = try Self.launch()
    try stage.home(upserts: [run])
    let launched = WindowStage.visuals(stage.draw())
    try stage.home(upserts: [Self.unclaimed(run)])
    let lapsed = WindowStage.visuals(stage.draw())
    #expect(lapsed == launched)
    #expect(lapsed["pty-h2"] == "retained:pty-h2")
    #expect(lapsed["run-h-launch"] == "pty-h2")
  }

  /// L7 — a claim naming a session nothing here has ever stood for changes nothing: the row draws as it would with no
  /// claim, and nothing is hidden.
  @Test func aClaimOfAnUnknownSessionChangesNothing() throws {
    var stage = WindowStage(try W.open())
    let before = WindowStage.visuals(stage.draw())
    let run = try Self.run("run-h-launch", session: "pty-h9", succeeds: "pty-nobody", createdAt: Self.launchedAt)
    try stage.home(upserts: [run])
    let drawn = WindowStage.visuals(stage.draw())
    var expected = before
    expected["run-h-launch"] = "pty-h9"
    #expect(drawn == expected)
  }

  /// L8 — two claimants of one predecessor: the first in drawing order (the home's agents by birth) is its successor;
  /// the second draws under its own session, as with no claim.
  @Test func theFirstOfTwoClaimantsInDrawingOrderWins() throws {
    var stage = WindowStage(try W.open())
    _ = stage.draw()
    let first = try Self.run("run-h-first", session: "pty-ha", succeeds: "pty-h2", createdAt: Self.launchedAt)
    let second = try Self.run(
      "run-h-second", session: "pty-hb", succeeds: "pty-h2", createdAt: Self.launchedAt + 1_000)
    // held in the other order: the drawing order decides, not the fold's
    try stage.home(upserts: [second, first])
    let drawn = stage.draw()
    let ids = WindowStage.ids(drawn)
    #expect(!ids.contains("pty-h2"))
    let visuals = WindowStage.visuals(drawn)
    #expect(visuals["run-h-first"] == "pty-h2")
    #expect(visuals["run-h-second"] == "pty-hb")
  }

  /// L9 — a peer's row whose join says `succeeds` changes nothing: a peer's rows join nothing here (a peer desktop's
  /// hand-off on the phone is item 465).
  @Test func aPeersClaimChangesNothing() throws {
    var stage = WindowStage(try W.open())
    let before = WindowStage.visuals(stage.draw())
    let loftShell = try W.row(W.loftRows, "pty-p1")
    var row = W.moved(loftShell, key: "pty-p9", id: "pty-p9", createdAt: Self.endedAt)
    row = edited(row, [.key("terminal"), .key("runtimeSessionId")], .string("pty-p9"))
    row = edited(row, [.key("terminal"), .key("succeeds")], .string("pty-p1"))
    stage.frame(try W.delta(Remote.loft, epoch: W.loftEpoch, since: 30, revision: 31, upserts: [row]))
    let claims = stage.joins.succeedsByRow
    #expect(claims.isEmpty)
    let drawn = WindowStage.visuals(stage.draw())
    var expected = before
    expected["pty-p9"] = "pty-p9"
    #expect(drawn == expected)
  }
}
