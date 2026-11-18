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
//   · item 464 (2026-11-16) — the hand-off's transfer (`pane-transitions.ts`, which the window's deck keeps in its
//     memory alone): a home session born in another's place says so on its pane join (`terminal.succeeds`), and its
//     row wears the body the other's row wore while that row is not drawn, or is drawn as `retained:<session>` when it
//     was typed into (`monitorRow.inputUsed`: its owner kept it). The lineage outlives a frame (`RemoteLineage`): a
//     successor arriving a frame after its predecessor's row left still takes the body, and when the claim stops being
//     said while the hidden predecessor stands, each takes its own body back;
//   · item 465 (2026-11-18) — a PEER desktop's hand-off, by the same lineage read a second time over every peer's
//     rows: a peer's claims are its own remote cut's, relayed whole by the home's mesh board, and each of its sessions
//     is keyed by its desktop and itself (`RemoteVisibility.peerKey`). A peer's row wears its own id where a home row
//     wears its session (`retained:<id>` when typed into), so a peer's rows draw as before whenever none claims;
//   · the ORDER the window draws: the home's agents by birth, then its terminals by birth (no pane or floor ranks
//     here), then every other desktop's rows, each desktop in its place and its rows as the fold first took them.
//
// Not transcribed: the window's `profileSet` drop for a peer (the phone has no spawn bloom), the object-identity caches
// (`createWindowRows`'s and `createRowOrder`'s: a value equality does their work), and two halves of the hand-off. The
// home window's own `rollback` (a placement that failed after the birth) is not on the wire: fieldd's lapse stands in
// for it (`AGENT_FIELD.SUCCEEDS_LAPSE_MS`), so the phone shows the successor on the one body until then. And the
// window reads a peer's hand-off by this same rule (`window-rows.ts`, item 465): a peer's rollback is not on the wire
// there either.

extension AgentRemoteRow {
  /// A bare terminal's row that names its pane: the join every reader of one reads (`isTerminalBoardRow`). A terminal
  /// whose owner's doors are down names none: on the HOME it ranks with the agents (`RemoteWindowRows.order`); a
  /// peer's row keeps its desktop's place whatever it names.
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
  /// home and named. A peer's rows join no pane here: no pane of the home shows them.
  ///
  /// Item 464 — and the session each of those rows says it succeeds (`succeedsByRow`): kept only beside a session of
  /// the row's own, and only when it names another, non-empty one.
  ///
  /// Item 465 — and every PEER desktop's rows by the same two rules (`peerJoins` in `window-local.ts`), keyed by the
  /// row's desktop (`peerSessionByRow`, `peerSucceedsByRow`): a peer agent's PTY is local to its own desktop.
  public static func joins(held: [RemoteModelBoard.Held], here: String?) -> RemoteVisibility {
    guard let here else { return RemoteVisibility() }
    var sessionByRow: [String: String] = [:]
    var succeedsByRow: [String: String] = [:]
    var peerSessionByRow: [String: String] = [:]
    var peerSucceedsByRow: [String: String] = [:]
    for entry in held {
      let board = entry.board
      guard let terminal = board.terminal else { continue }
      let session: String
      if board.isBareTerminal {
        session = terminal.runtimeSessionId ?? entry.row.id
      } else {
        guard terminal.hosted == "local", let named = terminal.runtimeSessionId, !named.isEmpty else { continue }
        session = named
      }
      let said = terminal.succeeds ?? ""
      let claim: String? = said.isEmpty || said == session ? nil : said
      if entry.device == here {
        sessionByRow[entry.row.id] = session
        if let claim { succeedsByRow[entry.row.id] = claim }
      } else {
        peerSessionByRow[entry.row.id] = RemoteVisibility.peerKey(device: entry.device, session: session)
        if let claim {
          peerSucceedsByRow[entry.row.id] = RemoteVisibility.peerKey(device: entry.device, session: claim)
        }
      }
    }
    return RemoteVisibility(
      sessionByRow: sessionByRow, succeedsByRow: succeedsByRow, peerSessionByRow: peerSessionByRow,
      peerSucceedsByRow: peerSucceedsByRow)
  }
}

/// Item 464 (2026-11-16) — the hand-off's lineage the window's rows carry from frame to frame beside `previous`
/// (`RemoteWindowRows.rows`): the body each home session wore, for a while after its last row left, and the drawn rows
/// that wear a body they inherited. Item 465 (2026-11-18) — the peers' is a second one of these (`peerLineage`), its
/// sessions keyed by their desktop (`RemoteVisibility.peerKey`).
public struct RemoteLineage: Sendable, Equatable {
  /// How many departed sessions keep their body.
  public static let departedLimit = 64

  /// A home session → the visual id its BODY wore when a row last stood for it in the model: that row's own when it
  /// was drawn, its successor's when it was hidden as succeeded (the body goes on).
  public internal(set) var bySession: [String: String] = [:]
  /// The sessions no row stands for any more, oldest first, at most `departedLimit`: each keeps its `bySession` entry
  /// until it falls off this list, since a successor can arrive a frame after its predecessor's row left.
  public internal(set) var departed: [String] = []
  /// A drawn row → the session whose body it wears, while its claim is still said.
  public internal(set) var inherited: [String: String] = [:]

  public init() {}
}

/// Item 464 — one frame's reading of the home's lineage, made before any row is drawn (the rules are
/// `pane-transitions.ts`'s `visualId` and `shows`, over what the wire says instead of what a deck remembers).
/// Item 465 — made twice a frame: over the home's rows, and over every peer desktop's (`peerHeirs` in
/// `window-rows.ts`, the same rule in TypeScript), each with its own sessions, claims and lineage.
private struct Heirs {
  enum Reading: Equatable {
    /// The lineage names nothing here: the row's visual id is the window's rule.
    case own
    case wears(String)
    /// A succeeded row: it stays in the model and the fold, and only its drawing yields to its successor.
    case hidden
  }

  /// The rows this lineage reads, in drawing order: the home's (item 464), or every peer's (item 465).
  let part: [RemoteModelRow]
  let sessionByRow: [String: String]
  let previous: [String: String]
  let lineage: RemoteLineage
  /// The body a row wears as its own, given the session it stands for: a home row's session (the window's rule,
  /// `session ?? id`), a peer row's id (its rows join no pane here, so the window's rule never names their sessions).
  let own: (String, String?) -> String
  /// A session → the first row of the part, in drawing order, that stands for it.
  private var standsFor: [String: String] = [:]
  /// A predecessor session → its successor's row: the first claimant in drawing order.
  private var successorOf: [String: String] = [:]
  /// A successor's row → the predecessor session it claims.
  private var claimOf: [String: String] = [:]
  /// A predecessor drawn again after its successor's claim lapsed → the body it wore.
  private var restored: [String: String] = [:]
  /// The rows whose claim lapsed while their predecessor's hidden row still stands: each takes its own body back.
  private var lapsed: Set<String> = []

  init(
    part: [RemoteModelRow], sessionByRow: [String: String], succeedsByRow: [String: String],
    previous: [String: String], lineage: RemoteLineage, own: @escaping (String, String?) -> String
  ) {
    self.part = part
    self.sessionByRow = sessionByRow
    self.previous = previous
    self.lineage = lineage
    self.own = own
    for row in part {
      guard let session = sessionByRow[row.id], standsFor[session] == nil else { continue }
      standsFor[session] = row.id
    }
    for row in part {
      // a later claimant of the same session has no claim, and a claim of a session nothing here has ever stood for
      // changes nothing
      guard let claim = succeedsByRow[row.id], successorOf[claim] == nil,
        standsFor[claim] != nil || lineage.bySession[claim] != nil
      else { continue }
      successorOf[claim] = row.id
      claimOf[row.id] = claim
    }
    // a row that inherited a body and no longer claims it, while the row it took it from stands and was hidden last
    // frame: the wire's lapse (a rollback on the home reads here as one), so each takes its own body back. Gone, or
    // drawn last frame (retained), the predecessor leaves the row the body it wears.
    for row in part {
      guard let was = lineage.inherited[row.id], claimOf[row.id] != was, let back = standsFor[was], back != row.id,
        previous[back] == nil
      else { continue }
      if claimOf[row.id] == nil { lapsed.insert(row.id) }
      if successorOf[was] == nil { restored[back] = lineage.bySession[was] ?? own(back, was) }
    }
  }

  /// A row's reading this frame; `session` is the one it stands for.
  func reading(_ row: RemoteModelRow, session: String?) -> Reading {
    if let session, let heir = successorOf[session], heir != row.id {
      // the owner kept a predecessor that was typed into: the successor keeps the body, and it gets one of its own
      // (`pane-transitions.ts:64-67`)
      return row.monitor.inputUsed == true ? .wears("retained:" + own(row.id, session)) : .hidden
    }
    if let claim = claimOf[row.id] {
      let kept = lineage.inherited[row.id] == claim ? previous[row.id] : nil
      let first = standsFor[claim]
      return .wears(
        kept ?? lineage.bySession[claim] ?? first.flatMap { previous[$0] } ?? first.map { own($0, claim) } ?? claim)
    }
    if lapsed.contains(row.id) { return .wears(own(row.id, session)) }
    if let body = restored[row.id] { return .wears(body) }
    return .own
  }

  /// The lineage after this frame. `drawn` is each drawn row's visual id (the new `previous`); `visuals`, every row's
  /// this frame read (a hidden row has none).
  func next(drawn: [String: String], visuals: [String: String]) -> RemoteLineage {
    var next = lineage
    var standing: Set<String> = []
    var written: Set<String> = []
    for row in part {
      guard let session = sessionByRow[row.id] else { continue }
      standing.insert(session)
      guard !written.contains(session) else { continue }
      if let body = drawn[row.id] {
        next.bySession[session] = body
        written.insert(session)
      } else if let heir = successorOf[session], heir != row.id, let body = visuals[heir] {
        // hidden as succeeded: the body goes on in its successor
        next.bySession[session] = body
        written.insert(session)
      }
    }
    next.departed.removeAll { standing.contains($0) }
    for session in next.bySession.keys.sorted() where !standing.contains(session) {
      if !next.departed.contains(session) { next.departed.append(session) }
    }
    while next.departed.count > RemoteLineage.departedLimit {
      next.bySession.removeValue(forKey: next.departed.removeFirst())
    }
    next.inherited = claimOf.filter { drawn[$0.key] != nil }
    return next
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
  /// visual id, and `lineage` the hand-off's (item 464, read from `succeedsByRow`), both rewritten on every call: call
  /// this once per frame. Item 465 — `peerLineage` is every peer desktop's hand-off, read from `peerSessionByRow` and
  /// `peerSucceedsByRow` (`RemoteVisibility.joins`), rewritten beside it.
  public static func rows(
    model: RemoteModel, held: (String) -> RemoteModelBoard.Held?, standing: [String: AgentMeshDeviceState],
    order: [String], sessionByRow: [String: String], succeedsByRow: [String: String],
    peerSessionByRow: [String: String] = [:], peerSucceedsByRow: [String: String] = [:],
    previous: inout [String: String], lineage: inout RemoteLineage, peerLineage: inout RemoteLineage
  ) -> [RemoteFieldRow] {
    var ordered: [RemoteModelRow] = []
    var placed: Set<String> = []
    for id in order {
      guard let row = model.byId[id], !placed.contains(id) else { continue }
      placed.insert(id)
      ordered.append(row)
    }
    for row in model.agents where !placed.contains(row.id) { ordered.append(row) }
    let home = Heirs(
      part: ordered.filter { $0.isSelf }, sessionByRow: sessionByRow, succeedsByRow: succeedsByRow,
      previous: previous, lineage: lineage, own: { id, session in session ?? id })
    let peers = Heirs(
      part: ordered.filter { !$0.isSelf }, sessionByRow: peerSessionByRow, succeedsByRow: peerSucceedsByRow,
      previous: previous, lineage: peerLineage, own: { id, _ in id })
    var rows: [RemoteFieldRow] = []
    var bodies: Set<String> = []
    var visuals: [String: String] = [:]
    for row in ordered {
      let session = row.isSelf ? sessionByRow[row.id] : nil
      var visualId = previous[row.id] ?? session ?? row.id
      // item 464 — the home's lineage over its rows; item 465 — the peers' over theirs, each session keyed by its
      // desktop. A row its lineage names nothing keeps the rule above.
      let reading =
        row.isSelf
        ? home.reading(row, session: session) : peers.reading(row, session: peerSessionByRow[row.id])
      switch reading {
      case .own: break
      case .wears(let body): visualId = body
      case .hidden: continue
      }
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
    lineage = home.next(drawn: previous, visuals: visuals)
    peerLineage = peers.next(drawn: previous, visuals: visuals)
    return rows
  }
}
