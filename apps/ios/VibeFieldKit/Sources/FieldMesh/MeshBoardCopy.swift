import FieldProduct

/// DS-8 — the phone's copy of its HOME's mesh board (DS-D13, DS-D4).
///
/// The home MULTIPLEXES and never re-folds: every self desktop's board arrives
/// on that desktop's own `{epoch, revision}` chain, relayed verbatim
/// (`packages/fieldd/src/mesh-board.ts`). So the copy is per desktop, and the
/// cursor is the copy: a frame that does not continue its desktop's chain is a
/// GAP, the copy is left exactly as it was, and the only repair is a fresh open
/// from the home — DS-L3's "a mismatch is a reset, never a repair". Nothing
/// here is renumbered and nothing is merged across desktops (DS-L2: a row's
/// owner is its desktop; the phone holds a copy).
///
/// It is the client's subscription TABLE for this one board. The table in
/// `FieldProductClient` keeps one cursor per subscription (SP-2 a), and the
/// mesh board is one subscription carrying many chains, so its frames pass
/// through that table untouched (`.stream`) and are judged here, per desktop;
/// a gap asks the table for the fresh snapshot (`resnapshot`) exactly as the
/// table's own gaps do.
///
/// DS-L8 — a desktop that stops answering sends only its STATE: its board
/// stays, and the state is what says how far to believe it (the field greys
/// it). Pure, so every rule above is pinned without a socket.
///
/// Not built: the board's 256 KiB paging (`more: true`) — the home does not
/// page the mesh board yet (DS-3's own not-done list); a paged reset would be
/// read page by page here, and assembling pages is owed with the home's half.
public struct MeshBoardCopy: Sendable, Equatable {
  /// One desktop's board, as its owner numbered it.
  public struct Board: Sendable, Equatable {
    public var epoch: String?
    public var revision: Int64
    public var rows: [String: AgentFieldRow]
    /// The board's own order, then each new upsert where it arrived — the
    /// field draws in this order, so a body never respawns because a
    /// dictionary rehashed.
    public var order: [String]

    public init(_ snapshot: AgentFieldSnapshot) {
      epoch = snapshot.epoch
      revision = snapshot.revision
      var rows: [String: AgentFieldRow] = [:]
      var order: [String] = []
      for row in snapshot.rows {
        // A board that names one run twice draws it once: the last word for
        // the row, the first place for it.
        if rows[row.runtimeRunId] == nil { order.append(row.runtimeRunId) }
        rows[row.runtimeRunId] = row
      }
      self.rows = rows
      self.order = order
    }

    public var ordered: [AgentFieldRow] { order.compactMap { rows[$0] } }
  }

  /// One desktop as the home lists it.
  public struct Device: Sendable, Equatable {
    public var state: AgentMeshDeviceState
    /// When `state` was established, as the home wrote it.
    public var asOf: String
    /// nil = the home has no board for it yet (listed, never answered).
    public var board: Board?
  }

  public enum Outcome: Sendable, Equatable {
    case applied
    /// The frame does not continue the copy; the reason, for the notes.
    case gap(String)
  }

  public private(set) var devices: [String: Device] = [:]

  public init() {}

  /// Every desktop, in the order the field draws them: by device id.
  public var deviceIds: [String] { devices.keys.sorted() }

  /// The home's open answer REPLACES the copy: a desktop the home no longer
  /// lists is gone from it, and nothing from an earlier home is kept beside
  /// the new answer — which is how a re-home never draws a row twice.
  public mutating func reset(_ open: AgentMeshOpen) {
    var next: [String: Device] = [:]
    for entry in open.devices {
      next[entry.device] = Device(
        state: entry.state, asOf: entry.asOf, board: entry.snapshot.map(Board.init))
    }
    devices = next
  }

  /// One frame, judged against its desktop's chain and applied when it
  /// continues it.
  public mutating func apply(_ frame: AgentMeshFrame) -> Outcome {
    switch frame {
    case .snapshot(let device, let snapshot):
      // That desktop's RESET: its copy is replaced, every other desktop's is
      // untouched. A desktop first heard this way has no stated standing yet,
      // and is not called live on the strength of a board alone — the home's
      // state frame says so next (`mesh-board.ts` sends both).
      var entry = devices[device] ?? Device(state: .stale, asOf: "", board: nil)
      entry.board = Board(snapshot)
      devices[device] = entry
    case .state(let device, let state, let asOf):
      var entry = devices[device] ?? Device(state: state, asOf: asOf, board: nil)
      entry.state = state
      entry.asOf = asOf
      devices[device] = entry
    case .delta(let device, let delta):
      guard var entry = devices[device], var board = entry.board else {
        return .gap("a delta for \(device), which has no board here")
      }
      if let epoch = delta.epoch, let held = board.epoch, epoch != held {
        return .gap("\(device)'s delta is on chain \(epoch), the copy on \(held)")
      }
      guard delta.since == board.revision else {
        return .gap("\(device)'s delta since \(delta.since) does not continue \(board.revision)")
      }
      // `rows.ts`: upserts, then removals, then the owner's revision.
      for row in delta.upserts {
        if board.rows[row.runtimeRunId] == nil { board.order.append(row.runtimeRunId) }
        board.rows[row.runtimeRunId] = row
      }
      for id in delta.removed {
        board.rows.removeValue(forKey: id)
        board.order.removeAll { $0 == id }
      }
      board.revision = delta.revision
      if let epoch = delta.epoch { board.epoch = epoch }
      entry.board = board
      devices[device] = entry
    }
    return .applied
  }
}
