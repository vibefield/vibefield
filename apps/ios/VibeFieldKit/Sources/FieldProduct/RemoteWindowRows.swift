import Foundation

// PG-3d — THE WINDOW'S ROWS, on the phone (`field-app/src/godview/monitor/window-rows.ts`, with the joins of
// `window-local.ts` and the visibility of `failed-bodies.ts`), for a window with no deck panes, which is what the
// phone is (Q-J1 (a): the phone equals its home's window row for row):
//
//   · a PEER's greying is its desktop's STANDING on the board (DS-L8), never the owner's evidence clock; a home row
//     keeps its owner's `stale`;
//   · the swarm's spatial identity (`visualId`): the one the row wore last time, else the floor session it stands for
//     (a home row's), else its id; and ONE BODY PER VISUAL IDENTITY, the earlier row in order winning (a launched
//     agent takes over its shell's body while the shell's row is still here);
//   · the ORDER the window draws: the home's agents by birth, then its terminals by birth (no pane or floor ranks
//     here), then every other desktop's rows, each desktop in its place and its rows as the fold first took them.
//
// Not transcribed: the window's `profileSet` drop for a peer (the phone has no spawn bloom), the deck's visual ids (a
// launcher hand-off's transfer; the phone has no deck) and the object-identity caches (`createWindowRows`'s and
// `createRowOrder`'s): a value equality does their work.

extension AgentRemoteRow {
  /// A bare terminal's row that names its pane: the join every reader of one reads (`isTerminalBoardRow`). A peer's
  /// terminal whose owner's doors are down names none, and ranks with the agents.
  public var isBareTerminal: Bool { isTerminal && terminal != nil }
}

/// One drawn row: the replica's row, the board row the fold holds it with (its key and joins), and the window's
/// standing and spatial identity.
public struct RemoteFieldRow: Sendable, Equatable, Identifiable {
  public let row: RemoteModelRow
  public let board: AgentRemoteRow
  public let stale: Bool
  public let visualId: String

  public var id: String { row.id }
  /// The board key (`runtimeRunId`): what a resume or a stop names. Read from the fold, never the replica's row, so a
  /// key change alone re-publishes nothing.
  public var key: String { board.runtimeRunId }
  /// The desktop the row lives on: its owner.
  public var device: String { row.monitor.device.id }
  public var isSelf: Bool { row.isSelf }
  public var unread: Bool { row.monitor.unread }
  /// The cost as the backend priced it, its series kept (spend draws it, PG-5…8).
  public var cost: MonitorCost? { row.monitor.cost }
}

extension RemoteVisibility {
  /// The home's joins as the window reads them (`boardJoins(held, here).sessionByRow`): a bare terminal stands for
  /// its pane's session (its own id when the pane names none), an agent for its pane's when that pane is hosted on the
  /// home and named. A peer's rows join nothing here: no pane of the home shows them.
  public static func joins(held: [RemoteModelBoard.Held], here: String?) -> RemoteVisibility {
    guard let here else { return RemoteVisibility() }
    var sessionByRow: [String: String] = [:]
    for entry in held where entry.device == here {
      let board = entry.board
      if board.isBareTerminal, let terminal = board.terminal {
        sessionByRow[entry.row.id] = terminal.runtimeSessionId ?? entry.row.id
        continue
      }
      guard let terminal = board.terminal, terminal.hosted == "local" else { continue }
      guard let session = terminal.runtimeSessionId, !session.isEmpty else { continue }
      sessionByRow[entry.row.id] = session
    }
    return RemoteVisibility(sessionByRow: sessionByRow)
  }
}

public enum RemoteWindowRows {
  /// The ids in the order the window draws them (`rowOrder` with no panes): the home's agents by birth, then the
  /// home's terminals by birth, then other desktops' rows in held order. Equal births keep held order, as
  /// JavaScript's stable sort does.
  public static func order(held: [RemoteModelBoard.Held], here: String?) -> [String] {
    var agents: [(Int, RemoteModelBoard.Held)] = []
    var terminals: [(Int, RemoteModelBoard.Held)] = []
    var peers: [String] = []
    for (index, entry) in held.enumerated() {
      if entry.device != here {
        peers.append(entry.row.id)
      } else if entry.board.isBareTerminal {
        terminals.append((index, entry))
      } else {
        agents.append((index, entry))
      }
    }
    func byBirth(_ left: (Int, RemoteModelBoard.Held), _ right: (Int, RemoteModelBoard.Held)) -> Bool {
      let (a, b) = (left.1.row.monitor.createdAt, right.1.row.monitor.createdAt)
      return a != b ? a < b : left.0 < right.0
    }
    return agents.sorted(by: byBirth).map { $0.1.row.id } + terminals.sorted(by: byBirth).map { $0.1.row.id } + peers
  }

  /// Every row of the model, ordered and patched for this window (`rowsFor`): `order`'s ids first, then whatever the
  /// model holds beyond them; one body per visual identity. `previous` is the carry-forward of each DRAWN row's
  /// visual id, rewritten on every call: call this once per frame.
  public static func rows(
    model: RemoteModel, held: (String) -> RemoteModelBoard.Held?, standing: [String: AgentMeshDeviceState],
    order: [String], sessionByRow: [String: String], previous: inout [String: String]
  ) -> [RemoteFieldRow] {
    var ordered: [RemoteModelRow] = []
    var placed: Set<String> = []
    for id in order {
      guard let row = model.byId[id], !placed.contains(id) else { continue }
      placed.insert(id)
      ordered.append(row)
    }
    for row in model.agents where !placed.contains(row.id) { ordered.append(row) }
    var rows: [RemoteFieldRow] = []
    var bodies: Set<String> = []
    var visuals: [String: String] = [:]
    for row in ordered {
      let session = row.isSelf ? sessionByRow[row.id] : nil
      let visualId = previous[row.id] ?? session ?? row.id
      visuals[row.id] = visualId
      // one body per visual identity: during a launcher hand-off the launched row takes over the shell's body
      guard bodies.insert(visualId).inserted else { continue }
      // the replica's rows are the fold's: a row it does not hold would have no key, and is never drawn keyless
      guard let kept = held(row.id) else { continue }
      let stale = row.isSelf ? row.monitor.stale : standing[row.monitor.device.id] != .live
      rows.append(RemoteFieldRow(row: row, board: kept.board, stale: stale, visualId: visualId))
    }
    // the window carries forward only the rows it drew
    previous = Dictionary(rows.map { ($0.id, visuals[$0.id] ?? $0.id) }) { first, _ in first }
    return rows
  }
}
