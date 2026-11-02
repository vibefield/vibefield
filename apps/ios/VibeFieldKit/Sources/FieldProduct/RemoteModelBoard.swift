import Foundation

/// PG-3d — THE MODEL BOARD, FOLDED INTO ONE CHAIN, on the phone (`ModelBoardFold`,
/// `field-app/src/godview/monitor/model-board.ts`): the home's remote mesh board answers every self desktop's board,
/// each on its OWN revision chain as its owner numbered it, and the replica wants ONE chain. This fold is the join and
/// nothing more: a desktop's board becomes upserts plus the removals of its ids that are gone; a delta becomes
/// upserts and removals mapped from the board's keys (`runtimeRunId`) to the model's ids; a desktop going silent
/// keeps its rows (DS-L8: asleep is a state, not an absence); a delta the fold cannot follow is a GAP, and the caller
/// asks the home again (M23: the open replaces everything). The one reader-relative fact joined is `isSelf`.
///
/// Every map whose order the window reads is ORDERED here, as a JavaScript `Map`/`Set` is by insertion: the held
/// rows (a kept row keeps its place, item 138), each desktop's keys, the desktops, and the ids a delta releases
/// (`removed`'s order). Swift's `Dictionary` and `Set` iterate in a per-process seeded order.
///
/// Not transcribed, because nothing on the phone reads it: MV-3d's `runs()` (this desktop's desk rows for the
/// window's chrome — a remote row carries no status, so none is a desk row) and the `monitorRow`-less branch of a
/// delta (the remote cut requires `monitorRow`; `RemoteBoardScreen` has refused such a row already).
public struct RemoteModelBoard: Sendable {
  /// One row as the fold holds it: the model's row the replica applies, and the BOARD row it rode in on, kept whole
  /// beside it for the joins the phone reads by key (`HeldModelRow`).
  public struct Held: Sendable, Equatable {
    public let device: String
    public let board: AgentRemoteRow
    public let row: RemoteModelRow
  }

  /// A desktop as the board stands it: its state, when that was established, and its owner's chain once its board
  /// has answered (`HeldDevice`).
  public struct Device: Sendable, Equatable {
    public let device: String
    public internal(set) var state: AgentMeshDeviceState
    /// ISO-8601.
    public internal(set) var asOf: String
    /// The owner's chain: nil until its board has answered.
    public internal(set) var epoch: String?
    public internal(set) var revision: Int64?
  }

  /// What one frame comes to.
  public enum Outcome: Sendable, Equatable {
    /// A desktop's state moved, and nothing in the model (DS-L8).
    case state
    /// The fold's next link: hand it to the replica.
    case change(RemoteModelChange)
    /// The frame changed no row: the chain stays where it was.
    case unchanged
    /// A delta the fold cannot follow: the caller asks again (M23).
    case gap(String)
  }

  /// The answering desktop: the open lists the home first.
  public private(set) var here: String?
  /// The fold's own chain: one link per change it hands up.
  public private(set) var revision: Int64 = 0

  public init() {}

  /// PG-3d (red): the skeleton lists no desktop.
  public var devices: [Device] { [] }

  /// PG-3d (red): the skeleton holds no row.
  public func held(_ id: String) -> Held? { nil }

  /// PG-3d (red): the skeleton holds no row.
  public var heldRows: [Held] { [] }

  /// PG-3d (red): the skeleton's open hands up nothing.
  public mutating func open(_ open: AgentRemoteMeshOpen) -> RemoteModelUpdate { .snapshot(revision: 0, rows: []) }

  /// PG-3d (red): the skeleton changes nothing on any frame.
  public mutating func frame(_ frame: AgentRemoteMeshFrame, now: String) -> Outcome { .unchanged }
}
