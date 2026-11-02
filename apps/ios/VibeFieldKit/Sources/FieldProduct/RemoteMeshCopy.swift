import Foundation

/// PG-3d — the phone's copy of its HOME's remote mesh board (PG-L1), the TWIN of `MeshBoardCopy` for the remote path:
/// the window's own pipeline (`createGodviewMonitorFeed`, `field-app/src/godview/monitor/model-replica.ts`) —
/// `RemoteBoardScreen` → `RemoteModelBoard` → `RemoteModelReplica` → the window's rows — so `phone-fold.golden.json`
/// pins it step by step without a socket (`PhoneFoldParityTests`). A value: it holds no class, no closure and no
/// static state, so a fresh copy drops everything (PG-L5's reset). No caller until PG-3e.
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

  /// One frame's publication: the replica's, then the re-join's when the home's joins moved.
  public struct Published: Sendable, Equatable {
    /// The replica's frame (`phone-goldens.ts` `changes`); nil: it published nothing.
    public let changes: RemotePublication?
    /// The re-join's frame when the joins moved (a kept failure shown or hidden); nil: none.
    public let rejoined: RemotePublication?
    /// A desktop's standing moved: `drawn`'s `stale` may have, with no row change.
    public let standingMoved: Bool

    public var moved: Bool { changes != nil || rejoined != nil || standingMoved }
  }

  /// The pipeline's stages, internal so a `@testable` suite can read the screen's hold and the replica's gaps.
  var screen = RemoteBoardScreen()
  var fold = RemoteModelBoard()
  var replica: RemoteModelReplica

  /// PG-3d (red): the skeleton hands nothing up.
  public private(set) var handed: RemoteModelUpdate?

  public init(gapBuffer: Int = RemoteModelReplica.defaultGapBuffer) {
    replica = RemoteModelReplica(gapBuffer: gapBuffer)
  }

  /// PG-3d (red): the skeleton follows no desktop.
  public var here: String? { nil }
  public var devices: [RemoteModelBoard.Device] { [] }
  public var foldRevision: Int64 { 0 }
  public var model: RemoteModel { .empty }
  public func held(_ id: String) -> RemoteModelBoard.Held? { nil }

  /// PG-3d (red): the skeleton draws nothing.
  public func drawn(hiding devices: Set<String> = []) -> [RemoteFieldRow] { [] }

  /// PG-3d (red): the skeleton takes every open and follows none.
  @discardableResult
  public mutating func open(_ open: AgentRemoteMeshOpen, now: String) -> Outcome { .applied }

  /// PG-3d (red): the skeleton takes every frame and follows none.
  public mutating func frame(_ frame: AgentRemoteMeshFrame, now: String) -> Outcome { .applied }

  /// PG-3d (red): the skeleton publishes nothing.
  public mutating func publish() -> Published { Published(changes: nil, rejoined: nil, standingMoved: false) }
}
