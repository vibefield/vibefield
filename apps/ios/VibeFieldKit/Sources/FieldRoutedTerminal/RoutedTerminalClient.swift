import FieldProduct
import Foundation
import Observation

/// What a viewer may ask the cell to send it (spec §7). The v1 core profile is
/// the pair; `snapshot` is a capability this client does not advertise.
public enum RoutedDemand: String, Sendable, Equatable {
  case none
  case live
}

/// One ask of `terminal.renewAttach` (spec §5.1): a CAS on the generation the
/// client holds, idempotent by `requestId` — so a retry of the SAME renewal
/// carries the same id, and a reply lost on the way back cannot bump the
/// generation twice.
public struct RoutedRenewal: Sendable, Equatable {
  public let sessionId: String
  public let expectGeneration: Int64
  public let requestId: String
}

/// One session's activation, as VALUES — never blanks.
///
/// The two-dimensional lease is the reason this is not a boolean: a read-only or
/// remote viewer must be able to display and advance a scene without input
/// authority, and the cell must be able to suspend input while presentation
/// continues. `PresentationReady` and `InputAllowed` are therefore computed, not
/// stored, and each one names every term it needs.
///
/// Not `Equatable`: it carries a transfer's staging buffer, and an `==` that
/// compared megabytes to answer "is this the same session" would be a trap with
/// a plausible name. The two enums below ARE comparable, which is what callers
/// and tests actually ask about.
public struct RoutedSessionState: Sendable {
  public enum Attach: Sendable, Equatable {
    case attaching
    case attached
    case refused(code: String, retryable: Bool)
    case ended(reason: String)
  }

  public enum Frames: Sendable, Equatable {
    case attaching
    case resuming
    case seeding
    case applying
    case active
    case failed(String)
  }

  public let sessionId: String
  public internal(set) var activationId: String
  public internal(set) var control: Attach = .attaching
  public internal(set) var frames: Frames = .attaching
  public internal(set) var rights: [RoutedRight] = []
  public internal(set) var identity: RoutedTrfIdentity?
  public internal(set) var resumeToken: String?
  public internal(set) var status: RoutedActivationStatus?
  public internal(set) var appliedContent: RoutedSceneStamp?
  public internal(set) var lastSeedReason: String?
  /// The cell's own words for the last refusal, kept after the state moved on so
  /// a face can say WHY rather than showing an empty pane.
  public internal(set) var lastRefusal: String?
  /// The cell said this session's run EXITED, with its facts. The run is over,
  /// so input is held from here; the activation is not ended by it — frames
  /// already in flight still land, so the last screen is the run's own — and
  /// ends when the cell removes the session or a leg goes.
  public internal(set) var exit: RoutedSessionExit?
  /// item 42 — the session's geometry seat as the cell last ANNOUNCED it
  /// (`RoutedGeometryState`, behind `geometry-events`), with whether its holder
  /// is this client: what a face reads to say who drives the session. Nil until
  /// the cell has said, which it does at once on an attach once a size was ever
  /// committed. The SESSION's, not the activation's, as `exit` is: a fresh
  /// activation carries it until that attach's announcement replaces it, and it
  /// goes with the session (`forget`, a new cell boot, the cell's `removed`).
  public internal(set) var seat: RoutedSessionSeat?
  /// This activation has been ended (`endActivation`) — once: a teardown ends
  /// what a revoke or a lost leg did not already, and the sink hears each end
  /// once. A fresh activation is a fresh state.
  var activationEnded = false

  /// BOTH legs are attached for this activation.
  ///
  /// Attached is not the same as presenting: the frames leg is attached the
  /// moment the cell acknowledges it, and what follows — resuming, seeding, the
  /// first applied frame — is progress, not attachment. A client that called
  /// itself attached only once a frame had landed would report `ready` over a
  /// session it was fully attached to, which is what the first version of this
  /// did until a real socket delivered the two acknowledgements in the other
  /// order.
  public var bothLegsAttached: Bool {
    guard control == .attached else { return false }
    switch frames {
    case .attaching, .failed: return false
    case .resuming, .seeding, .applying, .active: return true
    }
  }

  /// `PresentationReady(a)` — spec §5.4, every term of it:
  /// both legs' leases live, the cell's presentation dimension presenting, the
  /// lease unexpired against a LOCAL deadline, and this client's applied content
  /// at or past what the cell has accepted.
  ///
  /// A frame IN FLIGHT over an applied scene is the spec's `active` worker
  /// state, not a seed: what the glass holds is this lineage's, and the content
  /// term below is what says whether it has caught up. Reading `.applying` as
  /// not ready closed input for the length of every frame's render, so a TUI's
  /// output stream held the phone's keyboard shut (2026-10-17). A seed in
  /// flight has no applied scene under it and stays not ready.
  public var presentationReady: Bool { presentationHeldBecause == nil }

  /// The terms of `PresentationReady(a)`, stated ONCE: the first that fails, in
  /// a line's words, or nil when the presentation is ready. The verdict above
  /// and `inputHeldBecause` both read it, so a reason can never name a term
  /// the verdict did not fail on (a dropped gesture says it; the phone's swipes
  /// after a reopen, 2026-10-17, dropped with no reason given).
  public var presentationHeldBecause: String? {
    guard control == .attached else { return "the control leg is \(control)" }
    guard let status else { return "the cell has said nothing yet" }
    switch frames {
    case .active: break
    case .applying where appliedContent != nil: break
    case .seeding, .applying:
      return "the picture is \(frames)" + (lastSeedReason.map { " — \($0)" } ?? "")
    case .attaching, .resuming, .failed:
      return "the picture is \(frames)"
    }
    guard case .presenting = status.presentation else {
      return "the cell's presentation is \(status.presentation)"
    }
    guard leaseLive else { return "the presentation lease ran out" }
    guard let accepted = status.acceptedContent else { return nil }
    guard let applied = appliedContent else { return "no scene is applied" }
    guard let order = RoutedSceneStamp.compare(applied, accepted) else {
      return "the applied scene is of another lineage than the cell's"
    }
    return order >= 0 ? nil : "the applied scene is behind the cell's"
  }

  /// `InputAllowed(a)` = `PresentationReady(a)` ∧ the cell's input dimension
  /// allowed ∧ the attach right still inside its local expiry margin. The LAG
  /// decision is the cell's alone — it holds newest and accepted — and arrives
  /// as `input: suspended{lagging}`; nothing here computes lag.
  public var inputAllowed: Bool { inputHeldBecause == nil }

  /// The terms of `InputAllowed(a)`, stated once, as `presentationHeldBecause`
  /// states its own.
  public var inputHeldBecause: String? {
    // First: a run that exited takes no keys whatever the legs say, and a key
    // sent to it went nowhere with no word (the audit's P8, 2026-10-17).
    if let exit { return "the run exited — \(exit.outcome)" }
    if let held = presentationHeldBecause { return held }
    guard let status else { return "the cell has said nothing yet" }
    guard case .allowed = status.input else { return "the cell holds input: \(status.input)" }
    guard rights.contains(.input) else { return "this view has no input right" }
    guard inputRightLive else { return "the input right ran out" }
    return nil
  }

  /// Timers are eager notifications, never the authority: every lease is checked
  /// against a deadline taken at receipt, synchronously, at the moment it
  /// matters.
  internal var leaseDeadlineMs: Int64 = 0
  internal var inputRightDeadlineMs: Int64 = 0
  internal var nowMs: Int64 = 0
  internal var inputSequence: Int64 = 0
  internal var demandSequence: Int64 = 0
  /// DS-4b — the seat as last ANNOUNCED to this client: the revision its next
  /// verb must expect, and the holder (nil = empty, or never heard of). The
  /// cell pushes nothing to a displaced holder, so this is learned from
  /// `GeometryCommitted` and from refusals, never assumed.
  ///
  /// Corrected 2026-10-19 (item 42): with `geometry-events` negotiated the cell
  /// DOES push the seat, to the control leg of every activation of the session
  /// (`RoutedGeometryState`, kept on `seat`). These two are still the verbs'
  /// own, learned from their answers alone, so a take built on a stale one
  /// earns its one retry exactly as before; `seat` is what a face reads.
  public internal(set) var geometryRevision: Int64 = 0
  public internal(set) var geometryHolder: RoutedGeometryHolder?
  public internal(set) var demand: RoutedDemand = .live
  internal var framesAttachSent = false
  internal var transfer: RoutedTransfer?
  internal var activationSequence: Int64 = -1
  /// CONSECUTIVE authoritative scenes this activation's sink refused. Reset by
  /// any frame that applies; the bound it is counted against is
  /// `RoutedTerminalClient.maxRefusedRepairs`, and what happens at the bound is
  /// written on `repairRefused`.
  internal var refusedRepairs = 0

  public var leaseLive: Bool { nowMs < leaseDeadlineMs }
  public var inputRightLive: Bool { nowMs < inputRightDeadlineMs }

  init(sessionId: String, activationId: String) {
    self.sessionId = sessionId
    self.activationId = activationId
  }
}

/// The phone's routed T1 client: one connection SET (two legs) to one cell, and
/// the activations that ride it.
///
/// A `@MainActor` model rather than an actor, for `FieldProductClient`'s own
/// reason: this is a single-threaded state machine whose correctness is ORDER —
/// send nothing before the accept, mint an activation id before either attach,
/// never apply a frame from a superseded activation, return a unit's credit
/// exactly once — and an actor would buy parallelism it has no use for at the
/// cost of the one property those rules rest on. The sockets are actors, which
/// is where the concurrency actually is.
///
/// Nothing here imports Ghosttea, and the only VibeField types in its surface
/// are the ticket shapes and the frame sink (TM-D4: this code is written to move
/// into GhostteaKit as the third routed-client core, petition G27).
@MainActor
@Observable
public final class RoutedTerminalClient {
  public enum State: Sendable, Equatable {
    /// Nobody has opened a ticket.
    case off
    case connecting
    /// Both legs accepted. Sessions may attach.
    case ready
    /// At least one session has both legs attached.
    case attached
    /// A leg is gone and a FRESH TICKET is needed to replace it — see
    /// `needsTicket`. This is not a socket-level retry: a transport grant's
    /// `(nonce, channel)` is consumed on first use, so re-dialing with the ticket
    /// in hand earns `GRANT_NONCE_REPLAYED`, which is terminal for that grant.
    case reconnecting
    /// The cell says this session is not here any more. The caller re-resolves
    /// the route and mints a new ticket; the client cannot, and does not pretend.
    case staleRoute
    /// A structured, POST-verification refusal, in the cell's own words.
    case refused(code: String)
    /// Terminal for this client.
    case failed(reason: String)
    /// fix8 — an attach step outlived `Options.stepDeadline`, and the set was
    /// torn down rather than left waiting. Terminal for this client: a fresh
    /// attach is the caller's act.
    case stalled(AttachStep)
  }

  /// fix8 — where an attach stands between a ticket and its first frame. Each
  /// is a wait on something this client does not control, and each has the
  /// same deadline (`Options.stepDeadline`): PJ-7's second phone run sat on
  /// one of them for good, with the card saying "connecting over the mesh…".
  public enum AttachStep: String, Sendable, Equatable, CaseIterable {
    /// A leg was lost and a fresh ticket is being minted (`ticketProvider`).
    case ticket
    /// The phone's terminal-leg budget is spent: waiting for a slot.
    case slot
    /// Both legs dialing: a socket, a hello, the cell's accept.
    case dial
    /// `AttachControlLeg` sent: waiting for the cell's acknowledgement.
    case control
    /// `AttachFramesLeg` sent: waiting for the cell's acknowledgement.
    case frames
    /// Both legs attached: waiting for the first presented frame.
    case firstFrame
  }

  public struct Options: Sendable {
    /// How a fresh ticket is obtained for a session. Absent = the caller drives
    /// it: the client surfaces `reconnecting` / `staleRoute` with `needsTicket`
    /// and waits to be handed one. Present = the client re-tickets itself with
    /// backoff, which is what the phone's attachment wants.
    public var ticketProvider: (@MainActor @Sendable (String) async throws -> RoutedTerminalTicket)?
    /// P0-C — how an attach grant is RENEWED: one `terminal.renewAttach` over
    /// the product door, answered with the renewed grant. Absent = nothing
    /// renews, input closes a minute before the grant expires, and the cell
    /// revokes the activation at expiry — which this client then answers by
    /// re-attaching with a fresh ticket, never by calling the session ended.
    public var renewalProvider: (@MainActor @Sendable (RoutedRenewal) async throws -> RoutedGrant)?
    public var maxBackoff: Duration
    /// A claimant id for the geometry lease. The cell mints the holder
    /// generation; the caller can only name itself.
    public var viewId: String
    public var capacities: RoutedReceiverCapacities
    /// SP-2 (g) — the phone's budget the two legs count against
    /// (`PhoneBudget.terminalLegs`). Nil: no budget.
    public var legBudget: PhoneConnectionBudget?
    /// fix8 — how long any one `AttachStep` may wait before the set is torn
    /// down and the state says which step it stopped at.
    public var stepDeadline: Duration
    /// fix8 — where the attach's phases are written.
    public var log: TerminalAttachLog

    public init(
      ticketProvider: (@MainActor @Sendable (String) async throws -> RoutedTerminalTicket)? = nil,
      renewalProvider: (@MainActor @Sendable (RoutedRenewal) async throws -> RoutedGrant)? = nil,
      maxBackoff: Duration = .seconds(10),
      viewId: String = UUID().uuidString,
      capacities: RoutedReceiverCapacities = .phone,
      legBudget: PhoneConnectionBudget? = nil,
      stepDeadline: Duration = .seconds(20),
      log: TerminalAttachLog = .silent
    ) {
      self.ticketProvider = ticketProvider
      self.renewalProvider = renewalProvider
      self.maxBackoff = maxBackoff
      self.viewId = viewId
      self.capacities = capacities
      self.legBudget = legBudget
      self.stepDeadline = stepDeadline
      self.log = log
    }
  }

  /// fix8 — the attach step this client is waiting on, nil when it waits on
  /// nothing (off, presenting, or stopped with a reason).
  public private(set) var step: AttachStep?

  public private(set) var state: State = .off
  public private(set) var sessions: [String: RoutedSessionState] = [:]
  /// Names the cell's own words for the last thing that went wrong, kept after
  /// the state moved on. Never a grant, never a URL.
  public private(set) var lastRefusal: String?
  /// True while the client is waiting for a ticket it cannot mint.
  public private(set) var needsTicket = false
  public private(set) var negotiatedCapabilities: [String] = []

  private let transport: any RoutedLegTransport
  private let sink: any RoutedFrameSink
  private let options: Options
  private var control: RoutedLeg?
  private var frames: RoutedLeg?
  private var controlAccepted: RoutedConnectionAccepted?
  private var framesAccepted: RoutedConnectionAccepted?
  private var ticket: RoutedTerminalTicket?
  private var grants: [String: RoutedGrant] = [:]
  /// item 42 — every client this client's attach grants for a session named
  /// (`keep`): a seat whose holder is one of them is THIS client's
  /// (`RoutedSessionSeat.Driver.mine`). Every one, not the latest: a fieldd
  /// restart mints this phone a new client (TP-R21) while the cell may still
  /// hold the seat for the one before, within its grace — the desktop's
  /// `ownClients`, the same rule. They go with the session, as its grant does.
  private var ownClients: [String: Set<String>] = [:]
  private var limits = RoutedProtocolLimits.floor
  private var ledger = RoutedCreditLedger(creditEpoch: 0)
  private var pumps: [Task<Void, Never>] = []
  /// "Re-mint once, then UNAVAILABLE" — the pre-authentication rule, counted.
  private var preAuthRetried = false
  /// SP-2 (g) — the two legs' budget slots, and a dial waiting for them.
  private var legGrant: PhoneConnectionBudget.Grant?
  private var legGrantTask: Task<Void, Never>?
  /// fix8 — the armed deadline for `step`, and which arming it is.
  private var stepTimer: Task<Void, Never>?
  private var stepToken = 0
  /// fix8 — a `ticketProvider` call in flight: the only part of a re-ticket
  /// that is a wait (a refused mint is an answer, said by the caller's face,
  /// and the backoff after it is this client's own sleep).
  private var mintInFlight = false
  /// fix8 — activations that have presented once. Past their first frame an
  /// activation is not attaching any more, and no attach deadline applies.
  private var presented: Set<String> = []

  /// Whether `sessionId`'s CURRENT activation has presented a frame. Past that
  /// first frame a reseed (a resize, a repair) is the scene catching up, not
  /// the session connecting: `presentationReady` drops until the reseed is
  /// applied and holds INPUT meanwhile, but the screen is up.
  public func hasPresented(_ sessionId: String) -> Bool {
    guard let session = sessions[sessionId] else { return false }
    return presented.contains(session.activationId)
  }

  /// Whether this client carries a LIVE activation of `sessionId`: both its
  /// legs up, and the session attached on both. The client answers rather than
  /// the session's own state, which cannot see the legs — a caller's fast path
  /// ("no mint, no dial") asks here (P5).
  public func hasLiveActivation(_ sessionId: String) -> Bool {
    guard control != nil, frames != nil else { return false }
    return sessions[sessionId]?.bothLegsAttached == true
  }
  /// D1 — each session's last queued apply, which its next one waits on
  /// (`enqueueApply`).
  private var applyTails: [String: Task<Void, Never>] = [:]

  // MARK: DS-4b — the lease verbs' bookkeeping

  /// A cols × rows a pane asked for.
  private struct Grid: Equatable {
    let cols: Int
    let rows: Int
  }

  /// The seat a verb was BUILT ON: the holder and revision this client
  /// believed when it sent it. A refusal that repeats it exactly says nothing
  /// new, and a take is never retried on nothing new.
  private struct SeatBelief: Equatable {
    let holder: RoutedGeometryHolder?
    let revision: Int64
  }

  /// One geometry verb in flight on the control leg. The cell answers each
  /// claim and transfer with exactly one `GeometryCommitted` or
  /// `GeometryRefused`, on the CALLER's leg, in order — and neither names the
  /// session or the verb — so answers are matched to asks in send order
  /// (ghosttea-react's own rule). A take carries whether it is already the
  /// retry: one retry per take, owned here, never by the host.
  private struct GeometryAsk {
    enum Intent { case take, resize, claim }
    let sessionId: String
    let intent: Intent
    let basis: SeatBelief
    let grid: Grid
    let retried: Bool
  }

  private var geometryAsks: [GeometryAsk] = []
  /// A take asked before its session's control leg attached: held, the newest
  /// grid kept, and sent the moment the leg attaches with the right.
  private var pendingTakes: [String: Grid] = [:]
  /// The grid each pane wants now — what a take or a resize carries, and what
  /// a commit is checked against.
  private var wantedGrids: [String: Grid] = [:]
  private var closed = false
  private var generation = 0

  /// Mirrors the cell's `ATTACH_RENEWAL_MARGIN_MS`: input closes this far before
  /// an attach grant expires unless a renewal arrives. The CELL enforces it (it
  /// suspends input with `right-expired` and drops what arrives late); this is
  /// the local half, so a keystroke is refused on the device rather than sent to
  /// be dropped and audited.
  private static let attachRenewalMarginMs = Int64(RoutedTerminalContract.attachRenewalMarginMs)

  /// P0-C — how far BEFORE that margin a renewal is asked for, so the renewed
  /// grant lands while input is still open. Not a wire number: the margin is
  /// the cell's; this is the phone's headroom for a round trip over the mesh
  /// and a retry or two. (The renderer's runtime asks AT the margin, which the
  /// 2026-09-24 audit noted costs it one round trip of closed input.)
  public static let renewalHeadroomMs: Int64 = 30_000

  /// The renewal each attached session has scheduled, cancelled with its
  /// activation.
  private var renewals: [String: Task<Void, Never>] = [:]

  /// How many AUTHORITATIVE scenes in a row the sink may refuse before this
  /// client stops asking for another (see `repairRefused`).
  ///
  /// Three, and not one: the first refusal of a self-contained frame is
  /// plausibly a race — the sink's bound activation changed between the client
  /// dispatching the frame and the sink taking it — and failing a session over
  /// one lost race would be worse than the blank it replaces. Three in a row,
  /// with a fresh scene between each, is not a race. It is not a wire number
  /// and has no home in `registries.ts`: the cell has no opinion about what
  /// this viewer's renderer can parse.
  private static let maxRefusedRepairs = 3

  public init(
    transport: any RoutedLegTransport, sink: any RoutedFrameSink, options: Options = .init()
  ) {
    self.transport = transport
    self.sink = sink
    self.options = options
  }

  // MARK: Opening

  /// Open (or re-open) with a ticket.
  ///
  /// A ticket for a DIFFERENT cell boot replaces the connection set outright —
  /// a replaced cell is a NEW key, never a reconnect (TC-S6), and carrying an
  /// activation across one would be carrying it across a lineage.
  public func open(_ ticket: RoutedTerminalTicket) {
    guard !closed else { return }
    defer { reconcileStep() }
    guard let sessionId = ticket.sessionId else {
      fail("the ticket's attach grant names no session")
      return
    }
    let now = Self.nowMs()
    switch ticket.transportGrant.validity(at: now) {
    case .valid: break
    case .expired, .notYetValid, .lifetimeExceeded:
      // Refused HERE rather than at the door: a grant outside its window earns a
      // silent 1008 that carries no reason, and guessing at one afterwards is
      // worse than naming it now.
      needsTicket = true
      state = .reconnecting
      lastRefusal = "the ticket's transport grant is not currently valid"
      return
    }

    if let current = self.ticket, current.route.cellBootId != ticket.route.cellBootId {
      teardown()
    }
    keep(ticket.attachGrant, for: sessionId)
    self.ticket = ticket
    needsTicket = false

    if control == nil || frames == nil {
      dial(ticket)
    } else if case .ready = state {
      attach(sessionId: sessionId)
    } else if case .attached = state {
      attach(sessionId: sessionId)
    }
  }

  /// A fresher attach grant for a session already attached (the answer to
  /// `terminal.renewAttach`). Renewal rides the SAME `AttachControlLeg` at a
  /// higher generation: idempotent for the activation, rights and expiry
  /// updated, and a dropped input right revoked the moment the cell accepts it.
  ///
  /// P0-C (2026-09-24) — the renewal schedule (`scheduleRenewal`) calls this,
  /// given an `Options.renewalProvider`. Until then it had NO caller (TM-r3,
  /// K-M1): input closed at 540 s of every phone attach, and at 600 s the cell
  /// revoked the whole activation, which the card called "this session ended"
  /// over a PTY that was still running. (TM-r's note that renewal was a
  /// product-wide gap was wrong about the renderer, whose routed runtime has
  /// renewed through `terminal.renewAttach` since G23 — the gap was this one.)
  public func renew(_ grant: RoutedGrant) {
    guard let sessionId = grant.sessionId, var session = sessions[sessionId] else { return }
    guard let held = grants[sessionId], let next = grant.grantGeneration,
      let current = held.grantGeneration, next >= current
    else { return }
    keep(grant, for: sessionId)
    session.inputRightDeadlineMs = Self.inputRightDeadline(for: grant)
    sessions[sessionId] = session
    control?.send(
      .attachControlLeg,
      [
        "activationId": .string(session.activationId),
        "attachGrant": grant.raw,
        "initialDemand": .object(["mode": .string(session.demand.rawValue)]),
      ])
  }

  /// The attach grant `sessionId` attaches with from here, and its client as
  /// one of this client's own for the seat (`ownClients`).
  private func keep(_ grant: RoutedGrant, for sessionId: String) {
    grants[sessionId] = grant
    ownClients[sessionId, default: []].insert(grant.clientId)
  }

  public func close() {
    closed = true
    teardown()
    state = .off
    reconcileStep()
  }

  /// Let ONE session go and keep the legs for the others (the freeway's lanes,
  /// `TerminalLanes`): its view is detached at the cell (demand `none`), its
  /// renewal stops, and this client forgets it — so the cell lets the
  /// activation lapse at its grant's expiry, and a later attach of it starts a
  /// fresh activation. Closing the client is the whole set's end; this is one
  /// passenger's.
  public func forget(sessionId: String) {
    guard sessions[sessionId] != nil else { return }
    declare(demand: .none, for: sessionId)
    renewals[sessionId]?.cancel()
    renewals[sessionId] = nil
    sessions[sessionId] = nil
    grants[sessionId] = nil
    ownClients[sessionId] = nil
    pendingTakes[sessionId] = nil
    wantedGrids[sessionId] = nil
    noteAttachment()
    // A step this session was the one waiting on is no one's now (P6).
    reconcileStep()
  }

  // MARK: The control verbs

  /// Typed text. Nil when sent (or held at the input gate, which says why
  /// elsewhere); a refusal, with its numbers, when it is too large to send.
  @discardableResult
  public func send(text: String, to sessionId: String) -> RoutedInputRefusal? {
    sendText(text, .typed, to: sessionId)
  }

  /// A paste — see `send(text:to:)`.
  @discardableResult
  public func paste(_ text: String, to sessionId: String) -> RoutedInputRefusal? {
    sendText(text, .pasted, to: sessionId)
  }

  /// A keystroke, in ghosttea's own `KeyInput` serde spelling — the cell
  /// deserializes the wire `op` straight into the engine's type, so the shape is
  /// the engine's and not this client's to choose.
  public func send(key: RoutedKeyInput, to sessionId: String) {
    sendInput(sessionId: sessionId, op: .object(["kind": .string("key"), "key": key.json]))
  }

  public func interrupt(_ sessionId: String) {
    sendInput(sessionId: sessionId, op: .object(["kind": .string("interrupt")]))
  }

  /// A pointer event, in ghosttea's own `MouseInput` serde spelling — the same
  /// rule `send(key:)` states: the cell deserializes the wire `op` straight into
  /// the engine's type.
  ///
  /// A non-finite coordinate is DROPPED here. `RoutedMouseInput`'s own doc said
  /// so and nothing enforced it (TM-r3, K-L2): `TerminalAttachment.handleMouse`
  /// checked `isFinite` and no other caller did, so the claim was true of one
  /// path and false of this surface. The cell's reader refuses an infinity
  /// before it can reach the engine (`deserialize_finite_mouse_input`), and a
  /// message spent to be refused there is a message that told this device
  /// nothing — the refusal is an audit line, not a reply.
  public func send(mouse: RoutedMouseInput, to sessionId: String) {
    guard mouse.isFinite else { return }
    sendInput(sessionId: sessionId, op: .object(["kind": .string("mouse"), "mouse": mouse.json]))
  }

  /// Scroll by rows. SIGNED — negative scrolls up (the contract's own note on
  /// `SendInputOp.scroll`).
  public func scroll(rows: Int, for sessionId: String) {
    guard rows != 0 else { return }
    sendInput(
      sessionId: sessionId, op: .object(["kind": .string("scroll"), "rows": .int(Int64(rows))]))
  }

  /// Scroll to an ABSOLUTE row index.
  public func scrollTo(row: Int, for sessionId: String) {
    guard row >= 0 else { return }
    sendInput(
      sessionId: sessionId,
      op: .object(["kind": .string("scroll-to"), "row": .int(Int64(row))]))
  }

  /// Scroll to the BOTTOM — the active area — which then follows output.
  ///
  /// A `scroll-to` row at or past the active area pins the viewport there
  /// (ghostty's `PageList` `.row`: `n >= total_rows - rows` → `.active`), so
  /// the contract's largest row means the bottom whatever has scrolled in
  /// since this client's last frame. A total read off that frame would land
  /// short under output and stop following.
  public func scrollToBottom(for sessionId: String) {
    sendInput(
      sessionId: sessionId,
      op: .object(["kind": .string("scroll-to"), "row": .int(Self.bottomRow)]))
  }

  /// `JsonSafeU64`'s ceiling (`Number.MAX_SAFE_INTEGER`): the largest row a
  /// `scroll-to` may carry, and so the one that always names the bottom.
  static let bottomRow: Int64 = 9_007_199_254_740_991

  /// Ask for a fresh authoritative scene.
  ///
  /// There is no "send me a seed" verb on the wire, and inventing one would be
  /// this client claiming a surface the cell does not have. The cell's OWN
  /// trigger for a reseed is a `SceneApplied` that does not advance, so that is
  /// exactly what this does: it drops the applied stamp, which stops this client
  /// reporting progress it can no longer back up, and the cell sends a seed.
  /// The same mechanism `lineageBroke` uses when the sink rejects a delta —
  /// stated once, in one place, with one behaviour.
  ///
  /// *Corrected 2026-10-17 (the scroll audit; the second audit's D2): the cell
  /// has no such trigger. `scene_applied` only records (`tp/activation.rs`), and
  /// the pump reseeds on start, hub lag, starvation, oversize and demand `none`
  /// only (`tp/presentation.rs`) — so on an idle session this asks the cell for
  /// nothing, and input stays held until output moves. What works today is a
  /// demand cycle (`none` → `live`), which also detaches the view and releases
  /// the geometry seat. A real repair verb is owed in the contract (TM's).*
  public func requestReseed(for sessionId: String) {
    guard var session = sessions[sessionId] else { return }
    session.appliedContent = nil
    session.frames = .seeding
    session.lastSeedReason = "the viewer asked for a fresh scene"
    sessions[sessionId] = session
    options.log("frames: a fresh scene asked for — input waits for a seed session=\(sessionId)")
  }

  /// Declare what this viewer wants. `live` attaches the cell's view (and starts
  /// the frames), `none` detaches it — warm and hot are the engine's own reading
  /// of whether anyone is watching.
  public func declare(demand: RoutedDemand, for sessionId: String) {
    guard var session = sessions[sessionId] else { return }
    session.demand = demand
    session.demandSequence += 1
    sessions[sessionId] = session
    control?.send(
      .declareDemand,
      [
        "sessionId": .string(sessionId),
        "activationId": .string(session.activationId),
        "leaseEpoch": .int(leaseEpoch(for: sessionId)),
        "demandSequence": .int(session.demandSequence),
        "demand": .object(["mode": .string(demand.rawValue)]),
      ])
  }

  /// Claim the geometry seat and resize — the bare verb. FOCUS NEVER IMPLIES A
  /// CLAIM in the cell (TP-L-D): the seat is explicit, held by one viewer, and
  /// a second claimant is refused `SEAT_HELD` rather than quietly taking it.
  /// The PRODUCT's policy on focus is `takeGeometry`, above this.
  public func claimGeometry(cols: Int, rows: Int, for sessionId: String) {
    guard let session = sessions[sessionId], session.rights.contains(.geometry) else { return }
    sendClaim(
      sessionId: sessionId, grid: Grid(cols: cols, rows: rows),
      revision: session.geometryRevision, intent: .claim, retried: false)
  }

  /// DS-4b — THE TAKE (TPv3 §6 as amended 2026-09-30, DS-D5): the pane the
  /// person focused LAST holds the geometry, on any device, last write wins.
  /// The host calls this ONCE per focus gain; the retry is this client's.
  ///
  /// - An empty seat (as last announced) is CLAIMED; this view's own seat is
  ///   claimed too, which the cell commits as a resize.
  /// - A seat another view holds is taken with ONE `TransferGeometry` from the
  ///   announced holder to this view, at the announced revision.
  /// - The cell tells a displaced holder nothing, so this client's belief may
  ///   be stale; the refusal of a stale take IS the announcement, and earns
  ///   exactly one retry against what it announced (`retryTake`). (Item 42,
  ///   2026-10-19: the cell does tell it now, onto `seat`, which no verb reads
  ///   — see `RoutedSessionState.geometryHolder`.)
  /// - A session whose control leg has not attached holds the take until it
  ///   does (the newest grid wins); a grant without `geometry` sends no verb.
  public func takeGeometry(cols: Int, rows: Int, for sessionId: String) {
    let grid = Grid(cols: cols, rows: rows)
    wantedGrids[sessionId] = grid
    guard let session = sessions[sessionId], session.control == .attached, control != nil,
      let ticket
    else {
      pendingTakes[sessionId] = grid
      return
    }
    pendingTakes[sessionId] = nil
    guard session.rights.contains(.geometry) else { return }
    if let holder = session.geometryHolder,
      !holder.isClaimant(clientId: ticket.clientId, viewId: options.viewId)
    {
      sendTransfer(
        sessionId: sessionId, from: holder, grid: grid, revision: session.geometryRevision,
        retried: false)
    } else {
      sendClaim(
        sessionId: sessionId, grid: grid, revision: session.geometryRevision, intent: .take,
        retried: false)
    }
  }

  /// DS-4b — the pane's grid moved. The HOLDER resizes its own seat; a pane
  /// that lost the seat renders what the holder sized and NEVER claims on a
  /// mere resize — only a focus gain takes. A take still held, or in flight,
  /// carries the newest grid instead (a commit that lands at an older grid is
  /// followed by one resize).
  public func resizeGeometry(cols: Int, rows: Int, for sessionId: String) {
    let grid = Grid(cols: cols, rows: rows)
    wantedGrids[sessionId] = grid
    if pendingTakes[sessionId] != nil {
      pendingTakes[sessionId] = grid
      return
    }
    guard !geometryAsks.contains(where: { $0.sessionId == sessionId }) else { return }
    guard let session = sessions[sessionId], session.rights.contains(.geometry) else { return }
    // A parked session presents no view: the cell refuses any geometry verb
    // for it (VIEW_NOT_PRESENTING), so none is sent — the grid waits in
    // `wantedGrids` for the take that brings the view back.
    guard session.demand == .live else { return }
    guard holdsGeometry(sessionId) else {
      options.log(
        "seat: \(grid.cols)×\(grid.rows) measured and kept — \(seatWords(session.geometryHolder)) "
          + "session=\(sessionId)")
      return
    }
    sendClaim(
      sessionId: sessionId, grid: grid, revision: session.geometryRevision, intent: .resize,
      retried: false)
  }

  /// DS-4b — whether this view holds the seat, as last ANNOUNCED. The cell
  /// tells a displaced holder nothing, so a `true` here may be stale until the
  /// next verb's answer — which is exactly how the take learns otherwise.
  /// (Item 42, 2026-10-19: the cell's push lands on the session's `seat`, whose
  /// `mine` asks of this CLIENT what this asks of this VIEW, and moves with the
  /// cell's word where this moves with the verbs' answers.)
  public func holdsGeometry(_ sessionId: String) -> Bool {
    guard let ticket, let holder = sessions[sessionId]?.geometryHolder else { return false }
    return holder.isClaimant(clientId: ticket.clientId, viewId: options.viewId)
  }

  private func sendClaim(
    sessionId: String, grid: Grid, revision: Int64, intent: GeometryAsk.Intent, retried: Bool
  ) {
    guard let session = sessions[sessionId], let ticket, let control else { return }
    geometryAsks.append(
      GeometryAsk(
        sessionId: sessionId, intent: intent,
        basis: SeatBelief(holder: session.geometryHolder, revision: revision), grid: grid,
        retried: retried))
    control.send(
      .claimGeometry,
      [
        "sessionId": .string(sessionId),
        "activationId": .string(session.activationId),
        "leaseEpoch": .int(leaseEpoch(for: sessionId)),
        "claimant": .object([
          "clientId": .string(ticket.clientId), "viewId": .string(options.viewId),
        ]),
        "cols": .int(Int64(grid.cols)),
        "rows": .int(Int64(grid.rows)),
        "expectRevision": .int(revision),
      ])
    options.log(
      "seat \(intent) \(grid.cols)×\(grid.rows) at r\(revision)\(retried ? ", the one retry" : "") "
        + "session=\(sessionId)")
  }

  /// Whose seat this client believes it is, in a line's words.
  private func seatWords(_ holder: RoutedGeometryHolder?) -> String {
    guard let holder else { return "the seat is empty" }
    guard let ticket, holder.isClaimant(clientId: ticket.clientId, viewId: options.viewId) else {
      return "another view holds the seat"
    }
    return "this view holds the seat"
  }

  private func sendTransfer(
    sessionId: String, from holder: RoutedGeometryHolder, grid: Grid, revision: Int64,
    retried: Bool
  ) {
    guard let session = sessions[sessionId], let ticket, let control else { return }
    geometryAsks.append(
      GeometryAsk(
        sessionId: sessionId, intent: .take,
        basis: SeatBelief(holder: holder, revision: revision), grid: grid, retried: retried))
    control.send(
      .transferGeometry,
      [
        "sessionId": .string(sessionId),
        "activationId": .string(session.activationId),
        "leaseEpoch": .int(leaseEpoch(for: sessionId)),
        "from": holder.json,
        "to": .object(["clientId": .string(ticket.clientId), "viewId": .string(options.viewId)]),
        "expectRevision": .int(revision),
        "cols": .int(Int64(grid.cols)),
        "rows": .int(Int64(grid.rows)),
      ])
    options.log(
      "seat take from another view \(grid.cols)×\(grid.rows) at r\(revision)"
        + "\(retried ? ", the one retry" : "") session=\(sessionId)")
  }

  /// The one retry of a refused take, against what the refusal ANNOUNCED.
  ///
  /// None when the refusal names no seat at all (no revision: `RIGHT_MISSING`,
  /// a malformed caller), and none when it repeats exactly the seat the take
  /// was built on — a resend would be refused the same way. Otherwise: the
  /// announced holder is another view → one transfer from it; the seat is
  /// empty (a revision and no holder) → one claim at that revision; the
  /// announced holder is THIS view → one claim of its own seat (a resize),
  /// never a transfer to itself. The retry is never retried.
  private func retryTake(_ ask: GeometryAsk, after refusal: RoutedGeometryRefused) {
    guard let revision = refusal.geometryRevision else { return }
    guard SeatBelief(holder: refusal.currentHolder, revision: revision) != ask.basis else { return }
    guard let session = sessions[ask.sessionId], session.control == .attached,
      session.rights.contains(.geometry), let ticket
    else { return }
    let grid = wantedGrids[ask.sessionId] ?? ask.grid
    if let holder = refusal.currentHolder,
      !holder.isClaimant(clientId: ticket.clientId, viewId: options.viewId)
    {
      sendTransfer(
        sessionId: ask.sessionId, from: holder, grid: grid, revision: revision, retried: true)
    } else {
      sendClaim(
        sessionId: ask.sessionId, grid: grid, revision: revision, intent: .take, retried: true)
    }
  }

  /// The session an unsolicited geometry answer belongs to: the one attached
  /// session, or none (an answer this client cannot place is not applied to
  /// every session it holds).
  private var soleAttachedSession: String? {
    let attached = sessions.filter { $0.value.control == .attached }.map(\.key)
    return attached.count == 1 ? attached[0] : nil
  }

  /// The holder yields the seat. NOT matched in send order: the cell answers a
  /// successful release with nothing and a refused one with `GeometryRefused`,
  /// so a release in flight would desynchronize the take's answers (ghosttea
  /// fenced the same hazard). Nothing on the phone sends one — a view that
  /// detaches releases the seat cell-side — and a caller that adds one must
  /// fence the asks first.
  public func releaseGeometry(for sessionId: String, holderGeneration: Int64) {
    guard let session = sessions[sessionId], let ticket else { return }
    control?.send(
      .releaseGeometry,
      [
        "sessionId": .string(sessionId),
        "activationId": .string(session.activationId),
        "leaseEpoch": .int(leaseEpoch(for: sessionId)),
        "holder": .object([
          "clientId": .string(ticket.clientId), "viewId": .string(options.viewId),
          "holderGeneration": .int(holderGeneration),
        ]),
      ])
  }

  // MARK: Dialing

  private func dial(_ ticket: RoutedTerminalTicket) {
    teardownLegs()
    generation += 1
    state = .connecting
    let token = generation
    guard let ledger = options.legBudget else {
      openLegs(ticket, token: token)
      return
    }
    // SP-2 (g) — a connection SET is two legs, and a dial beyond the phone's
    // leg budget WAITS for a slot: a second attachment's legs open only once
    // the first's are torn down.
    //
    // fix8 — and waits no longer than a step may (`AttachStep.slot`): a slot
    // nobody gives back is torn down by the deadline, which cancels this wait.
    let log = options.log
    log(
      "slot asked — \(ledger.inUse(.terminalLegs)) of \(ledger.limit(.terminalLegs)) legs in use, "
        + "\(ledger.waiting(for: .terminalLegs)) waiting")
    let asked = ContinuousClock.now
    legGrantTask = Task { [weak self] in
      let legs = RoutedChannel.allCases.count
      guard let grant = try? await ledger.acquire(.terminalLegs, count: legs) else { return }
      // A free ledger answers without suspending, so a teardown that cancelled
      // this task before it first ran is noticed here rather than not at all —
      // without it, legs torn down by a refusal were opened anyway.
      guard let self, token == self.generation, !self.closed, !Task.isCancelled else {
        ledger.release(grant)
        return
      }
      self.legGrantTask = nil
      self.legGrant = grant
      log("slot granted after \(URLSessionRoutedTransport.milliseconds(since: asked)) ms")
      self.openLegs(ticket, token: token)
      self.reconcileStep()
    }
  }

  private func openLegs(_ ticket: RoutedTerminalTicket, token: Int) {
    let hello = { (channel: RoutedChannel) -> JSONValue in
      var body: [String: JSONValue] = [
        "protocolMajor": .int(Int64(RoutedTerminalContract.protocolMajor)),
        "protocolMinor": .int(Int64(RoutedTerminalContract.protocolMinor)),
        "channel": .string(channel.rawValue),
        "transportGrant": ticket.transportGrant.raw,
        "capabilities": .array(RoutedTerminalContract.capabilities.map(JSONValue.string)),
      ]
      if channel == .frames {
        // Receive capacity belongs to the RECEIVER: the cell accepts the minimum
        // of this and its own caps, so these numbers are a memory promise this
        // process keeps (see `RoutedReceiverCapacities.phone`).
        let capacities = self.options.capacities
        body["receiverCapacities"] = .object([
          "connectionCreditBytes": .int(Int64(capacities.connectionCreditBytes)),
          "perActivationCreditBytes": .int(Int64(capacities.perActivationCreditBytes)),
          "stagingBytesPerSession": .int(Int64(capacities.stagingBytesPerSession)),
          "stagingBytesTotal": .int(Int64(capacities.stagingBytesTotal)),
          "maxConcurrentActivations": .int(Int64(capacities.maxConcurrentActivations)),
          "maxConcurrentSeeds": .int(Int64(capacities.maxConcurrentSeeds)),
        ])
      }
      return .object(body)
    }

    control = RoutedLeg(
      channel: .control, url: ticket.endpoints.controlUrl, transport: transport,
      callbacks: callbacks(for: .control, token: token), log: options.log)
    frames = RoutedLeg(
      channel: .frames, url: ticket.endpoints.framesUrl, transport: transport,
      callbacks: callbacks(for: .frames, token: token), log: options.log)
    control?.open(hello: hello(.control))
    frames?.open(hello: hello(.frames))
  }

  private func callbacks(for channel: RoutedChannel, token: Int) -> RoutedLeg.Callbacks {
    var callbacks = RoutedLeg.Callbacks()
    // fix8 — every word from a leg can move the attach a step, so each one is
    // followed by `reconcileStep`.
    callbacks.onAccepted = { [weak self] accepted in
      guard let self, token == self.generation else { return }
      self.accepted(accepted, on: channel)
      self.reconcileStep()
    }
    callbacks.onRefused = { [weak self] refusal in
      guard let self, token == self.generation else { return }
      self.refused(refusal)
      self.reconcileStep()
    }
    callbacks.onFailed = { [weak self] failure in
      guard let self, token == self.generation else { return }
      self.legFailed(failure, on: channel)
      self.reconcileStep()
    }
    callbacks.onText = { [weak self] type, body in
      guard let self, token == self.generation else { return }
      self.handle(type, body)
      self.reconcileStep()
    }
    callbacks.onBinary = { [weak self] data in
      guard let self, token == self.generation else { return }
      self.handle(unit: data)
      self.reconcileStep()
    }
    return callbacks
  }

  private func accepted(_ accepted: RoutedConnectionAccepted, on channel: RoutedChannel) {
    switch channel {
    case .control: controlAccepted = accepted
    case .frames:
      framesAccepted = accepted
      limits = accepted.limits
      // The cell's rule: the credit epoch IS the frames leg generation, so a
      // replaced leg always opens a new one and every total resets with it.
      ledger.reset(creditEpoch: accepted.creditEpoch ?? accepted.legGeneration, nowMs: Self.nowMs())
    }
    guard let control = controlAccepted, let frames = framesAccepted else { return }
    // The intersection is the CELL's answer, and the two legs may differ (only
    // a control leg negotiates `session-events`), so both are reported.
    negotiatedCapabilities = Array(Set(control.capabilities).union(frames.capabilities)).sorted()
    preAuthRetried = false
    state = .attached == state ? .attached : .ready
    startCreditPump()
    for sessionId in grants.keys { attach(sessionId: sessionId) }
  }

  // MARK: Activation

  /// Attach ONE session on BOTH legs under one activation id.
  ///
  /// The CLIENT is the activation authority: it mints the id (fresh and
  /// non-reused per attempt), names the activation it replaces, and reconciles
  /// both legs' acknowledgements. The cell holds the table and ANSWERS it — it
  /// never invents an activation id — which is what makes a reconnect race
  /// impossible to disagree about: only one side decides.
  private func attach(sessionId: String) {
    guard let grant = grants[sessionId], let control, frames != nil else { return }
    let previous = sessions[sessionId]
    if let previous, previous.control == .attached, previous.frames == .active { return }
    let activationId = "act-\(UUID().uuidString.lowercased())"
    var session = RoutedSessionState(sessionId: sessionId, activationId: activationId)
    session.rights = grant.rights ?? []
    session.nowMs = Self.nowMs()
    session.inputRightDeadlineMs = Self.inputRightDeadline(for: grant)
    session.resumeToken = previous?.resumeToken
    session.appliedContent = previous?.appliedContent
    // The run's exit is the SESSION's, not the activation's, and the cell says
    // it once: a fresh activation of an exited run is still one.
    session.exit = previous?.exit
    // item 42 — so is the seat; the cell says it again on this attach, and the
    // last one heard stands until it does.
    session.seat = previous?.seat
    sessions[sessionId] = session

    var controlBody: [String: JSONValue] = [
      "activationId": .string(activationId),
      "attachGrant": grant.raw,
      "initialDemand": .object(["mode": .string(session.demand.rawValue)]),
    ]
    if let replaced = previous?.activationId {
      controlBody["replacesActivationId"] = .string(replaced)
    }
    control.send(.attachControlLeg, controlBody)
    // The control acknowledgement proves the cell has created this activation.
    // Sending frames now races that creation on the other socket (Phase 0).
  }

  private func attachFrames(sessionId: String) {
    guard var session = sessions[sessionId], session.control == .attached,
      !session.framesAttachSent, let grant = grants[sessionId], let frames
    else { return }
    // Duplicate control acknowledgements and renewals must not reattach frames.
    session.framesAttachSent = true
    sessions[sessionId] = session
    var framesBody: [String: JSONValue] = [
      "activationId": .string(session.activationId),
      "attachGrant": grant.raw,
    ]
    // `resume` is a CAPABILITY: the token and the client's ACTUAL applied stamp
    // (which may be ahead of the cell's last SceneApplied — acks in flight when
    // the leg died) are sent only when the cell negotiated it.
    if negotiatedCapabilities.contains(RoutedTerminalContract.resumeCapability),
      let token = session.resumeToken, let from = session.appliedContent
    {
      framesBody["resume"] = .object(["resumeToken": .string(token), "from": from.json])
    }
    frames.send(.attachFramesLeg, framesBody)
  }

  /// The SET is `attached` while any session has both legs attached. One place
  /// decides it by reconciling both leg states. Phase 0 ordering correction:
  /// frames is sent only after control is acknowledged; subsequent control
  /// acknowledgements can still arrive independently when the grant renews.
  private func noteAttachment() {
    guard state == .ready || state == .attached else { return }
    state = sessions.values.contains(where: \.bothLegsAttached) ? .attached : .ready
  }

  private func handle(_ type: RoutedMessageType, _ body: JSONValue) {
    switch type {
    case .controlLegAttached:
      guard let attached = try? RoutedControlLegAttached(json: body) else { return }
      guard var session = sessions[attached.sessionId],
        session.activationId == attached.activationId
      else { return }
      if session.control != .attached {
        options.log("control acknowledged session=\(attached.sessionId)")
      }
      session.control = .attached
      // A rights DOWNGRADE applies the moment the cell accepts the newer
      // generation — the accepted rights are the cell's answer, never the ones
      // the grant asked for.
      session.rights = attached.rights
      sessions[attached.sessionId] = session
      attachFrames(sessionId: attached.sessionId)
      noteAttachment()
      // P0-C — the grant this activation now rides is the one to renew. Both an
      // attach and an accepted renewal land here, and scheduling is idempotent:
      // it replaces whatever was scheduled with the grant actually held.
      scheduleRenewal(for: attached.sessionId)
      // DS-4b — a take that waited for this leg goes now, with the newest grid.
      if let held = pendingTakes[attached.sessionId] {
        takeGeometry(cols: held.cols, rows: held.rows, for: attached.sessionId)
      }

    case .attachRefused:
      guard let refused = try? RoutedAttachRefused(json: body) else { return }
      let sessionId = sessions.first {
        refused.activationId == nil || $0.value.activationId == refused.activationId
      }?.key
      guard let sessionId, var session = sessions[sessionId] else { return }
      session.control = .refused(code: refused.code, retryable: refused.retryable)
      session.lastRefusal = refused.code
      sessions[sessionId] = session
      lastRefusal = refused.code
      if refused.code == "STALE_ROUTE" {
        requestFreshTicket(for: sessionId, because: .staleRoute)
      } else if refused.code == "GRANT_INVALID" || refused.code == "GRANT_GENERATION_ROLLBACK" {
        // Every grant code is TERMINAL for that grant: a retry with the same one
        // can never succeed, so the only move is a fresh mint. But an attach
        // refusal is one message on a LIVE leg, and the legs are fine — P0-C:
        // this used to go through `requestFreshTicket`, whose `.reconnecting`
        // left `open` no branch that attaches over live legs, so the fresh grant
        // was stored, never used, and the card read "connecting…" for good.
        reattach(sessionId: sessionId)
      }
      // Any other refusal is THIS session's answer, and stays on it: the set's
      // state is every session's on these legs, and setting it here painted
      // one card's refusal on every card of the lane — and left `open` no
      // branch that attaches, so RETRY minted a grant and used none (P5).

    case .framesLegAttached:
      guard let attached = try? RoutedFramesLegAttached(json: body) else { return }
      guard var session = sessions[attached.sessionId],
        session.activationId == attached.activationId
      else { return }
      // The identity rule's checkable half: the declared pair is bound to this
      // activation, and no two LIVE activations of this set may claim the same
      // session handle — two identities must never route to two replicas.
      let collision = sessions.first {
        $0.key != attached.sessionId
          && $0.value.identity?.sessionHandle == attached.trfIdentity.sessionHandle
      }
      if collision != nil {
        fail("two activations declared the TRF1 handle \(attached.trfIdentity.sessionHandle)")
        return
      }
      if let held = session.identity, held != attached.trfIdentity {
        fail("an activation re-declared a different TRF1 identity")
        return
      }
      session.identity = attached.trfIdentity
      session.resumeToken = attached.resumeToken
      switch attached.outcome {
      case .resumeAccepted: options.log("frames acknowledged session=\(attached.sessionId), resuming")
      case .seedRequired(let reason):
        options.log("frames acknowledged session=\(attached.sessionId), seeding (\(reason))")
      }
      switch attached.outcome {
      case .resumeAccepted(let from, _):
        session.frames = .resuming
        session.appliedContent = from
      case .seedRequired(let reason):
        session.frames = .seeding
        session.lastSeedReason = reason
        // A new lineage has no base: whatever this client held is not a base for
        // what is coming, and pretending otherwise would apply a delta onto the
        // wrong scene.
        session.appliedContent = nil
      }
      sessions[attached.sessionId] = session
      let identity = attached.trfIdentity
      let sessionId = attached.sessionId
      let activationId = attached.activationId
      // D1 — on the session's apply chain, so the binding is in place before the
      // seed that follows it is handed over (two loose tasks promised no order)
      enqueueApply(sessionId: sessionId) { [sink] in
        await sink.bindActivation(session: sessionId, activation: activationId, identity: identity)
      }
      noteAttachment()

    case .cellActivationStatus:
      guard let status = try? RoutedActivationStatus(json: body) else { return }
      guard var session = sessions[status.sessionId],
        session.activationId == status.activationId
      else { return }
      // Sequences are per-namespace and monotonic; an older one is a reorder and
      // is dropped rather than applied backwards.
      if let held = session.status, status.cellStatusSequence < held.cellStatusSequence { return }
      if session.status?.presentation != status.presentation || session.status?.input != status.input {
        options.log(
          "the cell: presentation \(status.presentation), input \(status.input) "
            + "session=\(status.sessionId)")
      }
      session.status = status
      session.nowMs = Self.nowMs()
      // `leaseTtlMs` is the CELL's number and reached a bare `+` here, so a cell
      // announcing a TTL near `Int64.max` crashed the app (TM-r3, K-M3). A
      // deadline that cannot be represented saturates instead: `leaseLive` is
      // only ever a comparison, and the honest reading of "further away than a
      // clock can say" is the furthest one it CAN say.
      session.leaseDeadlineMs = Self.deadline(from: session.nowMs, after: status.leaseTtlMs)
      if case .revoked(let reason) = status.presentation {
        endActivation(&session, reason: reason)
        if Self.lapsedAttach(reason) {
          // P0-C — the ATTACH lapsed, not the session: the cell revokes an
          // activation whose attach grant expired (`right-revoked`) or whose
          // attach missed its deadline, and the PTY behind it is running. This
          // used to read `.ended`, and the card said "this session ended" over a
          // live session with nothing to offer but the way back to the field.
          session.control = .attaching
          session.frames = .attaching
          session.lastRefusal = reason
          sessions[status.sessionId] = session
          noteAttachment()
          reattach(sessionId: status.sessionId)
          return
        }
        if Self.lostLeg(reason) {
          // B3 — the cell saw a leg of this activation die, and closed it: the
          // set re-dials when this side sees the close (`legFailed`), and the
          // new legs attach every session they carry. The session is the same
          // one, and re-attaching here, on the legs being replaced, would only
          // race that.
          session.lastRefusal = reason
          sessions[status.sessionId] = session
          noteAttachment()
          return
        }
        session.control = .ended(reason: reason)
        session.frames = .failed(reason)
        sessions[status.sessionId] = session
        noteAttachment()
      }
      sessions[status.sessionId] = session

    case .demandAccepted:
      break

    case .geometryCommitted:
      guard let committed = try? RoutedGeometryCommitted(json: body) else { return }
      // DS-4b — the answer to the OLDEST verb in flight (send order is answer
      // order on this leg). The seat it names is now the belief.
      let ask = geometryAsks.isEmpty ? nil : geometryAsks.removeFirst()
      guard let sessionId = ask?.sessionId ?? soleAttachedSession,
        var session = sessions[sessionId]
      else { return }
      session.geometryRevision = committed.geometryRevision
      session.geometryHolder = committed.holder
      sessions[sessionId] = session
      options.log(
        "seat committed \(committed.cols)×\(committed.rows) r\(committed.geometryRevision) — "
          + "\(seatWords(committed.holder)) session=\(sessionId)")
      // The pane's grid moved while the verb was in flight: ONE resize of the
      // seat this view now holds carries the newest grid.
      if holdsGeometry(sessionId), let wanted = wantedGrids[sessionId],
        wanted != Grid(cols: committed.cols, rows: committed.rows),
        !geometryAsks.contains(where: { $0.sessionId == sessionId })
      {
        sendClaim(
          sessionId: sessionId, grid: wanted, revision: committed.geometryRevision, intent: .resize,
          retried: false)
      }

    case .geometryRefused:
      guard let refused = try? RoutedGeometryRefused(json: body) else { return }
      lastRefusal = refused.code
      let ask = geometryAsks.isEmpty ? nil : geometryAsks.removeFirst()
      options.log(
        "seat refused \(refused.code)"
          + (refused.geometryRevision.map { " r\($0) — \(seatWords(refused.currentHolder))" }
            ?? " — no seat named")
          + " session=\(ask?.sessionId ?? soleAttachedSession ?? "-")")
      // THE REFUSAL IS THE ANNOUNCEMENT: a revision says where the seat is now,
      // and its holder (or none: the seat is empty) is the belief from here.
      // A refusal naming no revision says nothing about the seat.
      if let revision = refused.geometryRevision,
        let sessionId = ask?.sessionId ?? soleAttachedSession, var session = sessions[sessionId]
      {
        session.geometryRevision = revision
        session.geometryHolder = refused.currentHolder
        sessions[sessionId] = session
      }
      if let ask, ask.intent == .take, !ask.retried { retryTake(ask, after: refused) }

    case .geometryState:
      // item 42 — the seat as the cell now says it is, told to every leg with
      // an activation of the session: kept on the session it names, with
      // whether its holder is this client, under the receiver's rule
      // (`RoutedSessionSeat.fold`). A state this build cannot read is dropped
      // and SAID — the cell and this build disagreeing about a shape both name
      // is news, as the desktop logs it — by its field, never a value, and the
      // leg stays.
      let announced: RoutedGeometryState
      do {
        announced = try RoutedGeometryState(json: body)
      } catch {
        options.log.error("seat: a GeometryState this build cannot read was dropped — \(error)")
        return
      }
      let sessionId = announced.sessionId
      guard var session = sessions[sessionId] else { return }
      let mine =
        announced.holder.map { ownClients[sessionId, default: []].contains($0.clientId) } ?? false
      let seat = RoutedSessionSeat.fold(session.seat, announced, mine: mine)
      // A stale state, and an identical repeat (the announcement on an attach
      // of a seat already known), change nothing.
      guard seat != session.seat else { return }
      session.seat = seat
      sessions[sessionId] = session
      options.log("seat announced — \(seat) session=\(sessionId)")

    case .sessionEvent:
      // Each event lands on the session it names, as the cell's own fact, never
      // invented. They once went to a queue for "the caller" to drain, and no
      // caller ever did: a run that exited read live and took keys into nothing
      // (the audit's P8, 2026-10-17).
      guard let event = try? RoutedSessionEvent(json: body) else { return }
      switch event {
      case .exited(let sessionId, let code, let signal, let requested, let outcome):
        guard var session = sessions[sessionId] else { return }
        session.exit = RoutedSessionExit(
          code: code, signal: signal, requestedTermination: requested, outcome: outcome)
        sessions[sessionId] = session
        options.log(
          "session exited — \(outcome)" + (code.map { " code \($0)" } ?? "")
            + (signal.map { " signal \($0)" } ?? "") + " session=\(sessionId)")
        noteAttachment()
      case .removed(let sessionId):
        guard var session = sessions[sessionId] else { return }
        session.control = .ended(reason: "removed")
        endActivation(&session, reason: "removed")
        // item 42 — nothing drives a session that is gone.
        session.seat = nil
        sessions[sessionId] = session
        noteAttachment()
      case .resync:
        // The cell's deltas dropped; this client holds no inventory of its own
        // to reconcile (the field's roster is the phone's), so it is said.
        options.log("session events: the cell's own deltas dropped (resync)")
      case .unknown(let kind):
        // Tolerant reader: additive kinds behind the same capability.
        options.log("session events: unknown kind \(kind) dropped")
      }

    default:
      break
    }
  }

  // MARK: Frames

  private func handle(unit data: Data) {
    let envelope: RoutedEnvelope
    do {
      envelope = try RoutedPresentationEnvelope.decode(data)
    } catch {
      // A unit this client cannot even frame is a PROTOCOL error. Its bytes
      // cannot be returned to an account, because the envelope that would have
      // named one is the thing that failed to parse — so the leg goes, and the
      // whole epoch's ledger with it.
      fail("a presentation unit would not decode: \(String(describing: error))")
      return
    }
    let header = envelope.header
    let now = Self.nowMs()

    // Law (1) FIRST, before any decision about the content: every received unit
    // returns its charge exactly once, to the connection total and to the
    // account its envelope named, even when the activation is stale or unknown
    // and the content is discarded.
    ledger.charge(bytes: envelope.chargedBytes, activationId: header.activationId, nowMs: now)

    guard header.creditEpoch == ledger.creditEpoch else {
      // A unit stamped with another epoch cannot be accounted for on this leg.
      fail("a presentation unit carried credit epoch \(header.creditEpoch)")
      return
    }
    if header.kind == .calibration { return }

    guard var session = sessions[header.sessionId],
      session.activationId == header.activationId
    else {
      // A stale or unknown activation: charged above, content discarded. This is
      // the normal cost of a replacement, not an error.
      return
    }
    if header.activationSequence <= session.activationSequence {
      // Per-activation monotonic — a correctness check on an ordered socket. A
      // unit behind a later one of its activation means the cell broke that
      // order, and dropping it can leave the scene waiting on a base it will
      // never hold: said, never silent (2026-10-17 — a catch-up overtaken by a
      // delta was dropped here without a trace, and the phone's scene froze).
      options.log(
        "frames: unit #\(header.activationSequence) (\(header.kind)) dropped — "
          + "#\(session.activationSequence) of its activation arrived first "
          + "session=\(header.sessionId)")
      return
    }
    session.activationSequence = header.activationSequence

    switch header.kind {
    case .trf1Frame:
      apply(frame: envelope, header: header, session: &session)
    case .transferBegin:
      do {
        let transfer = try RoutedTransfer(
          header: header, budgetBytes: options.capacities.stagingBytesPerSession)
        session.transfer = transfer
        options.log(
          "frames: a \(transfer.kind) of \(transfer.totalBytes) bytes begins, "
            + "\(transfer.baseContent.map { "on \($0)" } ?? "on nothing") to \(transfer.resultContent) "
            + "session=\(header.sessionId)")
      } catch {
        session.frames = .failed(String(describing: error))
        session.lastRefusal = String(describing: error)
        options.log("frames: a transfer refused at its start — \(error) session=\(header.sessionId)")
      }
    case .transferChunk:
      guard var transfer = session.transfer,
        transfer.transferId == header.transfer?.transferId
      else {
        options.log("frames: a chunk for no transfer in flight session=\(header.sessionId)")
        break
      }
      do {
        try transfer.stage(header, payload: envelope.payload)
        session.transfer = transfer
      } catch {
        session.transfer = nil
        session.frames = .failed(String(describing: error))
        session.lastRefusal = String(describing: error)
        options.log("frames: a transfer chunk refused — \(error) session=\(header.sessionId)")
      }
    case .transferEnd:
      guard let transfer = session.transfer, transfer.transferId == header.transfer?.transferId
      else {
        options.log("frames: a transfer end for no transfer in flight session=\(header.sessionId)")
        break
      }
      session.transfer = nil
      do {
        let bytes = try transfer.finish()
        let content = transfer.resultContent
        let kind = transfer.kind
        let sessionId = session.sessionId
        let activationId = session.activationId
        // NOT `appliedContent = content; frames = .active` here. The sink has
        // not seen these bytes yet and may refuse them, and a client that
        // stamped the scene first would report `SceneApplied` for a frame the
        // glass never took — which is the cell's own signal to STOP seeding.
        // `.applying` is the honest state for the gap: the frame is on its way
        // to the sink, `PresentationReady` is false, and the stamp is set on
        // the far side of the await or not at all.
        session.frames = .applying
        let sink = self.sink
        enqueueApply(sessionId: sessionId) { [weak self] in
          let applied = await sink.applyFullFrame(
            bytes, session: sessionId, activation: activationId, content: content)
          guard let self else { return }
          if applied {
            self.options.log("frames: the \(kind) to \(content) is on the glass session=\(sessionId)")
            self.frameApplied(
              sessionId: sessionId, activationId: activationId, content: content)
          } else {
            // A full frame IS the repair. One the sink will not take leaves
            // nothing to fall back to, so it is counted rather than asked for
            // again forever.
            self.repairRefused(sessionId: sessionId, activationId: activationId)
          }
          // fix8 — the frame landed a hop after its unit: the attach's step
          // moves here (the first frame), not at the unit
          self.reconcileStep()
        }
      } catch {
        session.frames = .failed(String(describing: error))
        session.lastRefusal = String(describing: error)
        options.log("frames: a transfer would not finish — \(error) session=\(header.sessionId)")
      }
    case .calibration:
      break
    }
    sessions[header.sessionId] = session
  }

  private func apply(
    frame envelope: RoutedEnvelope, header: RoutedEnvelopeHeader, session: inout RoutedSessionState
  ) {
    guard let result = header.resultContent else { return }
    let payload = Data(envelope.payload)
    let sessionId = session.sessionId
    let activationId = session.activationId
    let base = header.baseContent
    // The stamp is `frameApplied`'s to write, on the far side of the await and
    // only if the sink took the frame — the same rule the transfer path keeps.
    // Claiming it here first was harmless while every refusal routed to
    // `lineageBroke` (which cleared it again), and is not harmless now that a
    // refused SELF-CONTAINED frame can end in the bound below: the client would
    // be carrying a scene the glass never held into whatever came next.
    session.frames = .applying
    let sink = self.sink
    enqueueApply(sessionId: sessionId) { [weak self] in
      let applied = await sink.applyDeltaFrame(
        payload, session: sessionId, activation: activationId, base: base, result: result)
      guard let self else { return }
      if applied {
        self.frameApplied(sessionId: sessionId, activationId: activationId, content: result)
      } else if base == nil {
        // A frame with NO base is self-contained: it is the repair, not a
        // step onto one. Refusing it is the same answer a refused transfer
        // gives and is counted the same way.
        self.repairRefused(sessionId: sessionId, activationId: activationId)
      } else {
        // The sink holds a scene this delta does not describe. The honest
        // repair is a reseed, and the cell's own trigger for one is a
        // `SceneApplied` that does not advance — so this client says nothing it
        // cannot back up and marks the lineage broken instead.
        self.lineageBroke(sessionId: sessionId, activationId: activationId)
      }
      // fix8 — the frame landed a hop after its unit: the attach's step moves
      // here (the first frame), not at the unit
      self.reconcileStep()
    }
  }

  /// D1 (the second audit, 2026-10-16) — frames reach the sink ONE AT A TIME per
  /// session, in the order their units arrived. Each frame used to start its own
  /// unstructured `Task`, and two tasks started back to back carry no promise to
  /// run in that order: a delta that overtook its base was a lineage break the
  /// cell then had to reseed. A session's next apply now waits on the one before
  /// it; a stale activation's queued frames are still dropped where they land
  /// (`frameApplied`, the sink's binding).
  private func enqueueApply(
    sessionId: String, _ apply: @escaping @MainActor () async -> Void
  ) {
    let previous = applyTails[sessionId]
    applyTails[sessionId] = Task { @MainActor in
      await previous?.value
      await apply()
    }
  }

  /// The sink took the frame. Only now is the scene this client's to claim.
  private func frameApplied(
    sessionId: String, activationId: String, content: RoutedSceneStamp
  ) {
    guard var session = sessions[sessionId], session.activationId == activationId else { return }
    session.appliedContent = content
    session.frames = .active
    // The bound below counts CONSECUTIVE refusals, so an applied frame clears
    // it: a sink that can show this scene is not a build that cannot show any.
    session.refusedRepairs = 0
    sessions[sessionId] = session
    reportApplied(sessionId: sessionId, activationId: activationId, content: content)
  }

  /// Progress, in stamps. Sent on change AND repeated at least every
  /// `sceneAppliedRefreshMs` while idle — a quiet terminal must not lose
  /// readiness for want of a new revision. It is NOT credit: credit says bytes
  /// left the wire, this says a scene advanced, and conflating them is how a
  /// stalled viewer gets starved or a busy one gets called ready.
  private func reportApplied(sessionId: String, activationId: String, content: RoutedSceneStamp) {
    guard let session = sessions[sessionId], session.activationId == activationId else { return }
    frames?.send(
      .sceneApplied,
      [
        "sessionId": .string(sessionId),
        "activationId": .string(activationId),
        "leaseEpoch": .int(leaseEpoch(for: sessionId)),
        "appliedContent": content.json,
      ])
  }

  private func lineageBroke(sessionId: String, activationId: String) {
    guard var session = sessions[sessionId], session.activationId == activationId else { return }
    let reason = "the sink holds a different scene"
    let already = session.appliedContent == nil && session.lastSeedReason == reason
    session.appliedContent = nil
    session.frames = .seeding
    session.lastSeedReason = reason
    sessions[sessionId] = session
    if !already {
      options.log("frames: a delta did not fit the scene held — input waits for a seed session=\(sessionId)")
    }
  }

  /// An AUTHORITATIVE scene the sink refused — a completed transfer, or a
  /// self-contained frame with no base. Both are the repair a lineage break
  /// asks for, so there is nothing further to fall back to.
  ///
  /// The repair is asked for again the same way a lineage break asks for it
  /// (drop the applied stamp; the cell's own trigger for a seed is a
  /// `SceneApplied` that does not advance) — but only up to a BOUND, because
  /// the state this exists to prevent is a phone that asks for a scene it can
  /// never show and a cell that keeps sending one. A build whose TRF1 reader
  /// cannot parse what this cell renders would otherwise sit in that loop
  /// behind a blank pane, spending the desktop's credit forever.
  ///
  /// Past the bound the client FAILS with a sentence naming the real thing.
  /// Failing rather than idling is deliberate: the legs go with it, so the loop
  /// stops costing the cell, and `.failed` is the one resting state that
  /// reaches the card with a retry beside it. A retry re-attaches under a fresh
  /// activation, which is the only move that could change the answer.
  private func repairRefused(sessionId: String, activationId: String) {
    guard var session = sessions[sessionId], session.activationId == activationId else { return }
    session.refusedRepairs += 1
    let refusals = session.refusedRepairs
    session.appliedContent = nil
    options.log(
      "frames: the sink refused a whole scene (\(refusals) of \(Self.maxRefusedRepairs)) "
        + "session=\(sessionId)")
    if refusals < Self.maxRefusedRepairs {
      session.frames = .seeding
      session.lastSeedReason = "the sink would not take the scene the cell sent"
      sessions[sessionId] = session
      return
    }
    let reason =
      "this desktop's frames cannot be shown on this build "
      + "— \(refusals) authoritative scenes in a row were refused"
    session.frames = .failed(reason)
    session.lastRefusal = reason
    sessions[sessionId] = session
    fail(reason)
  }

  // MARK: Credit and the idle refresh

  /// One pump for two cadences that must both keep running while nothing else
  /// does: the credit return (batched under the cell's `maxCreditReturnDelayMs`)
  /// and the idle `SceneApplied` refresh.
  private func startCreditPump() {
    pumps.forEach { $0.cancel() }
    pumps = []
    let token = generation
    pumps.append(
      Task { [weak self] in
        while !Task.isCancelled {
          try? await Task.sleep(for: .milliseconds(8))
          guard let self, token == self.generation else { return }
          self.flushCredit()
        }
      })
    pumps.append(
      Task { [weak self] in
        while !Task.isCancelled {
          guard let self, token == self.generation else { return }
          let refresh = max(200, self.limits.sceneAppliedRefreshMs / 2)
          try? await Task.sleep(for: .milliseconds(refresh))
          guard token == self.generation else { return }
          self.refreshApplied()
        }
      })
  }

  private func flushCredit() {
    let now = Self.nowMs()
    ledger.prune(nowMs: now, drainTtlMs: limits.creditAccountDrainTtlMs)
    let threshold = max(1, options.capacities.perActivationCreditBytes / 4)
    guard
      ledger.owesReturn(
        nowMs: now, maxDelayMs: limits.maxCreditReturnDelayMs, thresholdBytes: threshold)
    else { return }
    frames?.send(.transportCredit, ledger.makeReturn(nowMs: now).objectValue ?? [:])
  }

  private func refreshApplied() {
    for (sessionId, var session) in sessions {
      session.nowMs = Self.nowMs()
      sessions[sessionId] = session
      guard session.frames == .active, let content = session.appliedContent else { continue }
      reportApplied(
        sessionId: sessionId, activationId: session.activationId, content: content)
    }
  }

  // MARK: Failure

  private func refused(_ refusal: RoutedConnectionRefused) {
    lastRefusal = refusal.code
    state = .refused(code: refusal.code)
    // Every grant code is terminal for that grant; a fresh mint is the only
    // move, and only the caller can make it.
    needsTicket = true
    teardownLegs()
    if refusal.retryable, let sessionId = reticketSession {
      requestFreshTicket(for: sessionId, because: .refused(code: refusal.code))
    }
  }

  /// Which session a fresh ticket for the SET is minted through: the last
  /// ticket's, while this client still carries it, else any it carries — a
  /// session let go (`forget`) is never minted back onto the legs.
  private var reticketSession: String? {
    if let named = ticket?.sessionId, sessions[named] != nil { return named }
    return sessions.keys.sorted().first ?? ticket?.sessionId.flatMap { grants[$0] == nil ? nil : $0 }
  }

  private func legFailed(_ failure: RoutedLegFailure, on channel: RoutedChannel) {
    lastRefusal = failure.description
    // Losing or replacing ONE leg invalidates every activation on the SET: the
    // other leg's activations are no longer two-legged, so they are not
    // activations. The cell already made this decision on its side.
    for (sessionId, var session) in sessions {
      endActivation(&session, reason: "leg-dead")
      session.lastRefusal = failure.description
      sessions[sessionId] = session
    }
    teardownLegs()

    guard let sessionId = reticketSession else {
      state = .failed(reason: failure.description)
      return
    }
    switch failure {
    case .preAuthenticationRefused:
      // "Re-mint once, then UNAVAILABLE." The count is kept here because nothing
      // else can: the close carried no code and no body by policy, so a second
      // identical silence is the only evidence that re-minting does not help.
      if preAuthRetried {
        state = .failed(reason: "UNAVAILABLE: the cell refused two freshly minted grants")
        needsTicket = false
        return
      }
      preAuthRetried = true
      requestFreshTicket(for: sessionId, because: .reconnecting)
    case .closed(let code, _) where code == RoutedTerminalContract.CloseCode.staleRoute:
      requestFreshTicket(for: sessionId, because: .staleRoute)
    case .protocolViolation(let reason):
      state = .failed(reason: reason)
    case .closed, .dropped:
      requestFreshTicket(for: sessionId, because: .reconnecting)
    }
    _ = channel
  }

  private enum TicketReason {
    case reconnecting
    case staleRoute
    case refused(code: String)
  }

  /// Ask for a fresh ticket — from the provider when there is one, from the
  /// caller otherwise.
  ///
  /// There is no socket-level retry here on purpose. A transport grant's
  /// `(nonce, channel)` is CONSUMED at first use and held until the grant
  /// expires, so re-dialing a leg with the ticket in hand earns
  /// `GRANT_NONCE_REPLAYED` — terminal for that grant. Every leg replacement is
  /// a fresh mint, and a client that retried the socket instead would spin
  /// against a refusal that can never become an acceptance.
  private func requestFreshTicket(for sessionId: String, because reason: TicketReason) {
    switch reason {
    case .reconnecting: state = .reconnecting
    case .staleRoute: state = .staleRoute
    case .refused(let code): state = .refused(code: code)
    }
    guard let provider = options.ticketProvider else {
      needsTicket = true
      return
    }
    needsTicket = false
    let token = generation
    Task { [weak self] in
      // The session the set is re-minted through: the one it lost, until the
      // door says that one is gone (below).
      var asking = sessionId
      // Whether the door said the cell was gone during this asking: the words
      // of the end that follows (`endReason`).
      var cellGone = false
      var delay = Duration.milliseconds(100)
      while !Task.isCancelled {
        guard let self, token == self.generation, !self.closed else { return }
        do {
          self.mint(began: true, for: asking)
          let ticket = try await provider(asking)
          guard token == self.generation else { return }
          self.mint(began: false, for: asking)
          self.open(ticket)
          // `open` can refuse the ticket it was just handed — a grant outside
          // its window, which a clock that is still wrong will produce again —
          // and it says so by leaving `needsTicket` set. Returning here left
          // NOBODY minting: this task was gone and the card sat on
          // `.reconnecting` forever (TM-r3, K-M2). A refused ticket is a reason
          // to ask again on the backoff, not a reason to stop.
          guard self.needsTicket else { return }
        } catch {
          self.lastRefusal = String(describing: error)
          guard token == self.generation else { return }
          self.mint(began: false, for: asking, refused: error)
          cellGone = cellGone || Self.saysCellGone(error)
          switch Self.verdict(on: error) {
          case .askAgain:
            break
          case .sessionGone:
            // That session is over, and only that one: the other sessions on
            // the set are each asked for, and each answered. The set
            // re-mints through the next one at once; with none left, the
            // asking is over.
            self.endSession(asking, reason: Self.endReason(cellGone: cellGone))
            guard let next = self.liveSession(excluding: asking) else {
              self.needsTicket = false
              return
            }
            asking = next
            continue
          case .refused(let code):
            self.say(refusal: code, for: asking)
            return
          }
        }
        try? await Task.sleep(for: delay)
        delay = min(delay * 2, self.options.maxBackoff)
      }
    }
  }

  // MARK: Renewal and the lapsed attach (P0-C)

  /// Schedule this session's renewal: `renewalHeadroomMs` before the cell's
  /// input margin, so the renewed grant is in place while input is still open.
  ///
  /// One `requestId` per scheduled renewal, reused across its retries — the
  /// door is idempotent by it (spec §5.1), so a reply lost on the way back is
  /// answered with the same grant rather than a second generation. A renewal
  /// that still has not landed when the grant EXPIRES stops asking: past
  /// expiry the cell revokes the activation, and that revoke is what
  /// re-attaches (`lapsedAttach`).
  private func scheduleRenewal(for sessionId: String) {
    renewals[sessionId]?.cancel()
    renewals[sessionId] = nil
    guard let provider = options.renewalProvider, let grant = grants[sessionId],
      let generation = grant.grantGeneration
    else { return }
    let token = self.generation
    let due = Self.renewalDue(for: grant)
    let request = RoutedRenewal(
      sessionId: sessionId, expectGeneration: generation,
      requestId: "renew-\(UUID().uuidString.lowercased())")
    renewals[sessionId] = Task { [weak self] in
      let wait = due - Self.nowMs()
      if wait > 0 { try? await Task.sleep(for: .milliseconds(wait)) }
      var delay = Duration.seconds(1)
      while !Task.isCancelled {
        guard let self, token == self.generation, !self.closed,
          self.grants[sessionId]?.grantGeneration == generation
        else { return }
        do {
          let renewed = try await provider(request)
          guard !Task.isCancelled, token == self.generation, !self.closed else { return }
          self.renew(renewed)
          return  // the cell's ControlLegAttached for the new generation reschedules
        } catch {
          guard !Task.isCancelled else { return }
          self.lastRefusal = String(describing: error)
        }
        guard Self.nowMs() < grant.expiresAt else { return }
        try? await Task.sleep(for: delay)
        delay = min(delay * 2, .seconds(10))
      }
    }
  }

  /// When a renewal is due: the grant's expiry, less the cell's margin and this
  /// client's headroom — saturating, for the reason `deadline(from:after:)`
  /// states: `expiresAt` is fieldd's number.
  static func renewalDue(for grant: RoutedGrant) -> Int64 {
    let due = grant.expiresAt.subtractingReportingOverflow(
      attachRenewalMarginMs + renewalHeadroomMs)
    return due.overflow ? Int64.min : due.partialValue
  }

  /// A revoke that ended the ATTACH and not the session: the attach grant ran
  /// out (`right-revoked` — the cell's tick at expiry) or the attach missed the
  /// cell's deadline. The PTY is alive in both.
  static func lapsedAttach(_ reason: String) -> Bool {
    reason == "right-revoked" || reason == "attach-deadline"
  }

  /// A revoke that ended the activation with its LEG (`leg-dead` — the cell's
  /// `leg_closed`): the connection's lifetime, not the session's.
  static func lostLeg(_ reason: String) -> Bool {
    reason == "leg-dead"
  }

  /// Re-attach one session with a FRESH ticket, keeping the legs when they can
  /// carry it.
  ///
  /// Unlike `requestFreshTicket` this does not move the set to `.reconnecting`:
  /// what lapsed was one session's attach, and the legs are up. A fresh mint
  /// within one fieldd boot names the same connection set (§5.1: stable per
  /// {client, cell}), so its attach grant rides the legs already accepted; a
  /// different set — a new cell boot, or a fieldd restart, which mints a new
  /// client (TP-R21) — dials its own.
  private func reattach(sessionId: String) {
    renewals[sessionId]?.cancel()
    renewals[sessionId] = nil
    guard let provider = options.ticketProvider else {
      needsTicket = true
      return
    }
    needsTicket = false
    let token = generation
    Task { [weak self] in
      var cellGone = false
      var delay = Duration.milliseconds(100)
      while !Task.isCancelled {
        guard let self, token == self.generation, !self.closed else { return }
        do {
          self.mint(began: true, for: sessionId)
          let fresh = try await provider(sessionId)
          guard token == self.generation, !self.closed else { return }
          self.mint(began: false, for: sessionId)
          if self.attachOnLiveLegs(fresh) {
            self.reconcileStep()
            return
          }
          self.teardownLegs()
          self.open(fresh)
          guard self.needsTicket else { return }
        } catch {
          self.lastRefusal = String(describing: error)
          guard token == self.generation else { return }
          self.mint(began: false, for: sessionId, refused: error)
          cellGone = cellGone || Self.saysCellGone(error)
          switch Self.verdict(on: error) {
          case .askAgain:
            break
          case .sessionGone:
            // One session's lapsed attach: the legs are up for the others.
            self.endSession(sessionId, reason: Self.endReason(cellGone: cellGone))
            return
          case .refused(let code):
            self.say(refusal: code, for: sessionId)
            return
          }
        }
        try? await Task.sleep(for: delay)
        delay = min(delay * 2, self.options.maxBackoff)
      }
    }
  }

  /// What a ticket refusal means for the asking (fix8: never waits forever).
  ///
  /// Both re-mint loops asked again for EVERY refusal. On 2026-10-19 James's
  /// floor was respawned under a live card, and the phone asked for the lost
  /// session's ticket 254 times over three hours while the card said nothing:
  /// the door had answered that it no longer had the session, and said that
  /// asking again would not change it. The DOOR's flag decides now (contracts
  /// `ErrorData.retryable`); the kind only says why.
  enum Verdict: Equatable {
    /// The door marked the refusal retryable, or it is not the door's word at
    /// all (a deadline, a cancellation, a ticket that would not parse).
    case askAgain
    /// The door has no such terminal (`NOT_FOUND`, marked final): that session
    /// is over.
    case sessionGone
    /// A refusal no asking can change, said in the door's code. Asking again is
    /// the person's act (RETRY).
    case refused(code: String)
  }

  nonisolated static func verdict(on error: any Error) -> Verdict {
    guard let refusal = error as? FieldProductError else { return .askAgain }
    // The product client's own final kinds stop whatever the flag says.
    if refusal.isTerminal { return .refused(code: refusal.kind) }
    if refusal.retryable { return .askAgain }
    return refusal.kind == "NOT_FOUND" ? .sessionGone : .refused(code: refusal.kind)
  }

  /// fieldd's TC-S3 `cell_gone`: the cell that held the session is gone. It is
  /// marked retryable for a reason, since it is the beat before the desktop's
  /// inventory drops the session, and the door's definitive answer (NOT_FOUND)
  /// follows it. So it is asked again, and only remembered for the words.
  nonisolated static func saysCellGone(_ error: any Error) -> Bool {
    guard let unavailable = (error as? FieldProductError)?.unavailable else { return false }
    return unavailable.service == "terminal" && unavailable.state == "cell_gone"
  }

  /// The reasons a session's end carries when the door no longer has it. The
  /// card says them in words, with the desktop's name (`TerminalAttachment`).
  public nonisolated static let cellGoneReason = "cell_gone"
  public nonisolated static let notFoundReason = "not_found"

  nonisolated static func endReason(cellGone: Bool) -> String {
    cellGone ? cellGoneReason : notFoundReason
  }

  /// One session is over for this client: it says why, and is not asked for
  /// again.
  private func endSession(_ sessionId: String, reason: String) {
    guard var session = sessions[sessionId] else { return }
    session.control = .ended(reason: reason)
    endActivation(&session, reason: reason)
    sessions[sessionId] = session
    options.log("session ended — \(reason) session=\(sessionId)")
    noteAttachment()
  }

  /// A session the set may still be re-minted through: one it carries that has
  /// not ended.
  private func liveSession(excluding sessionId: String) -> String? {
    sessions.keys.sorted().first { id in
      guard id != sessionId, let session = sessions[id] else { return false }
      if case .ended = session.control { return false }
      return true
    }
  }

  /// A refusal no asking can change, said. While the set's legs stand it is the
  /// session's answer, since the set's state is every card's (the audit's P5);
  /// once they are gone, the set's own state is the news.
  private func say(refusal code: String, for sessionId: String) {
    if state == .attached || state == .ready, var session = sessions[sessionId] {
      session.control = .refused(code: code, retryable: false)
      sessions[sessionId] = session
      noteAttachment()
    } else {
      state = .refused(code: code)
    }
  }

  /// Attach a fresh ticket's grant over the legs already accepted — true when
  /// it could, which is only for the SAME cell boot and the SAME connection set.
  private func attachOnLiveLegs(_ fresh: RoutedTerminalTicket) -> Bool {
    guard let sessionId = fresh.sessionId, let current = ticket,
      control != nil, frames != nil, controlAccepted != nil, framesAccepted != nil,
      current.route.cellBootId == fresh.route.cellBootId,
      current.transportGrant.connectionSetId == fresh.transportGrant.connectionSetId
    else { return false }
    keep(fresh.attachGrant, for: sessionId)
    ticket = fresh
    needsTicket = false
    // The legs never left: whatever an attach refusal said about the set, it
    // is ready for this attach.
    if state != .attached { state = .ready }
    attach(sessionId: sessionId)
    return true
  }

  /// End one activation, in BOTH dimensions.
  ///
  /// Both, and not only the frames leg: an activation is two legs, so the moment
  /// either is gone the session is not attached any more. A `control` that still
  /// read `attached` after the leg died would be exactly the blank the design
  /// refuses — a face saying "connected" over a socket that is not there.
  private func endActivation(_ session: inout RoutedSessionState, reason: String) {
    guard !session.activationEnded else { return }
    session.activationEnded = true
    // Law (2)/(3): the account goes DRAINING — already-admitted bytes are never
    // pretended away — and stays reported until the cell has seen them.
    ledger.drain(activationId: session.activationId, nowMs: Self.nowMs())
    renewals[session.sessionId]?.cancel()
    renewals[session.sessionId] = nil
    session.transfer = nil
    // The ACTIVATION is over, and the session is not, by this alone: what it is
    // next is the caller's word — the cell's `removed` ends it, a lapse
    // re-attaches it, a lost leg leaves it waiting for the set's next legs.
    // Reading every end as the session's turned a leg blip into "this session
    // ended — leg-dead" with no retry (the audit's B3, 2026-10-17).
    if session.control == .attached { session.control = .attaching }
    session.frames = .failed(reason)
    let sessionId = session.sessionId
    let activationId = session.activationId
    let sink = self.sink
    // D1 — after every frame of this activation already handed over
    enqueueApply(sessionId: sessionId) {
      await sink.activationEnded(session: sessionId, activation: activationId, reason: reason)
    }
  }

  private func fail(_ reason: String) {
    lastRefusal = reason
    state = .failed(reason: reason)
    teardownLegs()
  }

  private func teardownLegs() {
    // Every activation rode these legs, so none outlives them. A failure that
    // tore the legs down used to leave its sessions reading attached, and the
    // card's RETRY took that for a live lane — "back on its lane, no mint, no
    // dial" over closed sockets (the audit's P5, 2026-10-17). A lost leg ends
    // its activations first, in its own words (`legFailed`).
    for (sessionId, var session) in sessions where !session.activationEnded {
      endActivation(&session, reason: "legs-closed")
      sessions[sessionId] = session
    }
    control?.close()
    frames?.close()
    control = nil
    frames = nil
    // DS-4b — the answers to these verbs went with the leg. A TAKE whose answer
    // never came is still this focus gain's take: it is held for the next
    // attach. Resizes and bare claims are not (the next take re-sizes anyway).
    for ask in geometryAsks where ask.intent == .take && pendingTakes[ask.sessionId] == nil {
      pendingTakes[ask.sessionId] = wantedGrids[ask.sessionId] ?? ask.grid
    }
    geometryAsks = []
    // SP-2 (g) — the legs' slots go back with the legs, and a dial still
    // waiting for slots stops waiting.
    legGrantTask?.cancel()
    legGrantTask = nil
    if let grant = legGrant {
      legGrant = nil
      options.legBudget?.release(grant)
    }
    controlAccepted = nil
    framesAccepted = nil
    pumps.forEach { $0.cancel() }
    pumps = []
    // every activation rode these legs, so every scheduled renewal goes with
    // them; a re-attach on new legs schedules its own
    renewals.values.forEach { $0.cancel() }
    renewals = [:]
  }

  private func teardown() {
    generation += 1
    teardownLegs()
    sessions = [:]
    grants = [:]
    ownClients = [:]
    ticket = nil
    negotiatedCapabilities = []
    // fix8 — a mint still in flight belongs to the generation just retired
    mintInFlight = false
    presented = []
    // D1 — what was queued belonged to the activations just retired; their
    // frames are refused where they land, so the chains need not be waited on
    applyTails = [:]
  }

  // MARK: fix8 — the attach's steps, each with a deadline

  /// The step this client is waiting on, read off what it holds — derived
  /// rather than recorded at each transition, so a transition nobody thought to
  /// mark still moves it the next time anything reconciles.
  private var derivedStep: AttachStep? {
    guard !closed else { return nil }
    switch state {
    case .off, .failed, .stalled: return nil
    case .refused, .reconnecting, .staleRoute:
      // A refusal or a lost leg waits on nothing but a mint in flight: a mint
      // that was refused is an answer the caller says, and the backoff after it
      // is this client's own sleep.
      return mintInFlight ? .ticket : nil
    case .connecting:
      if mintInFlight { return .ticket }
      return legGrantTask != nil ? .slot : .dial
    case .ready, .attached:
      if mintInFlight { return .ticket }
      // The sessions the set still CARRIES, each on its own step, and the least
      // advanced is the set's. It was the last ticket's session alone, and a
      // `forget` of that one left the set waiting on an attach nobody would
      // make: 20 s later the whole lane stalled, and every card on it said
      // "couldn't reach" (the audit's P6, 2026-10-17).
      let pending = Set(sessions.values.compactMap(pendingStep(of:)))
      return AttachStep.allCases.first(where: pending.contains)
    }
  }

  /// What one carried session's attach waits on, nil when nothing: it has
  /// presented, it is parked (demand `none` — the cell owes it no frame), or
  /// it was refused, ended or failed, each of which is said, not waited out.
  private func pendingStep(of session: RoutedSessionState) -> AttachStep? {
    if presented.contains(session.activationId) || session.demand == .none { return nil }
    switch session.control {
    case .attaching: return .control
    case .refused, .ended: return nil
    case .attached: break
    }
    switch session.frames {
    case .attaching: return .frames
    case .failed: return nil
    case .resuming, .seeding, .applying, .active: break
    }
    return session.presentationReady ? nil : .firstFrame
  }

  /// Move `step` to what the client now holds, arming that step's deadline.
  private func reconcileStep() {
    // Every session's first presented frame, not the last ticket's alone: a
    // second session on a shared lane was never recorded as presented, so each
    // reseed read it as connecting again (`hasPresented`), and the steps above
    // would wait on a frame it had shown long ago (P6).
    for (sessionId, session) in sessions where session.presentationReady {
      if presented.insert(session.activationId).inserted {
        options.log("first frame presented — live session=\(sessionId)")
      }
    }
    let next = derivedStep
    guard next != step else { return }
    step = next
    stepTimer?.cancel()
    stepTimer = nil
    stepToken &+= 1
    guard let next else { return }
    let token = stepToken
    let limit = options.stepDeadline
    stepTimer = Task { [weak self] in
      try? await Task.sleep(for: limit)
      guard !Task.isCancelled, let self, token == self.stepToken else { return }
      // A transition no call site reconciled is caught here, and re-arms.
      self.reconcileStep()
      guard token == self.stepToken, self.step == next else { return }
      self.stall(at: next)
    }
  }

  /// A step outlived its deadline: everything this set holds goes — the legs
  /// and their slots, a dial waiting for a slot, every re-mint and renewal of
  /// this generation — and the state says where it stopped.
  private func stall(at step: AttachStep) {
    lastRefusal = "the attach stopped waiting at \(step.rawValue)"
    let parts = options.stepDeadline.components
    let seconds = max(1, parts.seconds + (parts.attoseconds > 0 ? 1 : 0))
    options.log.error(
      "stopped waiting at \(step.rawValue) after \(seconds) s "
        + "session=\(ticket?.sessionId ?? "-") cell=\(ticket?.route.cellBootId ?? "-")")
    teardown()
    state = .stalled(step)
    reconcileStep()
  }

  /// A `ticketProvider` call starting or ending, for `derivedStep`.
  private func mint(began: Bool, for sessionId: String, refused: (any Error)? = nil) {
    if began {
      options.log("ticket asked again session=\(sessionId)")
    } else if let refused {
      options.log.error("ticket refused session=\(sessionId) — \(TerminalAttachLog.reason(refused))")
    } else {
      options.log("ticket answered session=\(sessionId)")
    }
    mintInFlight = began
    reconcileStep()
  }

  // MARK: Helpers

  private func sendInput(sessionId: String, op: JSONValue) {
    guard var session = sessions[sessionId] else { return }
    session.nowMs = Self.nowMs()
    sessions[sessionId] = session
    // The cell ALWAYS rejects input while its own `input` is not allowed, and a
    // refusal is a DROP with an audit line and no reply — so a client that sent
    // anyway would be typing into a silence it could not distinguish from a
    // working terminal. The gate is here as well as there.
    guard session.inputAllowed else { return }
    session.inputSequence += 1
    sessions[sessionId] = session
    control?.send(.sendInput, inputBody(sessionId: sessionId, session: session, op: op))
  }

  private func inputBody(sessionId: String, session: RoutedSessionState, op: JSONValue)
    -> [String: JSONValue]
  {
    [
      "sessionId": .string(sessionId),
      "activationId": .string(session.activationId),
      "leaseEpoch": .int(leaseEpoch(for: sessionId)),
      "inputSequence": .int(session.inputSequence),
      "op": op,
    ]
  }

  /// Typed text or a paste: the two inputs whose size a person chose. The
  /// cell's reader caps a control message at the `maxControlMessageBytes` it
  /// announced and CLOSES THE WHOLE LEG on a larger one (tungstenite's
  /// `max_message_size`, `tp/door.rs` `ws_config`), so a 300 KB paste tore down
  /// the control of every session on the lane. One past the cap is refused
  /// here, with its numbers, and never sent. It is measured by the one encoder
  /// the leg sends with, never a mirror of its escaping: `JSONEncoder` escapes
  /// `/` where `JSON.stringify` does not, and quotes and controls cost more
  /// than their own bytes (the History lead's D6, 2026-10-17).
  private func sendText(
    _ text: String, _ kind: RoutedInputRefusal.Kind, to sessionId: String
  ) -> RoutedInputRefusal? {
    let wire = kind == .pasted ? "paste" : "text"
    func op(_ text: String) -> JSONValue {
      .object(["kind": .string(wire), "text": .string(text)])
    }
    if var next = sessions[sessionId], next.inputAllowed {
      // The message exactly as it would go: its own sequence included.
      next.inputSequence += 1
      let limit = limits.maxControlMessageBytes
      func fits(_ text: String) -> Bool {
        let body = inputBody(sessionId: sessionId, session: next, op: op(text))
        guard let message = try? RoutedWire.encode(.sendInput, body) else { return false }
        return message.utf8.count <= limit
      }
      if !fits(text) {
        let refusal = RoutedInputRefusal(
          kind: kind, bytes: text.utf8.count, fits: Self.longestPrefix(of: text, fitting: fits))
        options.log(
          "input refused: \(wire) of \(refusal.bytes) bytes, one message carries \(refusal.fits) "
            + "of it (cap \(limit)) session=\(sessionId)")
        return refusal
      }
    }
    sendInput(sessionId: sessionId, op: op(text))
    return nil
  }

  /// The own UTF-8 of `text`'s longest prefix, cut between code points, that
  /// `fits` — found by bisection over the real measure, so the figure a person
  /// is told can never disagree with what the leg would send. Zero when not
  /// even an empty text fits.
  static func longestPrefix(of text: String, fitting fits: (String) -> Bool) -> Int {
    let scalars = Array(text.unicodeScalars)
    func prefix(_ count: Int) -> String {
      var view = String.UnicodeScalarView()
      view.append(contentsOf: scalars[..<count])
      return String(view)
    }
    guard fits(prefix(0)) else { return 0 }
    guard !fits(text) else { return text.utf8.count }
    var low = 0  // fits
    var high = scalars.count  // does not
    while high - low > 1 {
      let middle = (low + high) / 2
      if fits(prefix(middle)) { low = middle } else { high = middle }
    }
    return prefix(low).utf8.count
  }

  private func leaseEpoch(for sessionId: String) -> Int64 {
    grants[sessionId]?.leaseEpoch ?? ticket?.leaseEpoch ?? 0
  }

  /// A deadline `ttlMs` after `nowMs`, SATURATING rather than trapping.
  ///
  /// Both terms can be a remote's: the TTL is the cell's and the margin is
  /// subtracted from a grant's `expiresAt`, which fieldd minted. A deadline
  /// that cannot be represented is not a crash — it is the furthest deadline
  /// that can be, because every reader of one is a comparison (TM-r3, K-M3).
  static func deadline(from nowMs: Int64, after ttlMs: Int64) -> Int64 {
    let sum = nowMs.addingReportingOverflow(ttlMs)
    guard sum.overflow else { return sum.partialValue }
    return ttlMs > 0 ? Int64.max : Int64.min
  }

  /// When this client stops sending input for want of a renewal: the grant's
  /// own expiry, less the cell's renewal margin. `expiresAt` is fieldd's
  /// number and `open` validates only the TRANSPORT grant, so an attach grant
  /// with an extreme stamp reaches this line unchecked and must not trap.
  static func inputRightDeadline(for grant: RoutedGrant) -> Int64 {
    let deadline = grant.expiresAt.subtractingReportingOverflow(attachRenewalMarginMs)
    guard deadline.overflow else { return deadline.partialValue }
    // Only an `expiresAt` at the very bottom of the range overflows here, and
    // a right that expired before any clock started is simply not live.
    return Int64.min
  }

  static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
}

/// A keystroke in ghosttea's `KeyInput` serde spelling. The cell deserializes
/// the wire `op` straight into the engine's own type, so this shape is PINNED to
/// the engine and not this client's to choose; `unshiftedCodepoint` defaults to
/// 0, which is the engine's own serde default.
public struct RoutedKeyInput: Sendable, Equatable {
  public enum Action: String, Sendable, Equatable {
    case down
    case up
  }

  public var type: Action
  public var key: String
  public var code: String
  public var repeatKey: Bool
  public var shift: Bool
  public var control: Bool
  public var alt: Bool
  public var meta: Bool
  public var unshiftedCodepoint: UInt32

  public init(
    type: Action = .down, key: String, code: String, repeatKey: Bool = false, shift: Bool = false,
    control: Bool = false, alt: Bool = false, meta: Bool = false, unshiftedCodepoint: UInt32 = 0
  ) {
    self.type = type
    self.key = key
    self.code = code
    self.repeatKey = repeatKey
    self.shift = shift
    self.control = control
    self.alt = alt
    self.meta = meta
    self.unshiftedCodepoint = unshiftedCodepoint
  }

  public var json: JSONValue {
    .object([
      "type": .string(type.rawValue),
      "key": .string(key),
      "code": .string(code),
      // `repeat` is a Swift keyword; the WIRE spells it the engine's way, which
      // is the only spelling that matters.
      "repeat": .bool(repeatKey),
      "shift": .bool(shift),
      "control": .bool(control),
      "alt": .bool(alt),
      "meta": .bool(meta),
      "unshiftedCodepoint": .int(Int64(unshiftedCodepoint)),
    ])
  }
}

/// A pointer event in ghosttea's `MouseInput` serde spelling, pinned to the
/// engine for the same reason `RoutedKeyInput` is: the cell deserializes the
/// wire `op` straight into the engine's own type, so the field names and their
/// ranges are the engine's and not this client's to choose.
///
/// `x`/`y` are FINITE f32 by contract — the cell's reader refuses an infinity
/// rather than letting one reach the engine (`deserialize_finite_mouse_input`),
/// so a non-finite coordinate is dropped on this device instead of spending a
/// message to be refused there. `isFinite` is the predicate, and since TM-r3
/// (K-L2) `RoutedTerminalClient.send(mouse:to:)` is what applies it — the
/// sentence was true of `TerminalAttachment.handleMouse` alone until then, so
/// any other caller of the client sent the infinity.
public struct RoutedMouseInput: Sendable, Equatable {
  public enum Action: String, Sendable, Equatable {
    case press
    case release
    case motion
  }

  public var action: Action
  public var button: UInt8
  public var x: Float
  public var y: Float
  public var screenWidth: UInt32
  public var screenHeight: UInt32
  public var cellWidth: UInt32
  public var cellHeight: UInt32
  public var paddingLeft: UInt32
  public var paddingTop: UInt32
  public var shift: Bool
  public var control: Bool
  public var alt: Bool
  public var meta: Bool

  public init(
    action: Action, button: UInt8, x: Float, y: Float, screenWidth: UInt32, screenHeight: UInt32,
    cellWidth: UInt32, cellHeight: UInt32, paddingLeft: UInt32, paddingTop: UInt32,
    shift: Bool = false, control: Bool = false, alt: Bool = false, meta: Bool = false
  ) {
    self.action = action
    self.button = button
    self.x = x
    self.y = y
    self.screenWidth = screenWidth
    self.screenHeight = screenHeight
    self.cellWidth = cellWidth
    self.cellHeight = cellHeight
    self.paddingLeft = paddingLeft
    self.paddingTop = paddingTop
    self.shift = shift
    self.control = control
    self.alt = alt
    self.meta = meta
  }

  /// Whether this event can be spelled on the wire at all.
  public var isFinite: Bool { x.isFinite && y.isFinite }

  public var json: JSONValue {
    .object([
      "action": .string(action.rawValue),
      "button": .int(Int64(button)),
      "x": .double(Double(x)),
      "y": .double(Double(y)),
      "screenWidth": .int(Int64(screenWidth)),
      "screenHeight": .int(Int64(screenHeight)),
      "cellWidth": .int(Int64(cellWidth)),
      "cellHeight": .int(Int64(cellHeight)),
      "paddingLeft": .int(Int64(paddingLeft)),
      "paddingTop": .int(Int64(paddingTop)),
      "shift": .bool(shift),
      "control": .bool(control),
      "alt": .bool(alt),
      "meta": .bool(meta),
    ])
  }
}
