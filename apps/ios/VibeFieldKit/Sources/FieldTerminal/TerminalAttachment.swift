import Foundation
import GhostteaCore
import GhostteaTerminal
import GhostteaTruffle
import Observation

/// What the card renders. Every resting state carries its reason — nothing
/// silently becomes idle; `idle` is only ever the user's own detach.
public enum TerminalPhase: Equatable, Sendable {
  case idle
  case connecting
  case live
  case suspended(String)
  case ended(String)
  case failed(String)
}

/// One remote terminal session attached over the Truffle mesh, wrapped as
/// honest `@Observable` UI state — runtime + replica sink + dialer +
/// reconnect lifecycle behind one card-shaped face.
///
/// The lifecycle actor owns the connection, the heartbeat, and every sequence
/// space the wire orders; this model owns only the presentation of what it
/// reports (the reference's own division of labor).
@MainActor
@Observable
public final class TerminalAttachment {
  public private(set) var phase: TerminalPhase = .idle
  /// The last rendered TRF1 frame, fed to `TerminalSurface`.
  public private(set) var frame: Data?
  /// The host's verdict, from the snapshot — never assumed. No capability ⇒
  /// `false`, which the card says plainly (view-only), never as a disabled-
  /// looking lie.
  public private(set) var readWrite = false
  /// Whether THIS view holds the resize-control epoch.
  public private(set) var hasControl = false
  /// Live phase AND the host's read-write grant, composed upstream.
  public private(set) var acceptsInput = false
  /// A user-directed claim is in flight; the controller announcement answers.
  public private(set) var isClaimingControl = false
  /// The §8.1 outage banner, or `nil` when the session needs no explanation.
  /// Produced by upstream's own presenter — its grace window, resumed flash,
  /// and retry clocks are the kit's answer to "is this connection healthy",
  /// not a second one of ours.
  public private(set) var banner: GhostteaAttachmentBanner?
  /// The transient §4.3 note that a keystroke was dropped (never a queue
  /// receipt: the keystroke is gone). Expires on the presenter's clock.
  public private(set) var inputCue: GhostteaAttachmentInputCue?
  /// `inputCue`'s text, kept as the card's one-line convenience. Same
  /// vocabulary, same expiry — never a second answer.
  public private(set) var notice: String?
  public private(set) var presentation: GhostteaTerminalPresentationConfig
  /// What the terminal below is ACTUALLY wearing — not what was asked for. It
  /// only moves when the renderer takes the change, so it and `presentation`
  /// can never disagree about the same edit.
  public private(set) var appearance: TerminalAppearance
  /// A look the renderer would not take, said out loud and left standing.
  ///
  /// Durable on purpose: the condition it describes is durable. The settings
  /// sheet keeps showing the value the user chose (that is their preference,
  /// and every future attach is seeded from it) while this terminal keeps
  /// rendering the old one, and an expiring cue would let the disagreement
  /// outlive its own explanation. Cleared by the next edit that lands, and by
  /// teardown — a new attachment builds its runtime from the current
  /// appearance, so it starts with nothing to disagree about.
  public private(set) var appearanceFailure: String?

  @ObservationIgnored private let directory: GhostteaTrufflePeerDirectory
  /// The client half of the host's mirror-write secret, riding on the
  /// lifecycle init and re-presented on every re-dial. `nil` ⇒ the host will
  /// answer view-only, which is the honest default.
  @ObservationIgnored private let accessToken: String?
  /// The stable identity this client's pane is known by across re-dials.
  @ObservationIgnored private let localViewID = UUID().uuidString

  @ObservationIgnored private var lifecycle: GhostteaAttachmentLifecycle?
  @ObservationIgnored private var replicaSink: GhostteaAttachmentReplicaSink?
  /// Upstream's banner presenter — pure over a caller-supplied `nowMs`, so
  /// every published answer is stamped from one clock here.
  @ObservationIgnored private var bannerPresenter: GhostteaAttachmentBannerPresenter?
  @ObservationIgnored private var bannerRefreshTask: Task<Void, Never>?
  @ObservationIgnored private let clock = GhostteaSystemClock()
  /// Retained for the attachment's whole life: the sink's publisher renders
  /// through it, and the model must not be the one to let it die early.
  @ObservationIgnored private var attachmentRuntime: GhostteaRuntime?
  @ObservationIgnored private var attachTask: Task<Void, Never>?
  @ObservationIgnored private var eventsTask: Task<Void, Never>?
  @ObservationIgnored private var presentationTask: Task<Void, Never>?
  /// Which attach the sink callbacks and control answers belong to — a
  /// superseded attachment must not repaint the new one.
  @ObservationIgnored private var attachID: UInt64 = 0
  /// §4.2.2 extended past the actor's edge: a retired reader's frame can
  /// still be in flight, and only the token can say so.
  @ObservationIgnored private var appliedGeneration: UInt64 = 0
  /// Monotone forever — the sink admits presentations in generation order,
  /// and a fresh sink accepts anything above zero.
  @ObservationIgnored private var presentationGeneration: UInt64 = 0
  @ObservationIgnored private var nextSessionHandle: UInt64 = 1
  @ObservationIgnored private var currentPhase: GhostteaAttachmentPhase?
  /// Re-arms the reclaim per attachment: a resume invalidates this view's
  /// controller record (§4.2.1/§4.2.3 upstream).
  @ObservationIgnored private var attachmentGeneration: UInt64 = 0
  @ObservationIgnored private var lastControlClaim: GhostteaControlReclaimAttempt?
  /// One typing-driven claim per attachment generation (§10.3's "claims
  /// control before the first keystroke"), so keystrokes never strobe claims.
  @ObservationIgnored private var typingClaimGeneration: UInt64?
  @ObservationIgnored private var grid = GhostteaTerminalGridSize(columns: 80, rows: 24)

  public init(
    directory: GhostteaTrufflePeerDirectory,
    appearance: TerminalAppearance,
    accessToken: String?
  ) {
    self.directory = directory
    self.appearance = appearance
    self.accessToken = accessToken
    presentation = presentationConfig(for: appearance)
  }

  // MARK: - Attach / detach

  /// `deviceName` feeds the banner copy ("Connection to <name> lost…"); when
  /// discovery has one, pass it — the device id stands in honestly otherwise.
  public func attach(
    deviceID: String, sessionID: String, cols: UInt16, rows: UInt16,
    deviceName: String? = nil
  ) {
    // The DURABLE host reference, never a captured peer value: the reconnect
    // engine re-resolves the host on every dial, and a cached candidate keeps
    // dialing an address nobody is listening on.
    guard let host = try? GhostteaTruffleHostReference(deviceID: deviceID) else {
      phase = .failed("this desktop has not confirmed its identity yet")
      return
    }
    grid = GhostteaTerminalGridSize(columns: cols, rows: rows)
    phase = .connecting
    notice = nil
    attachTask?.cancel()
    attachTask = Task { [weak self] in
      guard let self else { return }
      await teardown(cancelPending: false)
      do {
        let localDeviceID = try await directory.localDeviceID()
        try Task.checkCancellation()
        // Sampled AFTER the last suspension point, so a settings edit made
        // while the directory lookup was in flight cannot seed the attachment
        // with stale device resources (the reference comments this exact
        // hazard). Everything below here is synchronous until commit.
        let presentation = presentationConfig(for: appearance)
        let runtime = try GhostteaRuntime(presentation: presentation)
        let handle = nextSessionHandle
        nextSessionHandle = handle == UInt64.max ? 1 : handle + 1
        attachID &+= 1
        let attach = attachID
        appliedGeneration = 0
        let sink = try GhostteaAttachmentReplicaSink(
          runtime: runtime,
          sessionHandle: handle,
          presentation: presentation,
          // The phone's theme wins; a remote host never restyles us (D-i9).
          // Shared-session semantics remain host-owned; colors, opacity,
          // padding, and shaders do not.
          presentationAuthority: .device
        ) { [weak self] event, token in
          await self?.handleSink(event, token: token, attach: attach)
        }
        let engine = GhostteaAttachmentLifecycle(
          sessionID: sessionID,
          localViewID: localViewID,
          cols: cols,
          rows: rows,
          dialer: GhostteaTruffleAttachmentDialer(
            directory: directory, host: host, localDeviceID: localDeviceID),
          sink: sink,
          // The mirror-write capability rides here and is re-presented on
          // every re-dial; without it the host's snapshot says view-only.
          accessToken: accessToken)
        guard !Task.isCancelled else {
          await engine.close()
          return
        }
        self.presentation = presentation
        attachmentRuntime = runtime
        lifecycle = engine
        replicaSink = sink
        bannerPresenter = GhostteaAttachmentBannerPresenter(deviceName: deviceName ?? deviceID)
        banner = nil
        inputCue = nil
        frame = nil
        readWrite = false
        hasControl = false
        acceptsInput = false
        isClaimingControl = false
        attachmentGeneration = 0
        lastControlClaim = nil
        typingClaimGeneration = nil
        eventsTask = Task { [weak self] in
          for await event in await engine.events() {
            guard let self, !Task.isCancelled else { return }
            self.handle(event, from: engine)
          }
        }
        await engine.start()
      } catch {
        if Task.isCancelled || error is CancellationError { return }
        phase = .failed("could not attach — \(Self.shortReason(error))")
      }
    }
  }

  /// The user's own act — the one legitimate road back to `idle`.
  public func detach() async {
    await teardown()
    phase = .idle
  }

  // MARK: - Viewport & control

  /// Records the pane's geometry first — a resize made during an outage still
  /// shapes the attach that ends it — then resizes if this view holds the
  /// control epoch, or runs the reclaim funnel if not. Claiming here
  /// unconditionally would take control from whichever view legitimately
  /// holds it; the funnel decides whether a claim is allowed at all.
  public func setViewport(cols: UInt16, rows: UInt16) {
    let value = GhostteaTerminalGridSize(columns: cols, rows: rows)
    guard value != grid else { return }
    grid = value
    guard let lifecycle else { return }
    let attach = attachID
    Task { [weak self] in
      await lifecycle.setViewport(cols: cols, rows: rows)
      guard await lifecycle.heldControlEpoch != nil else {
        guard let self, attach == self.attachID else { return }
        self.reevaluateReclaim()
        return
      }
      do {
        try await lifecycle.resize(cols: cols, rows: rows)
      } catch {
        // Control refusals are thrown to the caller and deliberately kept off
        // the event stream, so this is the only place they become visible.
        guard let self, attach == self.attachID else { return }
        self.note(error, action: "Resize")
      }
    }
  }

  /// A user-directed takeover, deliberately separate from automatic reclaim:
  /// it compare-and-swaps against the controller state this view actually
  /// observed and carries the current viewport in the claim.
  public func claimControl(cols: UInt16, rows: UInt16) {
    guard let lifecycle, !isClaimingControl else { return }
    grid = GhostteaTerminalGridSize(columns: cols, rows: rows)
    isClaimingControl = true
    let attach = attachID
    Task { [weak self] in
      do {
        try await lifecycle.claimControl(cols: cols, rows: rows)
      } catch {
        guard let self, attach == self.attachID else { return }
        self.isClaimingControl = false
        self.note(error, action: "Take control")
        return
      }
      // The write only submits the fenced request; the controller
      // announcement is its authoritative answer. Stay single-flight until it
      // arrives, but never strand the UI on a peer that won't answer.
      try? await Task.sleep(nanoseconds: 5_000_000_000)
      guard let self, attach == self.attachID, self.isClaimingControl else { return }
      self.isClaimingControl = false
      self.bannerPresenter?.noteCue("Control request timed out. Try again.", at: self.clock.nowMs)
      self.republishBanner()
    }
  }

  /// Act on what the current banner offered — the model half of each action;
  /// `browseSessions` also lands here as a detach, because navigation back to
  /// the field is the card's own act and `idle` is what it navigates from.
  public func perform(_ action: GhostteaAttachmentBannerAction) {
    switch action {
    case .retryNow:
      retryNow()
    case .resume:
      // Routed: a `.resume` banner only exists in suspended-by-app, where
      // this resumes for real.
      resumeFromForeground()
    case .browseSessions, .close:
      Task { await detach() }
    }
  }

  // MARK: - Input

  /// Text from the card's own affordances (a command bar, a paste action).
  public func send(text: String) {
    ensureControlForTyping()
    forward(.text(text))
  }

  /// The Metal view's software keyboard events, converted exactly as the
  /// reference converts them.
  public func handleSoftwareInput(_ event: GhostteaSoftwareInputEvent) {
    ensureControlForTyping()
    switch event {
    case .text(let text): forward(.text(text))
    case .enter: forward(.text("\r"))
    case .deleteBackward:
      forward(
        .key(
          GhostteaKeyInput(
            type: "down", key: "Backspace", code: "Backspace", repeat: false,
            shift: false, control: false, alt: false, meta: false,
            unshiftedCodepoint: 0)))
    case .paste(let text): forward(.paste(text))
    case .key(let key): _ = handleHardwareKey(key)
    }
  }

  /// Deliberately not gated on read-write or phase: the lifecycle rejects
  /// what it must and says so on the event stream, and a silent local drop
  /// would teach the user nothing (§4.3).
  public func handleHardwareKey(_ event: GhostteaHardwareKeyEvent) -> Bool {
    guard lifecycle != nil else { return false }
    ensureControlForTyping()
    let modifiers = event.modifiers
    forward(
      .key(
        GhostteaKeyInput(
          type: event.action == .up ? "up" : "down",
          key: event.text.isEmpty ? event.code : event.text,
          code: event.code,
          repeat: event.action == .repeated,
          shift: modifiers.contains(.shift),
          control: modifiers.contains(.control),
          alt: modifiers.contains(.option),
          meta: modifiers.contains(.command),
          unshiftedCodepoint: event.unshiftedCodepoint)))
    return true
  }

  /// Pointer and scroll gestures are viewport-shaped, not keystroke-shaped:
  /// they arrive continuously and a rejection cue would strobe, so they drop
  /// quietly when input is not accepted (the reference's §4.3 reading).
  public func handleMouse(_ event: GhostteaTerminalMouseEvent) {
    guard acceptsInput else { return }
    let modifiers = event.modifiers
    let action =
      switch event.action {
      case .press: "press"
      case .release: "release"
      case .motion: "motion"
      }
    forward(
      .mouse(
        GhostteaMouseInput(
          action: action, button: event.button.rawValue, x: event.x, y: event.y,
          screenWidth: event.screenWidth, screenHeight: event.screenHeight,
          cellWidth: event.cellWidth, cellHeight: event.cellHeight,
          paddingLeft: event.paddingLeft, paddingTop: event.paddingTop,
          shift: modifiers.contains(.shift), control: modifiers.contains(.control),
          alt: modifiers.contains(.option), meta: modifiers.contains(.command))))
  }

  public func handleScroll(rows: Int) {
    guard rows != 0, acceptsInput else { return }
    forward(.scroll(Int64(rows)))
  }

  // MARK: - Lifecycle nudges

  /// §8.2: foreground dials immediately rather than waiting out a schedule; a
  /// session that never suspended only wants a fresh frame.
  public func resumeFromForeground() {
    guard let lifecycle else { return }
    Task {
      if case .suspended(.suspendedByApp) = await lifecycle.currentSnapshot.phase {
        await lifecycle.resumeFromForeground()
      } else {
        await lifecycle.requestSnapshot()
      }
    }
  }

  /// §8.2's other half: an orderly suspend, not a connection left to rot —
  /// the heartbeat stops, the connection closes, and the reason is recorded.
  public func suspendForBackground() {
    guard let lifecycle else { return }
    Task { await lifecycle.suspendForBackground() }
  }

  /// Manual retry out of a suspended rest.
  public func retryNow() {
    guard let lifecycle else { return }
    Task { await lifecycle.retryNow() }
  }

  /// The engine stops dialing after its suspend window and then waits to be
  /// TOLD the host is back — nothing ends a `suspended(host absent)` rest on
  /// its own. The discovery poll that sees the host reappear calls this.
  public func noteHostReachable() {
    guard let lifecycle else { return }
    Task { await lifecycle.noteDeviceReachable() }
  }

  /// Ask for a fresh authoritative frame (the surface calls this when a frame
  /// would not decode; the card may on foreground).
  public func requestFullRefresh() {
    guard let lifecycle else { return }
    Task { await lifecycle.requestSnapshot() }
  }

  // MARK: - Appearance

  /// Live where it can be, honest where it can't: only a fontSize change
  /// builds a new runtime (and hands it to the live sink — no re-attach on
  /// the 0.9.x path); colors, opacity, and shaders reconfigure in place; a
  /// value-identical edit never touches the Metal or replica paths.
  public func apply(appearance next: TerminalAppearance) async {
    let target = presentationConfig(for: next)
    guard let sink = replicaSink else {
      // No live attachment: the next attach samples this after its own last
      // suspension point, so publishing the value is the whole job — and
      // there is no renderer that could refuse it.
      commitAppearance(next, presentation: target)
      return
    }
    guard !target.hasSameDevicePresentation(as: presentation) else {
      // Document identity may have moved; the renderer values did not.
      commitAppearance(next, presentation: target)
      return
    }
    let needsRuntime = target.requiresNewRuntime(comparedTo: presentation)
    let superseded = presentationTask
    superseded?.cancel()
    presentationGeneration &+= 1
    let generation = presentationGeneration
    let attach = attachID
    let task = Task { [weak self] in
      // A native reconfiguration is atomic but not itself cancellable: let an
      // in-flight predecessor leave the replica before applying its
      // successor, so generation order stays physical.
      await superseded?.value
      guard let self else { return }
      do {
        try Task.checkCancellation()
        let runtime = try await Self.makeRuntimeIfNeeded(needsRuntime, presentation: target)
        try Task.checkCancellation()
        guard attach == self.attachID, generation == self.presentationGeneration else { return }
        let result = try await sink.reconfigureDevicePresentation(
          target, runtime: runtime, generation: generation
        ) { [weak self] result in
          await self?.publishDevicePresentation(
            result, appearance: next, presentation: target, runtime: runtime,
            generation: generation, attach: attach)
        }
        // Upstream runs the `publish` callback ONLY on its applied path —
        // every `applied: false` returns before reaching it — so a refusal is
        // visible here or nowhere. Staleness is checked first because a
        // superseded edit has nothing to complain about: the newer one is the
        // truth and will commit its own words.
        guard attach == self.attachID, generation == self.presentationGeneration else { return }
        if !result.applied {
          self.appearanceFailure =
            "the terminal kept its previous look — the renderer declined the change"
        }
      } catch is CancellationError {
        return
      } catch {
        guard attach == self.attachID, generation == self.presentationGeneration else { return }
        self.appearanceFailure =
          "the terminal kept its previous look — \(Self.shortReason(error))"
      }
    }
    presentationTask = task
    await task.value
    // Still the newest generation ⇒ the stored task is still ours to clear.
    if generation == presentationGeneration {
      presentationTask = nil
    }
  }

  /// Runs from inside the sink's replica transaction. Publishing the config
  /// and its optional frame in one MainActor turn keeps new metrics and
  /// reshaped cells in one SwiftUI transaction, and stops a newer host frame
  /// from being overwritten by a delayed settings continuation.
  private func publishDevicePresentation(
    _ result: GhostteaDevicePresentationResult,
    appearance next: TerminalAppearance,
    presentation target: GhostteaTerminalPresentationConfig,
    runtime: GhostteaRuntime?,
    generation: UInt64,
    attach: UInt64
  ) {
    guard result.applied, attach == attachID, generation == presentationGeneration else { return }
    if let runtime { attachmentRuntime = runtime }
    // The commit point, and the ONLY one on the live path: publishing the
    // appearance up front left the model claiming a look the renderer had
    // refused, which a later attach would then seed itself from — a failure
    // that repaired its own evidence.
    commitAppearance(next, presentation: target)
    if let rendered = result.update?.effects.last(where: { $0.kind == .frameReady })?.payload {
      frame = rendered
    }
  }

  /// What the terminal is wearing, and the fact that nothing is outstanding
  /// about it — always together, because a stale failure beside a fresh
  /// appearance is exactly the disagreement this field exists to report.
  private func commitAppearance(
    _ next: TerminalAppearance, presentation target: GhostteaTerminalPresentationConfig
  ) {
    appearance = next
    presentation = target
    appearanceFailure = nil
  }

  nonisolated private static func makeRuntimeIfNeeded(
    _ needed: Bool,
    presentation: GhostteaTerminalPresentationConfig
  ) async throws -> GhostteaRuntime? {
    guard needed else { return nil }
    // Off the main actor: runtime creation shapes fonts through FFI.
    let creation = Task.detached(priority: .userInitiated) {
      try Task.checkCancellation()
      return try GhostteaRuntime(presentation: presentation)
    }
    return try await withTaskCancellationHandler {
      try await creation.value
    } onCancel: {
      creation.cancel()
    }
  }

  // MARK: - Event handling

  /// One lifecycle transition, or one refusal. A stream outlives the
  /// attachment it belongs to by however long the last event takes to arrive;
  /// a superseded engine must not repaint the new one.
  private func handle(
    _ event: GhostteaAttachmentLifecycleEvent,
    from engine: GhostteaAttachmentLifecycle
  ) {
    guard lifecycle === engine else { return }
    // The presenter ingests every event — it owns the outage vocabulary and
    // its timing (grace window, resumed flash, cue expiry); re-deriving that
    // from the phase enum would be a second answer to "is this healthy".
    bannerPresenter?.apply(event, at: clock.nowMs)
    switch event {
    case .state(let snapshot):
      readWrite = snapshot.readWrite
      acceptsInput = snapshot.acceptsInput
      currentPhase = snapshot.phase
      phase = Self.phase(for: snapshot.phase, exitCode: snapshot.exitCode)
      switch snapshot.phase {
      case .live:
        // A resume invalidates this view's controller record: every new
        // attachment re-arms the claim rather than trusting a once-per-
        // session flag.
        attachmentGeneration &+= 1
        reevaluateReclaim()
      case .opening, .synchronizing, .reconnecting, .suspended, .ended:
        isClaimingControl = false
      }
    case .inputRejected:
      // The presenter turned it into the cue; nothing else to record.
      break
    }
    republishBanner()
  }

  /// One applied frame, or one thing the frame said about the session.
  /// Nothing mutates before the event is proved current: the sink may belong
  /// to a previous attach entirely, and within one attach a retired reader's
  /// frame can still be in flight — the attach identity and the state
  /// generation are both checked.
  private func handleSink(
    _ event: GhostteaAttachmentSinkEvent,
    token: GhostteaAttachmentStateToken,
    attach: UInt64
  ) {
    guard attach == attachID, token.generation >= appliedGeneration else { return }
    appliedGeneration = token.generation
    switch event {
    case .frame(let update, _):
      if let rendered = update.effects.last(where: { $0.kind == .frameReady })?.payload {
        frame = rendered
      }
    case .controller:
      guard let lifecycle else { return }
      Task { [weak self] in
        // Asked rather than compared locally: against a legacy host the wire
        // view id rotates under the stable one this model knows, and only the
        // lifecycle knows which identity is currently attached.
        let held = await lifecycle.heldControlEpoch != nil
        let state = await lifecycle.currentControlState
        guard let self, attach == self.attachID else { return }
        self.hasControl = held
        self.isClaimingControl = false
        // A clear that arrives while this card is up is exactly when a
        // reclaim is due.
        self.maybeReclaim(observing: state, held: held)
      }
    case .activity:
      // The bubble field owns activity via discovery; the card does not
      // re-derive it from the attachment.
      break
    case .presentation:
      // Device-authoritative sinks consume host presentation events without
      // publishing them; kept as a defensive boundary exactly like the
      // reference.
      break
    }
  }

  // MARK: - Reclaim funnel

  /// §10.3: a readWrite attachment claims control before the first keystroke,
  /// so the host's PTY matches the grid this phone is rendering. One claim
  /// per attachment generation — an explicit Take Control tap is the user's
  /// escalation, not ours.
  private func ensureControlForTyping() {
    guard readWrite, !hasControl, !isClaimingControl,
      typingClaimGeneration != attachmentGeneration
    else { return }
    typingClaimGeneration = attachmentGeneration
    claimControl(cols: grid.columns, rows: grid.rows)
  }

  /// Read the controller state and run the funnel — used by the inputs that
  /// do not already hold an observation.
  private func reevaluateReclaim() {
    guard let lifecycle else { return }
    let attach = attachID
    Task { [weak self] in
      let held = await lifecycle.heldControlEpoch != nil
      let state = await lifecycle.currentControlState
      guard let self, attach == self.attachID else { return }
      self.maybeReclaim(observing: state, held: held)
    }
  }

  /// Upstream's own §4.2.3 funnel decides; the single-flight record keeps
  /// re-evaluation idempotent rather than chatty, and the funnel never fights
  /// another controller. `hasFocus` is `true` by construction: the phone
  /// renders exactly one terminal, and backgrounding suspends the whole
  /// lifecycle out of Live before focus could go stale.
  private func maybeReclaim(
    observing state: (controller: GhostteaControllerInfo?, revision: UInt64),
    held: Bool
  ) {
    guard let lifecycle, let currentPhase else { return }
    let observation: GhostteaControlObservation =
      if held {
        .selfHolds
      } else if state.controller == nil {
        // Revision 0 is the legacy "cannot report revisions" sentinel, which
        // nothing may compare-and-swap against.
        .noController(revision: state.revision == 0 ? nil : state.revision)
      } else {
        .otherHolds
      }
    let decision = GhostteaControlReclaim.decide(
      phase: currentPhase,
      readWrite: readWrite,
      hasFocus: true,
      observation: observation,
      attachmentGeneration: attachmentGeneration,
      lastClaim: lastControlClaim)
    guard case .claim(let expected) = decision else { return }
    lastControlClaim = GhostteaControlReclaimAttempt(
      attachmentGeneration: attachmentGeneration, expectedRevision: expected)
    let size = grid
    let attach = attachID
    Task { [weak self] in
      do {
        try await lifecycle.claimControl(cols: size.columns, rows: size.rows)
      } catch {
        guard let self, attach == self.attachID else { return }
        self.note(error, action: "Control")
      }
    }
  }

  // MARK: - Plumbing

  /// Refusals arrive on the event stream (§4.3's visible half), so the throw
  /// is deliberately dropped here.
  private func forward(_ operation: GhostteaTunnelInput) {
    guard let lifecycle else { return }
    Task { try? await lifecycle.send(operation) }
  }

  /// Surface a refusal the lifecycle threw rather than published. Keystroke
  /// rejections arrive on the event stream instead and must not come through
  /// here, or they would render twice. Raised as a presenter cue (the
  /// reference's noteControlFailure copy) so it expires on the kit's clock.
  private func note(_ error: Error, action: String) {
    guard let rejection = error as? GhostteaAttachmentInputRejection else { return }
    let message =
      switch rejection.reason {
      case .readOnly: "This session is read-only."
      case .writeFailed: "\(action) failed — reconnecting."
      case .noControl: "Take control before resizing the terminal."
      case .attachmentEnded: "\(action) did not finish before the connection dropped."
      case .notLive: "\(action) is unavailable while the session reconnects."
      }
    bannerPresenter?.noteCue(message, at: clock.nowMs)
    republishBanner()
  }

  /// Recompute what the banner and cue say now, and arm the next wake they
  /// need — the presenter reports its own deadline, so no free-running ticker.
  private func republishBanner() {
    bannerRefreshTask?.cancel()
    bannerRefreshTask = nil
    guard let bannerPresenter else {
      banner = nil
      inputCue = nil
      notice = nil
      return
    }
    let now = clock.nowMs
    banner = bannerPresenter.banner(at: now)
    inputCue = bannerPresenter.inputCue(at: now)
    notice = inputCue?.text
    guard let delay = bannerPresenter.nextRefreshMs(at: now) else { return }
    bannerRefreshTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: delay * 1_000_000)
      guard !Task.isCancelled else { return }
      self?.republishBanner()
    }
  }

  private func teardown(cancelPending: Bool = true) async {
    presentationTask?.cancel()
    presentationTask = nil
    presentationGeneration &+= 1
    if cancelPending {
      attachTask?.cancel()
      attachTask = nil
    }
    eventsTask?.cancel()
    eventsTask = nil
    bannerRefreshTask?.cancel()
    bannerRefreshTask = nil
    bannerPresenter = nil
    banner = nil
    inputCue = nil
    let current = lifecycle
    lifecycle = nil
    replicaSink = nil
    await current?.close()
    // Only after close: the sink's publisher renders through this runtime
    // until the lifecycle has let go.
    attachmentRuntime = nil
    frame = nil
    readWrite = false
    hasControl = false
    acceptsInput = false
    isClaimingControl = false
    currentPhase = nil
    attachmentGeneration = 0
    lastControlClaim = nil
    typingClaimGeneration = nil
    notice = nil
    // The next attachment builds its runtime from the current appearance, so
    // it starts with nothing to disagree about — carrying the old complaint
    // into it would be a stale claim about a renderer that never refused.
    appearanceFailure = nil
  }

  // MARK: - Pure mappings (pinned by tests)

  /// Upstream phase → card phase. `connecting` covers first dials and
  /// reconnects alike — someone is actively dialing in both — while
  /// `suspended` means the dialing has deliberately stopped and says why.
  nonisolated static func phase(
    for phase: GhostteaAttachmentPhase, exitCode: Int32? = nil
  ) -> TerminalPhase {
    switch phase {
    case .opening, .synchronizing, .reconnecting:
      .connecting
    case .live:
      .live
    case .suspended(.hostAbsent):
      .suspended("host absent — reconnects when it returns")
    case .suspended(.suspendedByApp):
      .suspended("paused in the background")
    case .suspended(.accessDenied):
      .suspended("the host refused this device")
    case .ended(.sessionClosed):
      .ended("session closed on the host")
    case .ended(.sessionExited):
      .ended(exitCode.map { "process exited (code \($0))" } ?? "process exited")
    case .ended(.sessionUnavailable):
      .ended("session unavailable — the host could not say why")
    case .ended(.hostRestarted):
      .ended("the host restarted")
    case .ended(.hostShutdown):
      .ended("the host shut down")
    case .ended(.closedLocally):
      .ended("closed from this device")
    }
  }

  nonisolated static func shortReason(_ error: Error) -> String {
    let text = String(describing: error)
    return text.count > 120 ? String(text.prefix(117)) + "…" : text
  }
}
