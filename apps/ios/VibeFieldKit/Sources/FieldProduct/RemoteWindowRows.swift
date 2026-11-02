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
  public var isBareTerminal: Bool { false }  // PG-3d (red): the skeleton reads no terminal
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
    RemoteVisibility()  // PG-3d (red): the skeleton joins nothing
  }
}

public enum RemoteWindowRows {
  /// The ids in the order the window draws them (`rowOrder` with no panes): the home's agents by birth, then the
  /// home's terminals by birth, then other desktops' rows in held order. Equal births keep held order, as
  /// JavaScript's stable sort does.
  public static func order(held: [RemoteModelBoard.Held], here: String?) -> [String] {
    []  // PG-3d (red): the skeleton orders nothing
  }

  /// Every row of the model, ordered and patched for this window (`rowsFor`): `order`'s ids first, then whatever the
  /// model holds beyond them; one body per visual identity. `previous` is the carry-forward of each DRAWN row's
  /// visual id, rewritten on every call: call this once per frame.
  public static func rows(
    model: RemoteModel, held: (String) -> RemoteModelBoard.Held?, standing: [String: AgentMeshDeviceState],
    order: [String], sessionByRow: [String: String], previous: inout [String: String]
  ) -> [RemoteFieldRow] {
    []  // PG-3d (red): the skeleton draws nothing
  }
}
