import FieldProduct
import FieldRoutedTerminal
import Foundation
import GhostteaCore
import GhostteaTerminal
import Observation

/// What the card renders. Every resting state carries its reason — nothing
/// silently becomes idle; `idle` is only ever the user's own detach.
public enum TerminalPhase: Equatable, Sendable {
  case idle
  case connecting
  case live
  case suspended(String)
  /// A refusal in the door's or the cell's OWN words — the mint that would not
  /// be made, or the attach the cell turned down. Its own case since TM-5,
  /// because a refusal is not a failure and not a pause: it is an answer, and
  /// the sentence that came back is the only honest thing to show.
  case refused(String)
  case ended(String)
  case failed(String)
  /// fix8 — an attach step outlived its deadline: which step, in words. The
  /// banner names the desktop; the attach is stopped and RETRY starts afresh.
  case stalled(String)
}

/// The card's one banner: what is wrong, and what can be done about it.
///
/// GhostteaKit's `GhostteaAttachmentBannerPresenter` retired with the TSP1
/// lifecycle at TM-5 — it was the outage vocabulary of a connection this phone
/// no longer makes. This is ours, and it is deliberately smaller: the routed
/// client re-tickets itself with backoff, so there is no retry clock to render
/// and no grace window to keep; what is left is the state, its reason, and the
/// two acts a person actually has.
public struct TerminalBanner: Sendable, Equatable {
  public enum Action: String, Sendable, Equatable {
    /// Mint a ticket now rather than waiting out the client's backoff.
    case retryNow
    /// Leave the card. The chooser on this phone is the field.
    case backToTheField
  }

  public let title: String
  /// The second line, when there is one worth the room.
  public let detail: String?
  public let actions: [Action]
  /// Whether the terminal below is showing a scene that is no longer being
  /// advanced. The sink keeps what it has — an honest stale face beats a blank
  /// one — and this is what tells the card to say so.
  public let coolsTerminal: Bool

  public init(title: String, detail: String? = nil, actions: [Action], coolsTerminal: Bool) {
    self.title = title
    self.detail = detail
    self.actions = actions
    self.coolsTerminal = coolsTerminal
  }
}

/// One remote terminal session attached over the ROUTED T1 client (TM-5).
///
/// The shape of an attach, end to end: the join already names the session
/// (`terminal.runtimeSessionId` on the fold row), the composition layer hands
/// this object a door that mints a `TerminalOpenTicket` for it over the product
/// API, and the ticket names a cell's two WebSocket doors on the desktop's
/// tailnet address. `RoutedTerminalClient` dials both legs, presents the
/// transport grant in each hello, attaches the session under one activation, and
/// streams the cell's own TRF1 into `RoutedTerminalFrameSink` — which is the
/// Metal renderer's frame path and nothing else.
///
/// **What left with TSP1** (TM-5's retirements, each for a stated reason):
/// GhostteaKit's attachment lifecycle, its replica sink and the on-device TRF1
/// ENCODE (the cell renders once now; the phone decodes, like every other
/// viewer), the peer directory and its compact dial, and the banner presenter.
/// The mirror-write bearer left the ATTACH path here and was deleted outright at
/// TM-3 (2026-09-14) — store, sheet, door and all. The right to type is a claim
/// in an expiring grant minted per client per session (TM-D3), never a string
/// this device holds.
///
/// **What the phone is NOT granted:** the geometry lease. fieldd mints a
/// tailnet self peer `[input, read]`, so a phone viewer is ADDITIVE to the
/// desktop's — it types into the session but never resizes it, and the reclaim
/// funnel that used to fight for the control epoch is gone with the protocol
/// that had one. The pane's own grid is still recorded here because the input
/// card lays itself out against it.
///
/// Corrected 2026-09-30 (DS-4, DS-D5's note): the GRANT now carries `geometry`
/// for every self principal, the phone included — the pane focused last takes
/// the seat on any device. What is still true is the behaviour: this kit speaks
/// no lease verb yet (DS-4b), so the phone never claims and never resizes.
///
/// Corrected 2026-10-01 (DS-4b BUILT): the phone's pane TAKES the seat when it
/// gains focus — presented and active: once at the attach, once more each time
/// the app comes back to it — through `RoutedTerminalClient.takeGeometry`,
/// which owns the one retry. While it holds the seat its resizes size the PTY;
/// once another pane takes it, it renders what that pane sized and never
/// claims on a mere resize. A grant without `geometry` sends no verb.
@MainActor
@Observable
public final class TerminalAttachment {
  /// How a ticket is obtained: one call of `terminal.openTicket` over the
  /// product door, answered as the raw JSON the daemon sent.
  ///
  /// Raw rather than a decoded ticket ON PURPOSE — it is what keeps the field
  /// from learning what a terminal is. FieldMesh owns the door and knows how to
  /// ask; this target owns the ticket and knows what the answer means; neither
  /// has to import the other's vocabulary to say so.
  public typealias TicketDoor = @MainActor @Sendable (String) async throws -> JSONValue

  /// P0-C — how an attach grant is renewed: one `terminal.renewAttach`
  /// `{sessionId, expectGeneration, requestId}` over the same product door,
  /// answered as the raw JSON the daemon sent (`{attachGrant}`), for the same
  /// reason `TicketDoor` is raw.
  public typealias RenewalDoor =
    @MainActor @Sendable (_ sessionId: String, _ expectGeneration: Int64, _ requestId: String)
    async throws -> JSONValue

  /// How to reach the tailnet: the mesh node's own `URLSession` factory.
  ///
  /// The phone's tailnet is a userspace netstack in THIS process, so a plain
  /// `URLSession` sends a `100.x` dial nowhere. Taking the factory rather than
  /// a built transport is what lets the composition layer hand over the ability
  /// to dial without naming a wire type — the same reason `TicketDoor` carries
  /// raw JSON.
  public typealias SessionProvider = URLSessionRoutedTransport.SessionProvider

  /// This session's retained scene: the cell's TRF1, verbatim, applied in order
  /// the moment each frame arrives (D1, B2 — `TerminalScene`), and the view
  /// `TerminalSurface` hosts. Nothing on this device re-encodes a frame.
  @ObservationIgnored public let scene: TerminalScene
  /// What the appearance sheet's values project to. Under T this styles the
  /// DEVICE's half of the render (background, opacity, shaders, padding); the
  /// glyphs and every explicitly-styled colour arrive rasterized inside the
  /// frame, from the cell — see `TerminalPresentation`'s note.
  public private(set) var presentation: GhostteaTerminalPresentationConfig
  public private(set) var appearance: TerminalAppearance
  /// The local half of the session, when the user or the app put it there:
  /// `idle` before an attach and after a detach, `suspended` while the app is
  /// in the background, a refusal or a failure the door itself answered. Absent
  /// = the client is the authority and `phase` reads it.
  private var localPhase: TerminalPhase? = .idle
  /// The door's own words for the last mint it refused, kept after the state
  /// moves on so the banner can say WHY instead of showing a blank pane.
  public private(set) var doorRefusal: String?
  /// The transient note beside the terminal — a keystroke this device declined
  /// to send, a scene that had to be re-seeded. Never a queue receipt: an input
  /// the client drops is gone.
  public private(set) var notice: String?

  // --- IOS-5b ---------------------------------------------------------------
  /// The input card's sticky Ctrl, reaching the terminal's OWN keyboard.
  ///
  /// Installed by the host at attach and cleared when the card closes — and it
  /// must be cleared, because the card's sink already holds this attachment and
  /// this closure holds the card: the pair is a retain cycle that only
  /// `closeCard` breaks. Absent (the default) leaves `handleSoftwareInput` on
  /// exactly its pre-5b path.
  ///
  /// Consuming by contract: see `latchedKeystroke(for:)`.
  @ObservationIgnored public var softwareInputLatch: (() -> TerminalModifiers)?
  // --- end IOS-5b -----------------------------------------------------------

  /// The desktop's lanes this session rides (`TerminalLanes`): the door, the
  /// renewal, the leg budget and one routed client per cell.
  @ObservationIgnored private let lanes: TerminalLanes
  /// Lanes made for this attachment alone close with it, as the per-tap client
  /// always did; SHARED lanes outlive it, so leaving parks the session instead
  /// and coming back is a demand, not a dial.
  @ObservationIgnored private let ownsLanes: Bool
  @ObservationIgnored private var client: RoutedTerminalClient?
  @ObservationIgnored private var sink: RoutedTerminalFrameSink?
  @ObservationIgnored private var sessionID: String?
  /// The session this attachment shows or last showed — how the home screen
  /// keeps a closed card's session live (`HomeScreen.keptAttachments`).
  public var attachedSessionID: String? { sessionID }
  @ObservationIgnored private var deviceName: String?
  @ObservationIgnored private var attachTask: Task<Void, Never>?
  @ObservationIgnored private var noticeTask: Task<Void, Never>?
  @ObservationIgnored private var grid = GhostteaTerminalGridSize(columns: 80, rows: 24)
  /// Which attach a late answer belongs to — a superseded one must not repaint
  /// the new one. The client is rebuilt per attach, so this is the cheap check
  /// that a task started before the rebuild is not still writing to it.
  @ObservationIgnored private var attachID: UInt64 = 0
  /// The binding the CURRENT sink and re-mint were made for. A frame or a
  /// re-mint belongs to this attachment exactly when it arrives on the binding
  /// the attachment holds — never by which TAP made it. Keyed to `attachID`, a
  /// re-tap of a session still whole on its lane (the freeway's fast path) kept
  /// a sink whose every frame was then refused: the reopened card read live over
  /// a frozen screen (the sweep's P1, 2026-10-17). It moves only when a sink is
  /// installed or let go (`bind`, `unbind`).
  @ObservationIgnored private var binding: UInt64 = 0
  /// fix8 — how long any one step of an attach may wait (the mint here, each
  /// `RoutedTerminalClient.AttachStep` in the client) before the card says
  /// where it stopped.
  @ObservationIgnored private let deadline: Duration
  /// fix8 — where the attach's phases are written.
  @ObservationIgnored private let log: TerminalAttachLog

  /// The shipping deadline for one attach step: the mesh's own request timeout
  /// (15 s) and a margin.
  nonisolated public static let stepDeadline: Duration = .seconds(20)

  public convenience init(
    session: @escaping SessionProvider,
    appearance: TerminalAppearance,
    door: @escaping TicketDoor,
    renewal: RenewalDoor? = nil,
    budget: PhoneConnectionBudget? = nil,
    deadline: Duration = TerminalAttachment.stepDeadline,
    log: TerminalAttachLog = .device
  ) {
    self.init(
      transport: URLSessionRoutedTransport(session: session, log: log), appearance: appearance,
      door: door, renewal: renewal, budget: budget, deadline: deadline, log: log,
      scene: TerminalScene())
  }

  /// The seam the tests hold: a transport with no sockets behind it. Every
  /// shipping caller takes the initializer above — this one exists so the
  /// attachment's own state machine can be driven without a server, which is
  /// the same split `RoutedTerminalClient` keeps one layer down.
  public convenience init(
    transport: any RoutedLegTransport,
    appearance: TerminalAppearance,
    door: @escaping TicketDoor,
    renewal: RenewalDoor? = nil,
    budget: PhoneConnectionBudget? = nil,
    deadline: Duration = TerminalAttachment.stepDeadline,
    log: TerminalAttachLog = .device,
    // A scene that takes every frame unseen: a suite not about rendering keeps
    // reaching live without a Metal view, and a suite about frames passes its own.
    scene: TerminalScene = TerminalScene(applying: { _ in true })
  ) {
    self.init(
      lanes: TerminalLanes(
        transport: transport, door: door, renewal: renewal, budget: budget, deadline: deadline,
        log: log),
      ownsLanes: true, appearance: appearance, deadline: deadline, log: log, scene: scene)
  }

  /// One session on a desktop's SHARED lanes (the freeway's kit half, F1): the
  /// lanes keep the cell's connection set across attachments, and leaving parks
  /// this session rather than closing anything.
  public convenience init(
    lanes: TerminalLanes,
    appearance: TerminalAppearance,
    deadline: Duration = TerminalAttachment.stepDeadline,
    log: TerminalAttachLog = .device,
    scene: TerminalScene = TerminalScene()
  ) {
    self.init(
      lanes: lanes, ownsLanes: false, appearance: appearance, deadline: deadline, log: log,
      scene: scene)
  }

  private init(
    lanes: TerminalLanes,
    ownsLanes: Bool,
    appearance: TerminalAppearance,
    deadline: Duration,
    log: TerminalAttachLog,
    scene: TerminalScene
  ) {
    self.lanes = lanes
    self.ownsLanes = ownsLanes
    self.scene = scene
    self.appearance = appearance
    self.deadline = deadline
    self.log = log
    presentation = presentationConfig(for: appearance)
  }

  // MARK: - What the card reads

  /// The session as ONE state. Computed rather than stored: the client is
  /// `@Observable`, so a view that reads this is tracking the client's own
  /// fields and there is no second copy of the truth to fall behind.
  public var phase: TerminalPhase {
    if let localPhase { return localPhase }
    guard let client, let sessionID else { return .idle }
    return Self.phase(
      for: client.state, session: client.sessions[sessionID],
      presented: client.hasPresented(sessionID), deadline: deadline)
  }

  /// Whether the CELL accepted this client's right to type. The grant asks; the
  /// cell answers, and a downgrade applies the moment it lands — so this is the
  /// accepted rights and never the requested ones.
  public var readWrite: Bool {
    guard let client, let sessionID else { return false }
    return client.sessions[sessionID]?.rights.contains(.input) ?? false
  }

  /// The GRANT's answer to "may this viewer type": the input right the cell
  /// accepted, still live. It moves with the grant and never with a frame, so
  /// it is what the card's chrome is built on. `acceptsInput` is the
  /// per-keystroke gate: it drops for a moment on every reseed, and chrome
  /// that followed it re-laid the pane into the next resize (2026-10-17).
  public var mayType: Bool { readWrite && !writeGrantExpired }

  /// `InputAllowed(a)` — every term of it, computed by the client: both legs
  /// attached, the cell presenting, the lease live against a local deadline,
  /// the applied scene at or past what the cell accepted, the cell's input
  /// dimension allowed, and the attach grant still inside its renewal margin.
  public var acceptsInput: Bool {
    guard let client, let sessionID else { return false }
    return client.sessions[sessionID]?.inputAllowed ?? false
  }

  public var banner: TerminalBanner? {
    Self.banner(
      for: phase, device: deviceName, doorRefusal: doorRefusal,
      writeGrantExpired: writeGrantExpired)
  }

  /// This viewer's INPUT right has run out on a session that is otherwise live.
  ///
  /// The attach grant is minted for ten minutes and both ends close input a
  /// minute early unless a renewal arrives (`ATTACH_RENEWAL_MARGIN_MS`). Until
  /// P0-C (2026-09-24) nothing on this phone renewed one, so this was the
  /// resting state of every long session. The client now renews ahead of the
  /// margin through the renewal door, so this reads true only when a renewal
  /// FAILED — the desktop's door unreachable, a refused CAS — and at expiry the
  /// client re-attaches with a fresh ticket on its own. It stays a face because
  /// in that minute a keystroke still goes nowhere, and saying so is the rule.
  public var writeGrantExpired: Bool {
    guard let client, let sessionID, let session = client.sessions[sessionID] else { return false }
    // Only for a viewer that WAS granted input. A read-only one has its own
    // sentence, and it is not about anything running out.
    guard session.rights.contains(.input) else { return false }
    return !session.inputRightLive
  }

  // MARK: - Attach / detach

  /// Attach to one session by the id the join already named.
  ///
  /// `deviceName` feeds the banner copy ("studio is not publishing its terminal
  /// doors") — when the field has one, pass it; the copy degrades to "that
  /// desktop" rather than naming a ULID at anybody.
  public func attach(
    sessionID: String, cols: UInt16, rows: UInt16, deviceName: String? = nil
  ) {
    // The grid a take is made with is the VIEW's measured one whenever there
    // is one. A kept session's view, re-hosted at the size it had, never
    // reports its grid again (the same geometry is an early return), so the
    // host's placeholder sized the desktop's PTY to 80×24 on every reopen
    // (the scroll audit, 2026-10-17). A view not yet laid out has none, and
    // the placeholder holds only until the surface measures it.
    grid = scene.view?.currentGridSize ?? GhostteaTerminalGridSize(columns: cols, rows: rows)
    let previous = self.sessionID
    // Another session's picture must not stand under this one's name; the same
    // session's last picture may, until the new activation's seed replaces it.
    if previous != sessionID { scene.clear() }
    self.sessionID = sessionID
    self.deviceName = deviceName
    localPhase = .connecting
    doorRefusal = nil
    notice = nil
    attachID &+= 1
    let attach = attachID
    log("tap: attach session=\(sessionID) on \(deviceName ?? "that desktop")")
    attachTask?.cancel()
    attachTask = Task { [weak self] in
      guard let self else { return }
      // The same session on this attachment, still whole on its SHARED lane: a
      // session left live keeps a current scene, so the card paints it now and
      // only takes the seat; a parked one asks the cell for its view again, and
      // a seed follows. No mint, no dial either way.
      if !self.ownsLanes, previous == sessionID, let held = self.client,
        held.sessions[sessionID]?.bothLegsAttached == true
      {
        if held.sessions[sessionID]?.demand == RoutedDemand.none {
          held.requestReseed(for: sessionID)
          held.declare(demand: .live, for: sessionID)
        }
        self.localPhase = nil
        self.takeSeat()
        self.log("back on its lane session=\(sessionID) — no mint, no dial")
        return
      }
      await self.teardown(resetPhase: false, letGo: previous == sessionID ? nil : previous)
      guard attach == self.attachID, !Task.isCancelled else { return }
      // A SHARED lane still carrying this session: its activation and grant are
      // in place — ask the cell for the view again. Nothing is minted, nothing
      // dialed: the freeway's tap, on today's transport.
      if !self.ownsLanes, let held = self.lanes.client(holding: sessionID),
        self.resume(on: held, sessionID: sessionID)
      {
        return
      }
      // The FIRST ticket is awaited here rather than handed to the client,
      // because a mint that is refused has no socket to report itself on: the
      // door's sentence is the whole answer and it must reach a face.
      let ticket: RoutedTerminalTicket
      self.log("mint asked session=\(sessionID)")
      let asked = ContinuousClock.now
      do {
        ticket = try await self.mint(for: sessionID, within: self.deadline)
      } catch is MintDeadline {
        guard attach == self.attachID, !Task.isCancelled else { return }
        self.log.error(
          "mint stopped after \(Self.seconds(self.deadline)) s session=\(sessionID)")
        self.localPhase = .stalled(Self.stallWords(.ticket, after: self.deadline))
        return
      } catch {
        guard attach == self.attachID, !Task.isCancelled else { return }
        let words = self.doorRefusal ?? TerminalAttachLog.reason(error)
        self.log.error("mint refused: \(words)")
        self.localPhase = .refused(self.doorRefusal ?? Self.shortReason(error))
        return
      }
      self.log(
        "mint answered session=\(sessionID) cell=\(ticket.route.cellBootId) in "
          + "\(URLSessionRoutedTransport.milliseconds(since: asked)) ms")
      guard attach == self.attachID, !Task.isCancelled else { return }
      self.open(ticket, sessionID: sessionID)
    }
  }

  /// fix8 — the field says this card's run has exited (its face is an ended
  /// one) while the attach has not gone live: say the run ended, and stop
  /// connecting to a terminal the desktop has already let go of. A live
  /// session is the cell's to end, and an ended or idle card has nothing to stop.
  public func runEnded() {
    switch phase {
    case .idle, .live, .ended: return
    case .connecting, .suspended, .refused, .failed, .stalled: break
    }
    attachID &+= 1  // a mint or a ticket still in flight belongs to nobody now
    attachTask?.cancel()
    attachTask = nil
    letGo(sessionID)
    client = nil
    unbind()
    localPhase = .ended(Self.runEndedWords(device: deviceName))
    log(
      "run exited on \(deviceName ?? "that desktop") — attach stopped "
        + "session=\(sessionID ?? "-")")
  }

  nonisolated static func runEndedWords(device: String?) -> String {
    "its run exited on \(device ?? "that desktop")"
  }

  /// The first mint, bounded by the step deadline. The door's own call timeout
  /// covers a door that has answered hello; `call` first waits for that hello,
  /// and a door that is re-dialing waits as long as the re-dial takes. The
  /// door's call cannot be cancelled, so it is raced rather than awaited: a
  /// late answer lands on a resumed continuation and is dropped.
  private func mint(for session: String, within limit: Duration) async throws
    -> RoutedTerminalTicket
  {
    try await withCheckedThrowingContinuation { continuation in
      let once = MintOnce(continuation)
      let timer = Task { @MainActor in
        try? await Task.sleep(for: limit)
        guard !Task.isCancelled else { return }
        once.resume(with: .failure(MintDeadline()))
      }
      Task { @MainActor [weak self] in
        defer { timer.cancel() }
        guard let self else {
          once.resume(with: .failure(CancellationError()))
          return
        }
        do {
          once.resume(with: .success(try await self.mintTicket(for: session)))
        } catch {
          once.resume(with: .failure(error))
        }
      }
    }
  }

  /// The user's own act — the one legitimate road back to `idle`.
  ///
  /// On SHARED lanes the session is PARKED, not dropped (`park`); otherwise
  /// the attachment's own lane closes.
  public func detach() async {
    log("detached session=\(sessionID ?? "-")")
    if park() { return }
    attachTask?.cancel()
    attachTask = nil
    await teardown(resetPhase: true, letGo: sessionID)
  }

  /// Park the session on its SHARED lane, at once: the cell detaches the view
  /// (demand `none`) — which also releases the geometry seat — while the
  /// activation and its grant stay and the scene keeps its picture, so
  /// attaching it again is a demand on legs already up. `false` with no
  /// shared lane carrying the session, and nothing is changed.
  @discardableResult
  public func park() -> Bool {
    guard !ownsLanes, let client, let sessionID, client.sessions[sessionID] != nil else {
      return false
    }
    attachTask?.cancel()
    attachTask = nil
    client.declare(demand: .none, for: sessionID)
    noticeTask?.cancel()
    noticeTask = nil
    notice = nil
    localPhase = .idle
    log("parked on its lane session=\(sessionID)")
    return true
  }

  /// Let this attachment's session go for good — the card's cache evicted it:
  /// its lane keeps its legs for the others, and the cell lets the activation
  /// lapse (`RoutedTerminalClient.forget`).
  public func release() {
    attachID &+= 1
    attachTask?.cancel()
    attachTask = nil
    letGo(sessionID)
    client = nil
    unbind()
    localPhase = .idle
    sessionID = nil
  }

  /// A shared lane carries this session: point its frames at THIS attachment,
  /// and ask the cell for the view again — demand `none` then `live`, so the
  /// cell re-attaches the view and SEEDS it (a view left live would send only
  /// deltas onto a scene this sink may never have held). `false` when the lane's
  /// activation is not whole, and only a fresh attach can bring it back.
  private func resume(on client: RoutedTerminalClient, sessionID: String) -> Bool {
    guard client.sessions[sessionID]?.bothLegsAttached == true else { return false }
    let binding = bind()
    let sink = makeSink(binding: binding)
    lanes.adopt(sessionID, sink: sink, reticket: reticket(binding: binding))
    self.sink = sink
    self.client = client
    localPhase = nil
    client.requestReseed(for: sessionID)
    client.declare(demand: .none, for: sessionID)
    client.declare(demand: .live, for: sessionID)
    takeSeat()
    log("resumed on its lane session=\(sessionID) — no mint, no dial")
    return true
  }

  /// This attachment's frames: its scene, behind the identity and lineage rules.
  private func makeSink(binding: UInt64) -> RoutedTerminalFrameSink {
    RoutedTerminalFrameSink(
      render: { [weak self] frame in
        guard let self, binding == self.binding else { return false }
        return self.scene.render(frame)
      },
      identityFailed: { [weak self] _, reason in
        guard let self, binding == self.binding else { return }
        // The cell stamped a frame with handles it did not declare. There is no
        // repair for that inside the activation — the scene on screen may be
        // another session's — so the attachment fails with the reason, loudly.
        self.localPhase = .failed(reason)
      },
      activationEnded: { [weak self] _, reason in
        guard let self, binding == self.binding else { return }
        self.note("the scene stopped advancing — \(reason)")
      })
  }

  /// Every leg replacement is a FRESH MINT: the cell consumes a transport
  /// grant's `(nonce, channel)` at first use, so a re-dial with the ticket in
  /// hand can only ever earn `GRANT_NONCE_REPLAYED`. The client owns the
  /// backoff; this closure owns the door.
  ///
  /// And the FACE (TM-r3, K-M2). The client retries a refused mint forever
  /// under the state `.reconnecting`, which the card renders as "connecting
  /// over the mesh…" — so a desktop that had stopped publishing its doors read
  /// as a slow connection: no banner, no reason, no end. `doorRefusal` was being
  /// kept and shown to nobody, because the banner only consults it in the
  /// `.refused` phase and only the FIRST attach could set that. The door's
  /// sentence is the whole answer here exactly as it is on the first attach, so
  /// it reaches the card the same way.
  private func reticket(binding: UInt64) -> TerminalLanes.Reticket {
    { [weak self] session in
      guard let self else { throw CancellationError() }
      do {
        let ticket = try await self.mintTicket(for: session)
        guard binding == self.binding else { throw CancellationError() }
        // A mint that came back retires the refusal an earlier one left on the
        // card: the client is this session's authority again.
        if case .refused = self.localPhase { self.localPhase = nil }
        return ticket
      } catch {
        guard binding == self.binding else { throw error }
        self.localPhase = .refused(self.doorRefusal ?? Self.shortReason(error))
        throw error
      }
    }
  }

  /// Let one session go: lanes made for this attachment close with it (the
  /// per-tap client's old end); a shared lane forgets the session and keeps
  /// its legs for the others.
  private func letGo(_ session: String?) {
    if ownsLanes {
      lanes.closeAll()
      return
    }
    guard let session else { return }
    lanes.client(holding: session)?.forget(sessionId: session)
    lanes.release(session)
  }

  /// A new binding for the sink about to be installed: every closure made for
  /// an earlier one belongs to nobody from here on.
  private func bind() -> UInt64 {
    binding &+= 1
    return binding
  }

  /// Let the sink go, and every closure made for it with it.
  private func unbind() {
    sink = nil
    binding &+= 1
  }

  private func open(_ ticket: RoutedTerminalTicket, sessionID: String) {
    let binding = bind()
    let sink = makeSink(binding: binding)
    // The cell's lane — opened by its first ticket, carrying every session the
    // phone shows on that cell — with this session's frames routed to `sink`.
    // P0-C's renewal, the leg budget and fix8's step deadline are the lane's.
    let client = lanes.lane(
      for: ticket, sessionId: sessionID, sink: sink, reticket: reticket(binding: binding))
    self.sink = sink
    self.client = client
    self.sessionID = sessionID
    localPhase = nil
    client.open(ticket)
    // DS-4b — presented on an active app: the pane has FOCUS, and the pane
    // focused last takes the seat. The client holds the take until the control
    // leg attaches, with whatever grid the surface has measured by then.
    takeSeat()
    // `open` is synchronous and can refuse before a socket is spent — a grant
    // outside its window earns a SILENT `1008` at the real door, so the client
    // names it here rather than dialing to be told nothing. A refusal it cannot
    // act on by itself (`needsTicket` with nowhere to go) must reach a face, or
    // the card would say "connecting…" over a client that has stopped.
    if client.needsTicket {
      localPhase = .refused(client.lastRefusal ?? "this desktop's ticket could not be used")
    }
  }

  /// The client's renewal, over the door: the raw `{attachGrant}` answer read
  /// into the grant the client carries to the cell. Nothing else is read — the
  /// grant is the cell's to verify.
  static func renewalProvider(
    _ door: RenewalDoor?
  ) -> (@MainActor @Sendable (RoutedRenewal) async throws -> RoutedGrant)? {
    guard let door else { return nil }
    return { request in
      let answer = try await door(request.sessionId, request.expectGeneration, request.requestId)
      guard let grant = answer["attachGrant"] else {
        throw FieldProductError(
          kind: "INTERNAL", message: "terminal.renewAttach answered without an attach grant",
          retryable: true)
      }
      return try RoutedGrant(json: grant)
    }
  }

  /// One mint over the product door, with its refusal kept in the door's own
  /// words. The daemon's `UNAVAILABLE {service, state}` is turned into a
  /// sentence here — the honest degraded face the corpus asks for — and every
  /// other error keeps whatever the door said.
  private func mintTicket(for session: String) async throws -> RoutedTerminalTicket {
    do {
      let answer = try await lanes.door(session)
      let ticket = try RoutedTerminalTicket(json: answer)
      doorRefusal = nil
      return ticket
    } catch let error as FieldProductError {
      doorRefusal = Self.doorWords(error, device: deviceName)
      throw error
    } catch {
      doorRefusal = Self.shortReason(error)
      throw error
    }
  }

  private func teardown(resetPhase: Bool, letGo session: String?) async {
    noticeTask?.cancel()
    noticeTask = nil
    // A lane of this attachment's own always closes (the per-tap client's end);
    // a shared lane forgets only the session this attachment is letting go.
    if ownsLanes { lanes.closeAll() } else { letGo(session) }
    client = nil
    unbind()
    notice = nil
    if resetPhase {
      localPhase = .idle
      sessionID = nil
      doorRefusal = nil
    }
  }

  // MARK: - Viewport

  /// Record the pane's geometry.
  ///
  /// It does NOT resize the remote terminal, and that is the grant's doing
  /// rather than an omission: a tailnet self peer is minted `[input, read]`
  /// (TM-D3), so this client holds no geometry right and `claimGeometry` would
  /// be refused at the cell. The number is kept because the input card and the
  /// accessibility summary both lay out against it, and because the day a
  /// phone is granted `geometry` this is the value it would claim with.
  /// Corrected 2026-09-30 (DS-4): that day came for the GRANT — a self peer is
  /// minted `[geometry, input, read]` — but not for this kit, which has no
  /// lease verb to claim with until DS-4b; so the sentence above is now an
  /// omission, named.
  /// Corrected 2026-10-01 (DS-4b): the omission is closed. The grid is handed
  /// to the client, which RESIZES the seat while this pane holds it and does
  /// nothing once another pane has taken it (a mere resize never claims), and
  /// a take still waiting for its leg goes with the newest grid.
  public func setViewport(cols: UInt16, rows: UInt16) {
    let next = GhostteaTerminalGridSize(columns: cols, rows: rows)
    // The grid is the view's bounds less its insets — its safe area included
    // (ghosttea's `includesSafeAreaInsets`) — so the line carries both: a
    // grid smaller than the pane it is drawn in says which one shrank it.
    if next != grid, let view = scene.view {
      log(
        "grid \(cols)×\(rows) — the view \(Int(view.bounds.height)) pt tall, its safe area "
          + "\(Int(view.safeAreaInsets.bottom)) pt at the bottom session=\(sessionID ?? "-")")
    }
    grid = next
    guard let client, let sessionID else { return }
    client.resizeGeometry(cols: Int(cols), rows: Int(rows), for: sessionID)
  }

  /// DS-4b — this pane gained focus: take the seat, ONCE. The client owns the
  /// one retry the cell's announcement may earn; the host never retries.
  private func takeSeat() {
    guard let client, let sessionID else { return }
    client.takeGeometry(cols: Int(grid.columns), rows: Int(grid.rows), for: sessionID)
  }

  /// Ask for a fresh authoritative frame (the surface calls this when a frame
  /// would not decode).
  public func requestFullRefresh() {
    guard let client, let sessionID else { return }
    client.requestReseed(for: sessionID)
  }

  // MARK: - Input

  /// Text from the card's own affordances (a command bar, a paste action).
  public func send(text: String) {
    forward { $0.send(text: text, to: $1) }
  }

  /// The Metal view's software keyboard events, converted exactly as the
  /// reference converts them — after the card's latch has had its say.
  public func handleSoftwareInput(_ event: GhostteaSoftwareInputEvent) {
    // --- IOS-5b: Live mode's latch ------------------------------------------
    if let stroke = latchedKeystroke(for: event) {
      press(stroke)
      return
    }
    // --- end IOS-5b ---------------------------------------------------------
    deliverSoftwareInput(event)
  }

  // --- IOS-5b ---------------------------------------------------------------
  /// Ask the card what the next key carries, and shape the event with it.
  ///
  /// The closure is CONSUMING: calling it spends an armed latch (a locked one
  /// survives, which is the point of locking), so it is called exactly once per
  /// event and never for a paste — a block of text is not the key an arm was
  /// meant for, and asking would spend the arm on it.
  private func latchedKeystroke(for event: GhostteaSoftwareInputEvent) -> TerminalKeystroke? {
    guard let softwareInputLatch else { return nil }
    if case .paste = event { return nil }
    return SoftwareInputLatch.keystroke(for: event, modifiers: softwareInputLatch())
  }

  /// The original conversion, unlatched — what `sendDraft` and `typeText` use.
  ///
  /// The card's own verbs must NOT re-enter the latch: the model already spent
  /// it when the user tapped the key (`tapKey`, `interceptCharacter`), and a
  /// second consumption here would put Ctrl on the Enter that follows a Send.
  private func deliverSoftwareInput(_ event: GhostteaSoftwareInputEvent) {
    switch event {
    case .text(let text): forward { $0.send(text: text, to: $1) }
    case .enter: forward { $0.send(text: "\r", to: $1) }
    case .deleteBackward:
      let key = RoutedKeyInput(key: "Backspace", code: "Backspace")
      forward { $0.send(key: key, to: $1) }
    case .paste(let text): forward { $0.paste(text, to: $1) }
    case .key(let key): _ = handleHardwareKey(key)
    }
  }
  // --- end IOS-5b -----------------------------------------------------------

  /// A hardware key. Not gated on `acceptsInput` here: the client holds the
  /// same gate one layer down (the cell DROPS input it does not allow, with an
  /// audit line and no reply, so a client that sent anyway would be typing into
  /// a silence), and this is where the user learns their keystroke went
  /// nowhere.
  @discardableResult
  public func handleHardwareKey(_ event: GhostteaHardwareKeyEvent) -> Bool {
    guard client != nil else { return false }
    let modifiers = event.modifiers
    let key = RoutedKeyInput(
      type: event.action == .up ? .up : .down,
      key: event.text.isEmpty ? event.code : event.text,
      code: event.code,
      repeatKey: event.action == .repeated,
      shift: modifiers.contains(.shift),
      control: modifiers.contains(.control),
      alt: modifiers.contains(.option),
      meta: modifiers.contains(.command),
      unshiftedCodepoint: event.unshiftedCodepoint)
    forward { $0.send(key: key, to: $1) }
    return true
  }

  /// Pointer and scroll gestures are viewport-shaped, not keystroke-shaped:
  /// they arrive continuously and a rejection cue would strobe, so they drop
  /// quietly when input is not accepted.
  public func handleMouse(_ event: GhostteaTerminalMouseEvent) {
    guard acceptsInput else { return }
    let modifiers = event.modifiers
    let mouse = RoutedMouseInput(
      action: Self.mouseAction(event.action),
      button: event.button.rawValue,
      x: event.x,
      y: event.y,
      screenWidth: event.screenWidth,
      screenHeight: event.screenHeight,
      cellWidth: event.cellWidth,
      cellHeight: event.cellHeight,
      paddingLeft: event.paddingLeft,
      paddingTop: event.paddingTop,
      shift: modifiers.contains(.shift),
      control: modifiers.contains(.control),
      alt: modifiers.contains(.option),
      meta: modifiers.contains(.command))
    // A non-finite coordinate is refused by the cell's own reader before it can
    // reach the engine; dropping it here costs a message instead of an audit.
    guard mouse.isFinite else { return }
    forward { $0.send(mouse: mouse, to: $1) }
  }

  public func handleScroll(rows: Int) {
    guard rows != 0, acceptsInput else { return }
    forward { $0.scroll(rows: rows, for: $1) }
  }

  /// The keyboard is coming up: put the view back on the bottom, where the
  /// prompt is (James, 2026-10-17: "when keyboard is up, it suppose to scroll
  /// the terminal content all the way botton so i can input"). Asked at the
  /// INTENT, before the keyboard's resize lands — the input that resize holds
  /// cannot drop it — and a view already at the bottom moves nowhere. The
  /// viewport is the session's, so the desktop's pane follows it down too.
  public func followBottom() {
    guard acceptsInput, let client, let sessionID else { return }
    client.scrollToBottom(for: sessionID)
  }

  // MARK: - The input card's verbs (IOS-5a)

  /// Every card verb goes out AFTER whatever the system keyboard is still
  /// composing (pinyin, kana): sent while the view held marked text, Enter ran
  /// the line and "你好" arrived after it (the input audit's H, 2026-10-17).
  /// ghosttea's own accessory row commits first; the card's verbs do the same,
  /// through the view's public `unmarkText`, which sends the composed text.
  private func commitComposition() {
    guard let view = scene.view, view.markedTextRange != nil else { return }
    view.unmarkText()
  }

  /// One rail key. A stroke this layout cannot encode is a no-op and says
  /// nothing: the rail only offers keys it can send, so an unencodable one is
  /// a programming error rather than news for the user.
  public func press(_ stroke: TerminalKeystroke) {
    guard let event = stroke.ghostteaEvent() else { return }
    commitComposition()
    _ = handleHardwareKey(event)
  }

  /// Send the composer's draft: a paste, then Enter.
  ///
  /// The paste op is what makes a three-line draft arrive as ONE input rather
  /// than three commands — the cell encodes it through the session's own
  /// terminal model, which wraps it in the bracketed-paste sequences exactly
  /// when the program on the far end has enabled them (DECSET 2004).
  ///
  /// An empty draft is Enter alone, which is the whole point of a Send that is
  /// never disabled (D-i6). The draft is NOT trimmed.
  public func sendDraft(_ text: String) {
    commitComposition()
    if !text.isEmpty { deliverSoftwareInput(.paste(text)) }
    deliverSoftwareInput(.enter)
  }

  /// Literal text with no Enter behind it — the keypad's symbol keys and the
  /// chips that type an answer without committing it.
  public func typeText(_ text: String) {
    guard !text.isEmpty else { return }
    commitComposition()
    deliverSoftwareInput(.text(text))
  }

  // --- IOS-5c
  /// One block of text as a paste, with NO Enter behind it.
  public func pasteText(_ text: String) {
    guard !text.isEmpty else { return }
    commitComposition()
    handleSoftwareInput(.paste(text))
  }
  // --- end IOS-5c

  // MARK: - Lifecycle nudges

  /// Mint now rather than waiting out the client's backoff — the banner's one
  /// act while a leg is being replaced.
  public func retryNow() {
    guard let sessionID else { return }
    attach(
      sessionID: sessionID, cols: grid.columns, rows: grid.rows, deviceName: deviceName)
  }

  /// §8.2: coming back to the foreground re-attaches at once rather than
  /// waiting for a schedule — and only a SUSPENDED attachment has anything to
  /// resume: the background closed its lanes, and the re-attach takes the seat
  /// itself (`open`). A session that only went inactive (Control Center, a
  /// notification, a call banner, Face ID) kept its legs and its scene, so
  /// there is nothing to refresh and no focus to retake. Corrected 2026-10-17
  /// (the sweep's P3): this re-snapshot asked the cell for nothing (D2) and
  /// held input on an idle prompt until output moved, and its take re-took the
  /// seat from a desktop the person never left.
  public func resumeFromForeground() {
    guard let sessionID, case .suspended = phase else { return }
    log("back in the foreground session=\(sessionID)")
    attach(sessionID: sessionID, cols: grid.columns, rows: grid.rows, deviceName: deviceName)
  }

  /// §8.2's other half: an orderly suspend, not two sockets left to rot.
  ///
  /// The legs CLOSE rather than idling. iOS does not keep a WebSocket alive
  /// behind a backgrounded app, and the cell closes a leg that misses its
  /// heartbeat deadline (`4004`) — so closing deliberately is the difference
  /// between a state this phone chose and one it discovered later.
  ///
  /// An attach still on its way counts too (the second audit's B4): one waiting
  /// on its ticket has no client yet, and used to be left to finish behind the
  /// suspended app and dial anyway. Its generation is retired with the task, so
  /// a late answer lands on nobody. Every lane closes and leaves the lanes —
  /// on shared lanes that is every card's, which iOS would close regardless —
  /// so the next attach opens fresh ones rather than finding a closed client.
  public func suspendForBackground() {
    guard client != nil || attachTask != nil else { return }
    log("suspended in the background session=\(sessionID ?? "-")")
    attachID &+= 1
    attachTask?.cancel()
    attachTask = nil
    lanes.closeAll()
    client = nil
    unbind()
    localPhase = .suspended("paused in the background")
  }

  // MARK: - Appearance

  /// The device half of the look, applied live.
  ///
  /// Under T there is no replica runtime to rebuild and nothing that can refuse
  /// an edit: the renderer takes the configuration on its next update, and the
  /// GLYPHS are the cell's either way. Which is why the old
  /// `appearanceFailure` retired with the replica that used to raise it — there
  /// is no longer a component here that can decline a change.
  public func apply(appearance next: TerminalAppearance) {
    appearance = next
    presentation = presentationConfig(for: next)
  }

  // MARK: - Plumbing

  /// Every input verb funnels through one gate, so "who may type" is answered
  /// in exactly one place and a declined keystroke always says so.
  private func forward(_ send: (RoutedTerminalClient, String) -> Void) {
    guard let client, let sessionID else { return }
    guard acceptsInput else {
      note(inputRefusalNote)
      return
    }
    send(client, sessionID)
  }

  /// Why this keystroke went nowhere, in the most specific words available.
  private var inputRefusalNote: String {
    guard let client, let sessionID, let session = client.sessions[sessionID] else {
      return "not attached — nothing to type into yet"
    }
    if !session.rights.contains(.input) {
      return "view only — this desktop granted read without input"
    }
    if !session.inputRightLive {
      // It said "the write grant is expiring — renewing it" until TM-r3, when
      // nothing renewed it, and a sentence promising work that is not happening
      // is the one thing the voice rule forbids outright (DESIGN.md §9 — never
      // overstate what we know). P0-C (2026-09-24) wired the renewal, so this
      // line is reached only when the renewal FAILED — and then it is still
      // true that the right is gone and a reattach is what gets it back.
      return "the write grant has run out — reattach to type again"
    }
    if !session.presentationReady {
      return "waiting for the terminal to catch up"
    }
    return "the desktop has paused input for this viewer"
  }

  /// A note that expires: a stale line about a keystroke would sit on top of a
  /// real status the terminal wanted to say.
  private func note(_ line: String) {
    notice = line
    noticeTask?.cancel()
    noticeTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(4))
      guard !Task.isCancelled else { return }
      guard let self, self.notice == line else { return }
      self.notice = nil
    }
  }

  // MARK: - Pure mappings (pinned by tests)

  /// The client's state → the card's phase. A session that ENDED outranks the
  /// set's state: the connection may be perfectly healthy and the thing the
  /// card is about gone.
  nonisolated static func phase(
    for state: RoutedTerminalClient.State, session: RoutedSessionState?, presented: Bool = false,
    deadline: Duration = stepDeadline
  ) -> TerminalPhase {
    if let session, case .ended(let reason) = session.control { return .ended(reason) }
    switch state {
    case .off: return .idle
    case .connecting, .ready: return .connecting
    case .attached:
      // Attached is not presenting. A session whose legs are up but whose first
      // frame has not landed is still connecting, and saying `live` over it
      // would be the blank this design refuses. Past that first frame it stays
      // live: a reseed holds input until the scene catches up, and reading it
      // as `connecting` hid the input card and raised a status line on every
      // resize, each of which resized the pane again (James, 2026-10-17: "the
      // entire tab just jumps up down like crazy").
      if session?.presentationReady == true { return .live }
      guard presented else { return .connecting }
      // …but a cell that STOPPED presenting this viewer is not catching up: its
      // pump has ended and nothing restarts it, so calling that live was a
      // frozen screen with no word (the scroll audit, 2026-10-17). It is said,
      // and RETRY is a fresh activation.
      if case .stopped(let reason) = session?.status?.presentation {
        return .suspended("this screen stopped updating — the desktop said \(reason)")
      }
      return .live
    case .reconnecting, .staleRoute: return .connecting
    case .refused(let code): return .refused(code)
    case .failed(let reason): return .failed(reason)
    case .stalled(let step): return .stalled(stallWords(step, after: deadline))
    }
  }

  /// fix8 — where an attach stopped, as the banner's second line: what was
  /// asked of whom, what never came, and after how long (DESIGN.md §8, the
  /// phone's session card).
  nonisolated static func stallWords(
    _ step: RoutedTerminalClient.AttachStep, after deadline: Duration
  ) -> String {
    let what =
      switch step {
      case .ticket: "the ticket was asked for and never came back"
      case .slot: "this phone's last terminal never let go of its connection"
      case .dial: "the dial over the mesh got no answer"
      case .control: "the terminal took the dial but never attached the session"
      case .frames: "the session attached but its screen never did"
      case .firstFrame: "the session attached but sent no screen"
      }
    return "\(what) — stopped after \(seconds(deadline)) s"
  }

  /// Whole seconds, at least one: a deadline is said as a number a person
  /// reads, and "0 s" would not be one.
  nonisolated static func seconds(_ duration: Duration) -> Int64 {
    let parts = duration.components
    return max(1, parts.seconds + (parts.attoseconds > 0 ? 1 : 0))
  }

  /// The phase → the banner. Pure, so every sentence a person can be shown is
  /// decidable without a simulator.
  nonisolated static func banner(
    for phase: TerminalPhase, device: String?, doorRefusal: String?,
    writeGrantExpired: Bool = false
  ) -> TerminalBanner? {
    let who = device ?? "that desktop"
    switch phase {
    case .idle:
      return nil
    case .live:
      // A live session whose WRITE grant has run out (TM-r3, K-M1). The scene
      // is still advancing, so this does NOT cool the terminal — it is the one
      // banner about an act the person can take rather than about a state they
      // have to wait out. `retryNow` is that act: it re-mints and re-attaches,
      // which is what a renewal would have done without the round trip.
      guard writeGrantExpired else { return nil }
      return TerminalBanner(
        title: "input has closed — \(who) is still showing this session but not taking keystrokes",
        detail: "the write grant ran out. reattach to type again.",
        actions: [.retryNow, .backToTheField], coolsTerminal: false)
    case .connecting:
      return nil
    case .suspended(let why):
      return TerminalBanner(
        title: why, detail: "this session is still running on \(who).",
        actions: [.retryNow, .backToTheField], coolsTerminal: true)
    case .refused(let words):
      return TerminalBanner(
        title: doorRefusal ?? words,
        detail: doorRefusal == nil ? "\(who) turned this attach down." : nil,
        actions: [.retryNow, .backToTheField], coolsTerminal: true)
    case .ended(let why):
      return TerminalBanner(
        title: "this session ended — \(why)", detail: nil,
        actions: [.backToTheField], coolsTerminal: true)
    case .failed(let why):
      return TerminalBanner(
        title: "the connection failed — \(why)", detail: nil,
        actions: [.retryNow, .backToTheField], coolsTerminal: true)
    case .stalled(let detail):
      // fix8 — the desktop by name, then the step: "couldn't reach studio's
      // terminal" over a code, and RETRY is a fresh attach, not a wait.
      return TerminalBanner(
        title: "couldn't reach \(who)'s terminal", detail: detail,
        actions: [.retryNow, .backToTheField], coolsTerminal: true)
    }
  }

  /// The daemon's refusal as a sentence a person can act on.
  ///
  /// `doors_not_published` is the one this slice exists to say out loud: the
  /// desktop is there, fieldd answered, and it is not carrying its terminal
  /// doors onto the tailnet. `transport_not_landed` is its sibling and a
  /// DIFFERENT fact — that cell serves no T1 doors at all — and the two are
  /// never folded into one shrug.
  nonisolated static func doorWords(_ error: FieldProductError, device: String?) -> String {
    let who = device ?? "that desktop"
    guard let unavailable = error.unavailable, unavailable.service == "terminal" else {
      return error.message.isEmpty ? error.kind : error.message
    }
    switch unavailable.state {
    case "doors_not_published":
      return "\(who) is not publishing its terminal doors on the tailnet"
    case "transport_not_landed":
      return "\(who) is serving this session without a routed door to dial"
    case "device_not_linked":
      // fieldd's TM-r10 refusal: `doorsFor` turns down a tailnet principal whose
      // `self` is not true rather than handing out its own loopback ticket — an
      // unlinked desktop saying it cannot vouch for the caller. The default arm
      // degraded it to "… cannot hand out a ticket — device_not_linked", which
      // is a state word rather than a sentence.
      //
      // It is the one refusal in this set a person can FIX, and the fix is on
      // the OTHER machine — which is why the act is named here rather than left
      // to the banner's `retryNow`, since retrying changes nothing until the
      // desktop is linked. The refusal is retryable for exactly that reason:
      // linking makes the same mint succeed.
      //
      // TOLERATED, NOT EXPECTED (2026-09-15, UA-P-1d). Under James's UA-P-D1
      // ruling an unlinked desktop is OFFLINE — no node, no serve, no store —
      // so a desktop that could answer this is one whose door should not have
      // been reachable at all. The sentence stays anyway: it is the honest
      // thing to say if one ever arrives, and a phone that dropped a refusal
      // because the other plane promised never to send it would be trusting a
      // promise instead of reading the wire.
      return
        "\(who) is not linked to an account yet, so it cannot tell who you are — "
        + "link it on the desktop"
    default:
      return "\(who) cannot hand out a ticket — \(unavailable.state)"
    }
  }

  nonisolated static func mouseAction(_ action: GhostteaMouseAction) -> RoutedMouseInput.Action {
    switch action {
    case .press: .press
    case .release: .release
    case .motion: .motion
    }
  }

  nonisolated static func shortReason(_ error: Error) -> String {
    let text = String(describing: error)
    return text.count > 120 ? String(text.prefix(117)) + "…" : text
  }
}

/// fix8 — the first mint outlived the step deadline.
private struct MintDeadline: Error {}

/// One resume of a mint's continuation, whichever of the answer and the
/// deadline comes first. Main-actor-bound: both racers run there.
@MainActor
private final class MintOnce {
  private var continuation: CheckedContinuation<RoutedTerminalTicket, any Error>?

  init(_ continuation: CheckedContinuation<RoutedTerminalTicket, any Error>) {
    self.continuation = continuation
  }

  func resume(with result: Result<RoutedTerminalTicket, any Error>) {
    let pending = continuation
    continuation = nil
    pending?.resume(with: result)
  }
}
