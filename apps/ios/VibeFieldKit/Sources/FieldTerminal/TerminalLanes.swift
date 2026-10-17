import FieldProduct
import FieldRoutedTerminal
import Foundation

/// ONE desktop's terminal lanes: a routed client per terminal CELL, kept while
/// this object lives, with every session the phone shows attached on it (the
/// freeway's kit half on today's transport — `draft/thinking-freeway.md` §5).
///
/// A cell is a terminal host process holding many sessions, and one connection
/// set to it carries up to the cell's activation cap
/// (`CELL_MAX_CONCURRENT_ACTIVATIONS`). The phone used to build a client per
/// tap — a ticket, two fresh sockets, two hellos — and tear it down on leave.
/// Here the first attach to a cell opens its lane; every later session on that
/// cell attaches over legs that are already up (`RoutedTerminalClient.open`
/// attaches on live legs), and a session the person leaves stays attached on
/// its lane until its attachment lets it go.
///
/// The lanes route frames, never render them: each session's own
/// `RoutedTerminalFrameSink` (its scene, its identity and lineage rules) is
/// registered here by its attachment, and `LaneSink` hands each call to it.
@MainActor
public final class TerminalLanes {
  public typealias TicketDoor = TerminalAttachment.TicketDoor
  public typealias RenewalDoor = TerminalAttachment.RenewalDoor

  /// How a fresh ticket is minted for one session after its lane lost a leg:
  /// the attachment's own mint, so the door's refusal reaches its card.
  typealias Reticket = @MainActor @Sendable (String) async throws -> RoutedTerminalTicket

  final class Lane {
    let client: RoutedTerminalClient
    let sink: LaneSink

    init(client: RoutedTerminalClient, sink: LaneSink) {
      self.client = client
      self.sink = sink
    }
  }

  let door: TicketDoor
  private let transport: any RoutedLegTransport
  private let renewal: RenewalDoor?
  private let budget: PhoneConnectionBudget?
  private let deadline: Duration
  private let log: TerminalAttachLog
  private var lanes: [String: Lane] = [:]
  /// Which cell each registered session rides, and how to re-mint for it.
  private var cellOf: [String: String] = [:]
  private var retickets: [String: Reticket] = [:]

  public convenience init(
    session: @escaping TerminalAttachment.SessionProvider,
    door: @escaping TicketDoor,
    renewal: RenewalDoor? = nil,
    budget: PhoneConnectionBudget? = nil,
    deadline: Duration = TerminalAttachment.stepDeadline,
    log: TerminalAttachLog = .device
  ) {
    self.init(
      transport: URLSessionRoutedTransport(session: session, log: log), door: door,
      renewal: renewal, budget: budget, deadline: deadline, log: log)
  }

  public init(
    transport: any RoutedLegTransport,
    door: @escaping TicketDoor,
    renewal: RenewalDoor? = nil,
    budget: PhoneConnectionBudget? = nil,
    deadline: Duration = TerminalAttachment.stepDeadline,
    log: TerminalAttachLog = .device
  ) {
    self.transport = transport
    self.door = door
    self.renewal = renewal
    self.budget = budget
    self.deadline = deadline
    self.log = log
  }

  /// The lane a ticket names — opened at its cell's first ticket — with this
  /// session's frames routed to `sink` and its re-mints to `reticket`.
  func lane(
    for ticket: RoutedTerminalTicket, sessionId: String, sink: RoutedTerminalFrameSink,
    reticket: @escaping Reticket
  ) -> RoutedTerminalClient {
    let cell = ticket.route.cellBootId
    let lane = lanes[cell] ?? openLane(cell)
    if let previous = cellOf[sessionId], previous != cell { lanes[previous]?.sink.forget(sessionId) }
    lane.sink.register(sink, for: sessionId)
    cellOf[sessionId] = cell
    retickets[sessionId] = reticket
    return lane.client
  }

  /// The client already carrying this session's activation, if a lane is.
  func client(holding sessionId: String) -> RoutedTerminalClient? {
    guard let cell = cellOf[sessionId], let lane = lanes[cell],
      lane.client.sessions[sessionId] != nil
    else { return nil }
    return lane.client
  }

  /// Point a session the lane still carries at a NEW attachment's sink: the
  /// binding the cell declared is replayed to it, so the frames that follow are
  /// admitted (`LaneSink.register`).
  func adopt(_ sessionId: String, sink: RoutedTerminalFrameSink, reticket: @escaping Reticket) {
    guard let cell = cellOf[sessionId], let lane = lanes[cell] else { return }
    lane.sink.register(sink, for: sessionId)
    retickets[sessionId] = reticket
  }

  /// A session's attachment let it go: its frames have nowhere to go now.
  func release(_ sessionId: String) {
    if let cell = cellOf[sessionId] { lanes[cell]?.sink.forget(sessionId) }
    cellOf[sessionId] = nil
    retickets[sessionId] = nil
  }

  /// Every lane closed — the app went to the background (iOS keeps no socket
  /// behind a suspended app) or the desktop went away. The scenes keep their
  /// pictures; the next attach opens a lane again.
  public func closeAll() {
    for lane in lanes.values { lane.client.close() }
    lanes = [:]
    cellOf = [:]
    retickets = [:]
  }

  /// How many lanes are open — one per cell the phone shows a session of.
  public var openLanes: Int { lanes.count }

  private func openLane(_ cell: String) -> Lane {
    let sink = LaneSink()
    let client = RoutedTerminalClient(
      transport: transport,
      sink: sink,
      options: .init(
        // A lane re-mints through the session it names, so the door's sentence
        // reaches that session's card — the face TM-r3 (K-M2) asked for.
        ticketProvider: { [weak self] session in
          guard let self else { throw CancellationError() }
          if let reticket = self.retickets[session] { return try await reticket(session) }
          return try RoutedTerminalTicket(json: try await self.door(session))
        },
        renewalProvider: TerminalAttachment.renewalProvider(renewal),
        viewId: "phone-\(UUID().uuidString.lowercased())",
        legBudget: budget,
        stepDeadline: deadline,
        log: log))
    let lane = Lane(client: client, sink: sink)
    lanes[cell] = lane
    log("lane opened cell=\(cell) — \(lanes.count) open")
    return lane
  }
}

/// One lane's sink: hands each call to the sink of the session it names, and
/// remembers each session's declared binding so a sink registered later (a new
/// attachment for a session the lane still carries) is bound before its first
/// frame. A session with no sink takes nothing.
@MainActor
final class LaneSink: RoutedFrameSink {
  private var sinks: [String: RoutedTerminalFrameSink] = [:]
  private var bindings: [String: (activation: String, identity: RoutedTrfIdentity)] = [:]

  func register(_ sink: RoutedTerminalFrameSink, for session: String) {
    sinks[session] = sink
    if let binding = bindings[session] {
      sink.bindActivation(session: session, activation: binding.activation, identity: binding.identity)
    }
  }

  func forget(_ session: String) {
    sinks[session] = nil
    bindings[session] = nil
  }

  func bindActivation(session: String, activation: String, identity: RoutedTrfIdentity) {
    bindings[session] = (activation, identity)
    sinks[session]?.bindActivation(session: session, activation: activation, identity: identity)
  }

  func applyFullFrame(
    _ payload: Data, session: String, activation: String, content: RoutedSceneStamp
  ) -> Bool {
    sinks[session]?.applyFullFrame(payload, session: session, activation: activation, content: content)
      ?? false
  }

  func applyDeltaFrame(
    _ payload: Data, session: String, activation: String, base: RoutedSceneStamp?,
    result: RoutedSceneStamp
  ) -> Bool {
    sinks[session]?.applyDeltaFrame(
      payload, session: session, activation: activation, base: base, result: result) ?? false
  }

  func activationEnded(session: String, activation: String, reason: String) {
    if bindings[session]?.activation == activation { bindings[session] = nil }
    sinks[session]?.activationEnded(session: session, activation: activation, reason: reason)
  }
}
