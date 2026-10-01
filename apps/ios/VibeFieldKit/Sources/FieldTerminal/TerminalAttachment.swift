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

  /// The last rendered TRF1 frame, fed to `TerminalSurface`. The CELL's bytes,
  /// verbatim — nothing on this device re-encodes a frame any more.
  public private(set) var frame: Data?
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

  @ObservationIgnored private let door: TicketDoor
  @ObservationIgnored private let renewal: RenewalDoor?
  @ObservationIgnored private let transport: any RoutedLegTransport
  @ObservationIgnored private var client: RoutedTerminalClient?
  @ObservationIgnored private var sink: RoutedTerminalFrameSink?
  @ObservationIgnored private var sessionID: String?
  @ObservationIgnored private var deviceName: String?
  @ObservationIgnored private var attachTask: Task<Void, Never>?
  @ObservationIgnored private var noticeTask: Task<Void, Never>?
  @ObservationIgnored private var grid = GhostteaTerminalGridSize(columns: 80, rows: 24)
  /// Which attach a late answer belongs to — a superseded one must not repaint
  /// the new one. The client is rebuilt per attach, so this is the cheap check
  /// that a task started before the rebuild is not still writing to it.
  @ObservationIgnored private var attachID: UInt64 = 0

  public convenience init(
    session: @escaping SessionProvider,
    appearance: TerminalAppearance,
    door: @escaping TicketDoor,
    renewal: RenewalDoor? = nil
  ) {
    self.init(
      transport: URLSessionRoutedTransport(session: session), appearance: appearance, door: door,
      renewal: renewal)
  }

  /// The seam the tests hold: a transport with no sockets behind it. Every
  /// shipping caller takes the initializer above — this one exists so the
  /// attachment's own state machine can be driven without a server, which is
  /// the same split `RoutedTerminalClient` keeps one layer down.
  public init(
    transport: any RoutedLegTransport,
    appearance: TerminalAppearance,
    door: @escaping TicketDoor,
    renewal: RenewalDoor? = nil
  ) {
    self.transport = transport
    self.appearance = appearance
    self.door = door
    self.renewal = renewal
    presentation = presentationConfig(for: appearance)
  }

  // MARK: - What the card reads

  /// The session as ONE state. Computed rather than stored: the client is
  /// `@Observable`, so a view that reads this is tracking the client's own
  /// fields and there is no second copy of the truth to fall behind.
  public var phase: TerminalPhase {
    if let localPhase { return localPhase }
    guard let client, let sessionID else { return .idle }
    return Self.phase(for: client.state, session: client.sessions[sessionID])
  }

  /// Whether the CELL accepted this client's right to type. The grant asks; the
  /// cell answers, and a downgrade applies the moment it lands — so this is the
  /// accepted rights and never the requested ones.
  public var readWrite: Bool {
    guard let client, let sessionID else { return false }
    return client.sessions[sessionID]?.rights.contains(.input) ?? false
  }

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
    grid = GhostteaTerminalGridSize(columns: cols, rows: rows)
    self.sessionID = sessionID
    self.deviceName = deviceName
    localPhase = .connecting
    doorRefusal = nil
    notice = nil
    frame = nil
    attachID &+= 1
    let attach = attachID
    attachTask?.cancel()
    attachTask = Task { [weak self] in
      guard let self else { return }
      await self.teardown(resetPhase: false)
      guard attach == self.attachID, !Task.isCancelled else { return }
      // The FIRST ticket is awaited here rather than handed to the client,
      // because a mint that is refused has no socket to report itself on: the
      // door's sentence is the whole answer and it must reach a face.
      let ticket: RoutedTerminalTicket
      do {
        ticket = try await self.mintTicket(for: sessionID)
      } catch {
        guard attach == self.attachID, !Task.isCancelled else { return }
        self.localPhase = .refused(self.doorRefusal ?? Self.shortReason(error))
        return
      }
      guard attach == self.attachID, !Task.isCancelled else { return }
      self.open(ticket, sessionID: sessionID, attach: attach)
    }
  }

  /// The user's own act — the one legitimate road back to `idle`.
  public func detach() async {
    attachTask?.cancel()
    attachTask = nil
    await teardown(resetPhase: true)
  }

  private func open(_ ticket: RoutedTerminalTicket, sessionID: String, attach: UInt64) {
    let sink = RoutedTerminalFrameSink(
      publish: { [weak self] frame in
        guard let self, attach == self.attachID else { return }
        self.frame = frame
      },
      identityFailed: { [weak self] _, reason in
        guard let self, attach == self.attachID else { return }
        // The cell stamped a frame with handles it did not declare. There is no
        // repair for that inside the activation — the scene on screen may be
        // another session's — so the attachment fails with the reason, loudly.
        self.localPhase = .failed(reason)
      },
      activationEnded: { [weak self] _, reason in
        guard let self, attach == self.attachID else { return }
        self.note("the scene stopped advancing — \(reason)")
      })
    let client = RoutedTerminalClient(
      transport: transport,
      sink: sink,
      options: .init(
        // Every leg replacement is a FRESH MINT: the cell consumes a transport
        // grant's `(nonce, channel)` at first use, so a re-dial with the ticket
        // in hand can only ever earn `GRANT_NONCE_REPLAYED`. The client owns the
        // backoff; this closure owns the door.
        //
        // And the FACE (TM-r3, K-M2). The client retries a refused mint forever
        // under the state `.reconnecting`, which the card renders as "connecting
        // over the mesh…" — so a desktop that had stopped publishing its doors
        // read as a slow connection: no banner, no reason, no end. `doorRefusal`
        // was being kept and shown to nobody, because the banner only consults
        // it in the `.refused` phase and only the FIRST attach could set that.
        // The door's sentence is the whole answer here exactly as it is on the
        // first attach, so it reaches the card the same way.
        ticketProvider: { [weak self] session in
          guard let self else { throw CancellationError() }
          do {
            let ticket = try await self.mintTicket(for: session)
            guard attach == self.attachID else { throw CancellationError() }
            // A mint that came back retires the refusal an earlier one left on
            // the card: the client is this session's authority again.
            if case .refused = self.localPhase { self.localPhase = nil }
            return ticket
          } catch {
            guard attach == self.attachID else { throw error }
            self.localPhase = .refused(self.doorRefusal ?? Self.shortReason(error))
            throw error
          }
        },
        // P0-C — the grant is renewed ahead of the cell's input margin, so a
        // long session keeps both its input and its activation.
        renewalProvider: Self.renewalProvider(renewal),
        viewId: "phone-\(UUID().uuidString.lowercased())"))
    self.sink = sink
    self.client = client
    self.sessionID = sessionID
    localPhase = nil
    client.open(ticket)
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
      let answer = try await door(session)
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

  private func teardown(resetPhase: Bool) async {
    noticeTask?.cancel()
    noticeTask = nil
    client?.close()
    client = nil
    sink = nil
    frame = nil
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
  public func setViewport(cols: UInt16, rows: UInt16) {
    grid = GhostteaTerminalGridSize(columns: cols, rows: rows)
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

  // MARK: - The input card's verbs (IOS-5a)

  /// One rail key. A stroke this layout cannot encode is a no-op and says
  /// nothing: the rail only offers keys it can send, so an unencodable one is
  /// a programming error rather than news for the user.
  public func press(_ stroke: TerminalKeystroke) {
    guard let event = stroke.ghostteaEvent() else { return }
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
    if !text.isEmpty { deliverSoftwareInput(.paste(text)) }
    deliverSoftwareInput(.enter)
  }

  /// Literal text with no Enter behind it — the keypad's symbol keys and the
  /// chips that type an answer without committing it.
  public func typeText(_ text: String) {
    guard !text.isEmpty else { return }
    deliverSoftwareInput(.text(text))
  }

  // --- IOS-5c
  /// One block of text as a paste, with NO Enter behind it.
  public func pasteText(_ text: String) {
    guard !text.isEmpty else { return }
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
  /// waiting for a schedule. A session that never suspended only wants a fresh
  /// scene.
  public func resumeFromForeground() {
    guard let sessionID else { return }
    if case .suspended = phase {
      attach(sessionID: sessionID, cols: grid.columns, rows: grid.rows, deviceName: deviceName)
      return
    }
    requestFullRefresh()
  }

  /// §8.2's other half: an orderly suspend, not two sockets left to rot.
  ///
  /// The legs CLOSE rather than idling. iOS does not keep a WebSocket alive
  /// behind a backgrounded app, and the cell closes a leg that misses its
  /// heartbeat deadline (`4004`) — so closing deliberately is the difference
  /// between a state this phone chose and one it discovered later.
  public func suspendForBackground() {
    guard client != nil else { return }
    client?.close()
    client = nil
    sink = nil
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
    for state: RoutedTerminalClient.State, session: RoutedSessionState?
  ) -> TerminalPhase {
    if let session, case .ended(let reason) = session.control { return .ended(reason) }
    switch state {
    case .off: return .idle
    case .connecting, .ready: return .connecting
    case .attached:
      // Attached is not presenting. A session whose legs are up but whose first
      // frame has not landed is still connecting, and saying `live` over it
      // would be the blank this design refuses.
      return session?.presentationReady == true ? .live : .connecting
    case .reconnecting, .staleRoute: return .connecting
    case .refused(let code): return .refused(code)
    case .failed(let reason): return .failed(reason)
    }
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
