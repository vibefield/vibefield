import Foundation

/// PG-3d — the phone's copy of its HOME's remote mesh board (PG-L1), the TWIN of the field cut's `MeshBoardCopy` (retired
/// at PG-3e) for the remote path:
/// the window's own pipeline (`createGodviewMonitorFeed`, `field-app/src/godview/monitor/model-replica.ts`) —
/// `RemoteBoardScreen` → `RemoteModelBoard` → `RemoteModelReplica` → the window's rows — so `phone-fold.golden.json`
/// pins it step by step without a socket (`PhoneFoldParityTests`). A value: it holds no class, no closure and no
/// static state, so a fresh copy drops everything (PG-L5's reset). FieldLink's since PG-3e (corrected 2026-11-02: "no
/// caller until PG-3e").
///
/// What the caller does:
/// - `open` on the open and on EVERY whole-mesh resync (PG-1c), `frame` on every later frame, `publish` once per frame
///   it will draw, then `drawn(hiding:)`.
/// - `.gap` (from `frame`, or from an `open` whose replay broke the replica's chain): ask the home again (M23). The
///   copy stands as it is drawn until the fresh open, and every frame before that open is `.ignored` — the window's
///   generation guard (`model-replica.ts:178-179`).
/// - An envelope that does not decode throws before it reaches the copy. A FRAME that does not decode is a gap, as
///   the window's (`:205-209`): ask again. An OPEN that does not decode is not a gap: it is an honest, non-retryable
///   unavailable (`:181-188`; Q-P2's sticky state), because asking again reads the same board.
///
/// `now` is the caller's ISO-8601 instant, used only where the window stamps `new Date()`: the screen's
/// `incompatible` and a desktop first heard by its board. The golden records neither.
public struct RemoteMeshCopy: Sendable {
  public enum Outcome: Sendable, Equatable {
    case applied
    /// The copy cannot follow this frame: ask the home again (M23). The copy stands until the fresh open.
    case gap(String)
    /// A frame after a gap, before the open it asked for (the window's generation guard).
    case ignored
  }

  /// One frame's publication: the replica's, then the re-join's when the home's joins moved, and whether the drawn
  /// rows moved. `moved` is what a caller redraws on.
  public struct Published: Sendable, Equatable {
    /// The replica's frame (`phone-goldens.ts` `changes`); nil: it published nothing.
    public let changes: RemotePublication?
    /// The re-join's frame when the joins moved (a kept failure shown or hidden); nil: none.
    public let rejoined: RemotePublication?
    /// A desktop's standing was said again (a state frame, an open), whether or not a drawn `stale` changed.
    public let standingMoved: Bool
    /// The window's rows differ from the last frame's: a row's board half (its key, its pane join, a durable Stop) can
    /// move with no replica change, and a standing can grey a row with none (the review's [2]).
    public let rowsMoved: Bool

    /// Something a caller draws moved: a publication, a re-join, a standing said, or a drawn row.
    public var moved: Bool { changes != nil || rejoined != nil || standingMoved || rowsMoved }
  }

  /// PG-9 (PG-L4.4) — one desktop's board as the WIRE last stood it, before the screen: its chain, its readable rows
  /// in the board's order (a key set again keeps its place, a new key goes last, as the hub's own `Map` does), and the
  /// rows this build could not read. What a cursor vouches for, and what an answer by cursor is expanded from.
  struct WireBoard: Sendable, Equatable {
    var epoch: String
    var revision: Int64
    var order: [String]
    var rows: [String: AgentRemoteRow]
    var refused: [AgentRemoteRowRefusal]

    init(_ snapshot: AgentRemoteMeshSnapshot) {
      epoch = snapshot.epoch
      revision = snapshot.revision
      order = []
      rows = [:]
      refused = []
      for row in snapshot.rows { set(row) }
      for refusal in snapshot.refused { refuse(refusal) }
    }

    /// The board whole, as the home would send it at this cursor.
    var snapshot: AgentRemoteMeshSnapshot {
      AgentRemoteMeshSnapshot(
        epoch: epoch, revision: revision, rows: order.compactMap { rows[$0] }, refused: refused, more: nil,
        unknownFields: [])
    }

    /// A delta on this chain, in the screen's order: a readable upsert clears its key's refusal, a refused one
    /// holds it, a removal clears both. False, and nothing applied, when it does not continue this chain.
    mutating func apply(_ delta: AgentRemoteMeshDelta) -> Bool {
      guard delta.epoch == epoch, delta.since == revision else { return false }
      for row in delta.upserts { set(row) }
      for refusal in delta.refused { refuse(refusal) }
      for key in delta.removed {
        drop(key)
        refused.removeAll { $0.key == key }
      }
      revision = delta.revision
      return true
    }

    private mutating func set(_ row: AgentRemoteRow) {
      let key = row.runtimeRunId
      if rows.updateValue(row, forKey: key) == nil { order.append(key) }
      refused.removeAll { $0.key == key }
    }

    private mutating func refuse(_ refusal: AgentRemoteRowRefusal) {
      if let key = refusal.key { drop(key) }
      if let at = refused.firstIndex(where: { $0.key == refusal.key }) {
        refused[at] = refusal
      } else {
        refused.append(refusal)
      }
    }

    private mutating func drop(_ key: String) {
      guard rows.removeValue(forKey: key) != nil else { return }
      order.removeAll { $0 == key }
    }
  }

  /// PG-9 — each desktop's board as the wire last stood it. It follows every frame, before the screen and whether or
  /// not the copy is ignoring (after a gap, the wire's image is still exact at its own cursor); a desktop whose frame
  /// it cannot follow leaves it, so no cursor is named for it.
  private var wire: [String: WireBoard] = [:]

  /// The pipeline's stages, internal so a `@testable` suite can read the screen's hold and the replica's gaps.
  var screen = RemoteBoardScreen()
  var fold = RemoteModelBoard()
  var replica: RemoteModelReplica
  /// After a gap, until the open: every frame is ignored.
  private var ignoring = false
  private var standingMoved = false
  /// The window's rows as the last `publish` drew them, and each drawn row's visual id (the carry-forward). Neither
  /// is reset by an open: the window's rows outlive a re-subscribe.
  private var windowRows: [RemoteFieldRow] = []
  private var previous: [String: String] = [:]

  /// What the fold last handed the replica — the open's snapshot or a frame's change — since the last `open` or
  /// `frame` call began; nil for a frame that handed nothing (a state, a change of nothing). The golden's `fold`.
  public private(set) var handed: RemoteModelUpdate?

  /// `gapBuffer` bounds what the replica holds during a gap; zero or more, as the window's replica requires (a negative
  /// bound traps, where `createMonitorReplica` throws a RangeError).
  public init(gapBuffer: Int = RemoteModelReplica.defaultGapBuffer) {
    replica = RemoteModelReplica(gapBuffer: gapBuffer)
  }

  /// PG-9 — the cursor the copy holds for each desktop: the last frame of its chain the wire's image applied. What
  /// the phone names (`since`) at each ask, read then, never stored.
  public var cursors: [String: SubscriptionCursor] {
    wire.mapValues { SubscriptionCursor(epoch: $0.epoch, revision: $0.revision) }
  }

  /// PG-9 — the board keys the wire's image holds for `device`, readable and refused (a test's witness).
  func wireKeys(_ device: String) -> [String] {
    guard let board = wire[device] else { return [] }
    return board.order + board.refused.compactMap { $0.key }
  }

  /// The answering desktop.
  public var here: String? { fold.here }
  /// Every desktop the board lists, in the board's order (the home first), with its standing.
  public var devices: [RemoteModelBoard.Device] { fold.devices }
  /// The fold's own chain.
  public var foldRevision: Int64 { fold.revision }
  /// The model as the replica last PUBLISHED it: behind the fold after a frame that changed nothing.
  public var model: RemoteModel { replica.model }

  /// A row the fold holds, by model id — hidden or shown — with its board row.
  public func held(_ id: String) -> RemoteModelBoard.Held? { fold.held(id) }

  /// The window's rows as the last `publish` drew them, without the desktops named (UA-P-5's foreign doors). The
  /// filter comes AFTER the fold and the rows, so a hidden desktop never moves another row's place or identity.
  public func drawn(hiding devices: Set<String> = []) -> [RemoteFieldRow] {
    devices.isEmpty ? windowRows : windowRows.filter { !devices.contains($0.device) }
  }

  /// The open, and every whole-mesh resync: replaces everything the copy follows (M23), then re-joins at once, as
  /// the window's `live` render does before the replica's frame.
  ///
  /// PG-9 — an open that answers a desktop by the phone's cursor (`resumed`, a `delta`) is first expanded into the
  /// whole open it stands for, from the wire's image, so every stage after it sees an ordinary open. An answer the
  /// image cannot vouch for (another cursor than the one it holds, a delta off its chain) is a GAP: nothing is
  /// applied, that desktop's cursor goes, and the ask that follows is answered its board whole.
  @discardableResult
  public mutating func open(_ open: AgentRemoteMeshOpen, now: String) -> Outcome {
    handed = nil
    let expanded = expand(open)
    guard let open = expanded.open else {
      for device in expanded.unanswerable { wire.removeValue(forKey: device) }
      ignoring = true
      return .gap(expanded.reason)
    }
    wire = [:]
    for entry in open.devices {
      if let snapshot = entry.snapshot, snapshot.more != true { wire[entry.device] = WireBoard(snapshot) }
    }
    let screened = screen.open(open, now: now)
    let update = fold.open(screened)
    handed = update
    let heard = replica.gapsHeard
    replica.apply(update)
    standingMoved = true
    rejoin()
    // the snapshot's replay of what a gap held broke the replica's chain again: the window's `onGap` reopens
    if replica.gapsHeard != heard {
      ignoring = true
      return .gap("the replica's chain broke behind the open")
    }
    ignoring = false
    return .applied
  }

  /// One later frame, screened, folded and applied. A state frame re-joins at once (the window's render on the feed's
  /// publish); a change waits for `publish`.
  public mutating func frame(_ frame: AgentRemoteMeshFrame, now: String) -> Outcome {
    handed = nil
    follow(frame)
    if ignoring { return .ignored }
    for screened in screen.frame(frame, now: now) {
      switch fold.frame(screened, now: now) {
      case .gap(let reason):
        ignoring = true
        return .gap(reason)
      case .state:
        standingMoved = true
        rejoin()
      case .unchanged:
        break
      case .change(let change):
        handed = .change(change)
        if !replica.apply(.change(change)) {
          ignoring = true
          return .gap("the replica's chain")
        }
      }
    }
    return .applied
  }

  /// The frame: the replica's publication, the re-join's when the joins moved, then the window's rows, drawn once.
  public mutating func publish() -> Published {
    let changes = replica.flush()
    let rejoined = rejoin() ? replica.flush() : nil
    let fold = self.fold
    let standing = Dictionary(fold.devices.map { ($0.device, $0.state) }) { first, _ in first }
    let before = windowRows
    windowRows = RemoteWindowRows.rows(
      model: replica.model, held: { fold.held($0) }, standing: standing,
      order: RemoteWindowRows.order(held: fold.heldRows, here: fold.here),
      sessionByRow: replica.visibility.sessionByRow, previous: &previous)
    defer { standingMoved = false }
    return Published(
      changes: changes, rejoined: rejoined, standingMoved: standingMoved, rowsMoved: windowRows != before)
  }

  /// PG-9 — the wire's image follows one frame: a desktop's reset replaces its board (a page of a paged reset vouches
  /// for nothing), a delta applies on its chain or the desktop leaves the image, a state moves nothing.
  private mutating func follow(_ frame: AgentRemoteMeshFrame) {
    switch frame {
    case .state:
      break
    case .snapshot(let device, let snapshot):
      wire[device] = snapshot.more == true ? nil : WireBoard(snapshot)
    case .delta(let device, let delta):
      guard var board = wire[device], board.apply(delta) else {
        wire.removeValue(forKey: device)
        return
      }
      wire[device] = board
    }
  }

  /// PG-9 — `open` as the whole open it stands for: each `resumed` desktop's board from the wire's image at that
  /// cursor, each `delta` applied to a copy of it. Nil, with the desktops it could not answer, when any answer names
  /// a cursor the image does not hold.
  private func expand(_ open: AgentRemoteMeshOpen) -> (
    open: AgentRemoteMeshOpen?, unanswerable: [String], reason: String
  ) {
    var unanswerable: [String] = []
    var reasons: [String] = []
    let devices = open.devices.map { entry -> AgentRemoteMeshDevice in
      let board: WireBoard
      if let resumed = entry.resumed {
        guard let held = wire[entry.device], held.epoch == resumed.epoch, held.revision == resumed.revision else {
          unanswerable.append(entry.device)
          reasons.append("\(entry.device) resumed at \(resumed.epoch ?? "no chain")@\(resumed.revision), not held")
          return entry
        }
        board = held
      } else if let delta = entry.delta {
        guard var held = wire[entry.device], held.apply(delta) else {
          unanswerable.append(entry.device)
          reasons.append("\(entry.device) answered a delta since \(delta.epoch)@\(delta.since), not held")
          return entry
        }
        board = held
      } else {
        return entry
      }
      return AgentRemoteMeshDevice(
        device: entry.device, state: entry.state, asOf: entry.asOf, snapshot: board.snapshot,
        unknownFields: entry.unknownFields)
    }
    guard unanswerable.isEmpty else {
      return (nil, unanswerable, "an answer by cursor this copy cannot vouch for: " + reasons.joined(separator: "; "))
    }
    return (AgentRemoteMeshOpen(devices: devices, unknownFields: open.unknownFields), [], "")
  }

  /// The window's visibility, handed anew when the home's joins moved. True when they did.
  @discardableResult
  private mutating func rejoin() -> Bool {
    replica.setVisibility(.joins(held: fold.heldRows, here: fold.here))
  }
}
