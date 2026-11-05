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

  /// PG-9 — the cursor the copy holds for each desktop: the last frame of its chain it applied.
  public var cursors: [String: SubscriptionCursor] { [:] }

  /// PG-9 — the board keys the wire's image holds for `device`, readable and refused (a test's witness).
  func wireKeys(_ device: String) -> [String] { [] }

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
  @discardableResult
  public mutating func open(_ open: AgentRemoteMeshOpen, now: String) -> Outcome {
    handed = nil
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

  /// The window's visibility, handed anew when the home's joins moved. True when they did.
  @discardableResult
  private mutating func rejoin() -> Bool {
    replica.setVisibility(.joins(held: fold.heldRows, here: fold.here))
  }
}
