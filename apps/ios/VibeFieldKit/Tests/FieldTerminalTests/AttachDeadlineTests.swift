import FieldProduct
import FieldRoutedTerminal
import Foundation
import GhostteaFrame
import Network
import Testing

@testable import FieldTerminal

/// fix8 — PJ-7's second phone run: ATTACH minted ONE ticket and the card then
/// read "connecting over the mesh…" for good, after the run had ended too, and
/// the desktop's cell saw no leg at all.
///
/// What these rows hold: every wait between the tap and the first frame has a
/// deadline, and past it the card says which step stopped and on which desktop
/// (`TerminalPhase.stalled`, the banner "couldn't reach studio's terminal");
/// a run that ends while the card is attaching is said as ended. Deadlines are
/// one second here; the phone's is `TerminalAttachment.stepDeadline`.
///
/// What they rule out, for item 1 of the brief: a far end that takes the socket
/// and never answers is already bounded by the session's request timeout and
/// answered with a fresh mint (`aSilentDoorEndsInAFreshMint`), and the leg
/// budget grants the first attach of a run at once, whatever doors History and
/// Browse opened before it (`runTwosOrderAttachesAtOnce`). Neither is what held
/// run 2's card.
@Suite struct AttachDeadlineTests {
  static let session = "sess-01J8Z3K9"
  static let deadline: Duration = .seconds(1)

  @MainActor
  final class Mints {
    private(set) var count = 0
    func record() { count += 1 }
  }

  static func until(
    _ what: String, timeout: Duration = .seconds(5), _ condition: @Sendable () async -> Bool
  ) async throws {
    try await AttachmentOverTheDoorTests.until(what, timeout: timeout, condition)
  }

  static func stalled(_ step: RoutedTerminalClient.AttachStep) -> TerminalPhase {
    .stalled(TerminalAttachment.stallWords(step, after: deadline))
  }

  @Test("fix8: the shipping words — 20 s, and 'that desktop' when the field names none")
  func theShippingWords() {
    #expect(
      TerminalAttachment.phase(for: .stalled(.dial), session: nil)
        == .stalled("the dial over the mesh got no answer — stopped after 20 s"))
    let banner = TerminalAttachment.banner(
      for: .stalled("the session attached but sent no screen — stopped after 20 s"), device: nil,
      doorRefusal: nil)
    #expect(banner?.title == "couldn't reach that desktop's terminal")
    #expect(banner?.detail == "the session attached but sent no screen — stopped after 20 s")
    #expect(TerminalAttachment.runEndedWords(device: nil) == "its run exited on that desktop")
  }

  // MARK: Ruled out

  @MainActor
  @Test(
    "fix8: a far end that takes the socket and never answers is bounded today — a fresh mint",
    .timeLimit(.minutes(1)))
  func aSilentDoorEndsInAFreshMint() async throws {
    let door = SilentDoor()
    let port = try await door.start()
    defer { Task { await door.stop() } }

    let mints = Mints()
    let attachment = TerminalAttachment(
      // The shipping transport, its request timeout cut to two seconds so the
      // row is quick: the phone's own legs time out at fifteen.
      transport: URLSessionRoutedTransport(timeout: 2),
      appearance: .default,
      door: { _ in
        mints.record()
        return try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: Self.session)
      },
      deadline: .seconds(30))
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")

    try await Self.until("both legs to reach the silent door") { await door.accepted >= 2 }
    #expect(mints.count == 1)
    try await Self.until("the timed-out legs to mint again", timeout: .seconds(20)) {
      await MainActor.run { mints.count >= 2 }
    }
    await attachment.detach()
  }

  @MainActor
  @Test(
    "fix8: run 2's order — the home's door, History's second desktop, then ATTACH — takes both leg slots at once",
    .timeLimit(.minutes(1)))
  func runTwosOrderAttachesAtOnce() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }

    // One ledger, as the phone's `.shared` is: the home's door held the whole
    // run, History opened (and closed) a second desktop's, and Browse and the
    // launch sheet rode the home's. Doors are their own resource.
    let ledger = PhoneConnectionBudget()
    let home = try await ledger.acquire(.door(desktop: "studio"))
    let history = try await ledger.acquire(.door(desktop: "laptop"))
    ledger.release(history)

    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: Self.session) },
      budget: ledger, deadline: Self.deadline)
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")

    _ = try await AttachmentOverTheDoorTests.value("the control attach") {
      await door.controlAttach
    }
    #expect(ledger.inUse(.terminalLegs) == 2)
    #expect(ledger.waiting(for: .terminalLegs) == 0)
    await attachment.detach()
    #expect(ledger.inUse(.terminalLegs) == 0)
    ledger.release(home)
  }

  // MARK: Every step has a deadline

  @MainActor
  @Test(
    "fix8: a ticket that never comes back stops at the ticket, in words",
    .timeLimit(.minutes(1)))
  func aTicketThatNeverComesBackSaysSo() async throws {
    let gate = Gate()
    defer { Task { await gate.open() } }
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in
        await gate.wait()
        throw CancellationError()
      },
      deadline: Self.deadline)
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")

    try await Self.until("the mint to be asked") { await gate.waiting == 1 }
    try await Self.until("the attach to stop at the ticket") {
      await MainActor.run { attachment.phase == Self.stalled(.ticket) }
    }
    let banner = try #require(attachment.banner)
    #expect(banner.title == "couldn't reach studio's terminal")
    #expect(banner.detail == "the ticket was asked for and never came back — stopped after 1 s")
    #expect(banner.actions == [.retryNow, .backToTheField])
    #expect(banner.coolsTerminal)
  }

  @MainActor
  @Test(
    "fix8: a slot another terminal never gave back stops at the slot, and leaves the queue",
    .timeLimit(.minutes(1)))
  func aSlotNeverGivenBackSaysSo() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }

    // An earlier client's legs, never released — the leak the brief asked
    // about: whoever holds them, this attach must not wait for them forever.
    let ledger = PhoneConnectionBudget()
    let leaked = try await ledger.acquire(.terminalLegs, count: 2)
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: Self.session) },
      budget: ledger, deadline: Self.deadline)
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")

    try await Self.until("the dial to wait for a slot") {
      await MainActor.run { ledger.waiting(for: .terminalLegs) == 1 }
    }
    try await Self.until("the attach to stop at the slot") {
      await MainActor.run { attachment.phase == Self.stalled(.slot) }
    }
    try await Self.until("the stopped dial to leave the queue") {
      await MainActor.run { ledger.waiting(for: .terminalLegs) == 0 }
    }
    #expect(await door.accepted == 0)
    #expect(attachment.banner?.title == "couldn't reach studio's terminal")
    ledger.release(leaked)
  }

  @MainActor
  @Test(
    "fix8: a mesh that never opens a leg's socket stops at the dial, in words",
    .timeLimit(.minutes(1)))
  func aDialThatNeverOpensSaysSo() async throws {
    let gate = Gate()
    defer { Task { await gate.open() } }
    let attachment = TerminalAttachment(
      transport: HungTransport(gate: gate),
      appearance: .default,
      door: { _ in try AttachmentOverTheDoorTests.ticketJSON(port: 9, sessionId: Self.session) },
      deadline: Self.deadline)
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")

    try await Self.until("both legs to ask the mesh for a socket") { await gate.waiting == 2 }
    try await Self.until("the attach to stop at the dial") {
      await MainActor.run { attachment.phase == Self.stalled(.dial) }
    }
    let banner = try #require(attachment.banner)
    #expect(banner.title == "couldn't reach studio's terminal")
    #expect(banner.detail == "the dial over the mesh got no answer — stopped after 1 s")
    #expect(banner.actions == [.retryNow, .backToTheField])
  }

  @MainActor
  @Test(
    "fix8: a control attach the cell never acknowledges stops at control",
    .timeLimit(.minutes(1)))
  func aControlAttachNeverAcknowledgedSaysSo() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: Self.session) },
      deadline: Self.deadline)
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")

    _ = try await AttachmentOverTheDoorTests.value("the control attach") {
      await door.controlAttach
    }
    try await Self.until("the attach to stop at control") {
      await MainActor.run { attachment.phase == Self.stalled(.control) }
    }
  }

  @MainActor
  @Test(
    "fix8: a frames attach the cell never acknowledges stops at frames",
    .timeLimit(.minutes(1)))
  func aFramesAttachNeverAcknowledgedSaysSo() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: Self.session) },
      deadline: Self.deadline)
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")

    let control = try await AttachmentOverTheDoorTests.value("the control attach") {
      await door.controlAttach
    }
    await door.send(
      .controlLegAttached,
      Script.controlAttached(
        session: Self.session, activation: control.activationId, rights: ["input", "read"]),
      on: .control)
    _ = try await AttachmentOverTheDoorTests.value("the frames attach") {
      await door.framesAttach
    }
    try await Self.until("the attach to stop at frames") {
      await MainActor.run { attachment.phase == Self.stalled(.frames) }
    }
  }

  @MainActor
  @Test(
    "fix8: both legs attached and no frame stops at the first frame",
    .timeLimit(.minutes(1)))
  func noFirstFrameSaysSo() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let identity = try decodeTRF1Frame(try LaneFrames.load().seed)
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: Self.session) },
      deadline: Self.deadline)
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")

    let control = try await AttachmentOverTheDoorTests.value("the control attach") {
      await door.controlAttach
    }
    await door.send(
      .controlLegAttached,
      Script.controlAttached(
        session: Self.session, activation: control.activationId, rights: ["input", "read"]),
      on: .control)
    _ = try await AttachmentOverTheDoorTests.value("the frames attach") {
      await door.framesAttach
    }
    await door.send(
      .framesLegAttached,
      Script.framesAttached(
        session: Self.session, activation: control.activationId,
        sessionHandle: String(identity.sessionHandle), viewHandle: String(identity.viewHandle)),
      on: .frames)
    try await Self.until("the attach to stop at the first frame") {
      await MainActor.run { attachment.phase == Self.stalled(.firstFrame) }
    }
  }

  @MainActor
  @Test(
    "fix8: a live session is never stopped by an attach deadline, and a run's end leaves it be",
    .timeLimit(.minutes(1)))
  func aLiveSessionOutlivesTheDeadline() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let frames = try LaneFrames.load()
    let identity = try decodeTRF1Frame(frames.seed)
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: Self.session) },
      deadline: Self.deadline)
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")

    let control = try await AttachmentOverTheDoorTests.value("the control attach") {
      await door.controlAttach
    }
    let activation = control.activationId
    await door.send(
      .controlLegAttached,
      Script.controlAttached(session: Self.session, activation: activation, rights: ["input", "read"]),
      on: .control)
    _ = try await AttachmentOverTheDoorTests.value("the frames attach") {
      await door.framesAttach
    }
    await door.send(
      .framesLegAttached,
      Script.framesAttached(
        session: Self.session, activation: activation,
        sessionHandle: String(identity.sessionHandle), viewHandle: String(identity.viewHandle)),
      on: .frames)
    let seedStamp = Script.stamp(1)
    await door.sendUnit(
      try Script.frame(
        session: Self.session, activation: activation, sequence: 1, creditEpoch: 1,
        base: nil, result: seedStamp, payload: frames.seed))
    // A long lease, so "live" here is the deadline's question and not the
    // lease's: nothing in this row refreshes the status.
    await door.send(
      .cellActivationStatus,
      Script.status(
        session: Self.session, activation: activation, sequence: 1, accepted: seedStamp,
        leaseTtlMs: 60_000),
      on: .control)
    try await Self.until("the card to go live") {
      await MainActor.run { attachment.phase == .live }
    }

    attachment.runEnded()
    try await Task.sleep(for: Self.deadline * 2.5)
    #expect(attachment.phase == .live)
    await attachment.detach()
  }

  // MARK: The run ended

  @MainActor
  @Test(
    "fix8: a run that ends while the card is attaching is said as ended, and the dial stops",
    .timeLimit(.minutes(1)))
  func aRunThatEndsWhileAttachingSaysSo() async throws {
    let gate = Gate()
    defer { Task { await gate.open() } }
    let attachment = TerminalAttachment(
      transport: HungTransport(gate: gate),
      appearance: .default,
      door: { _ in try AttachmentOverTheDoorTests.ticketJSON(port: 9, sessionId: Self.session) },
      deadline: Self.deadline)
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")
    try await Self.until("both legs to ask the mesh for a socket") { await gate.waiting == 2 }

    attachment.runEnded()
    #expect(attachment.phase == .ended("its run exited on studio"))
    let banner = try #require(attachment.banner)
    #expect(banner.title == "this session ended — its run exited on studio")
    #expect(banner.actions == [.backToTheField])
    // the attach's own deadline does not later paint over it
    try await Task.sleep(for: Self.deadline * 2.5)
    #expect(attachment.phase == .ended("its run exited on studio"))
  }
}

// MARK: - Harness

/// A wait nobody can cancel, released only by `open` — the mesh's session
/// factory or a door that never answers. Uncancellable on purpose: the real
/// waits are, and a deadline that only worked on a cancellable wait would not
/// be one.
actor Gate {
  private var held: [CheckedContinuation<Void, Never>] = []
  private var opened = false
  private(set) var waiting = 0

  func wait() async {
    if opened { return }
    waiting += 1
    await withCheckedContinuation { held.append($0) }
  }

  func open() {
    opened = true
    let released = held
    held = []
    for continuation in released { continuation.resume() }
  }
}

/// A leg transport whose `connect` waits on a gate: a socket the mesh never
/// makes.
struct HungTransport: RoutedLegTransport {
  let gate: Gate

  struct Released: Error {}

  func connect(to url: URL) async throws -> any RoutedLegConnection {
    await gate.wait()
    throw Released()
  }
}

/// A TCP listener on 127.0.0.1 that accepts, reads, and never answers — the
/// phone's tailnet proxy taking a dial whose far end never speaks.
actor SilentDoor {
  private var listener: NWListener?
  private var connections: [NWConnection] = []
  private(set) var accepted = 0

  func start() async throws -> UInt16 {
    let parameters = NWParameters.tcp
    parameters.allowLocalEndpointReuse = true
    parameters.requiredInterfaceType = .loopback
    let listener = try NWListener(using: parameters)
    self.listener = listener
    listener.newConnectionHandler = { [weak self] connection in
      Task { await self?.take(connection) }
    }
    let port: UInt16 = try await withCheckedThrowingContinuation { continuation in
      let once = SilentDoorOnce(continuation)
      listener.stateUpdateHandler = { state in
        switch state {
        case .ready: once.resume(with: .success(listener.port?.rawValue ?? 0))
        case .failed(let error), .waiting(let error): once.resume(with: .failure(error))
        default: break
        }
      }
      listener.start(queue: .global())
    }
    return port
  }

  func stop() {
    listener?.cancel()
    listener = nil
    for connection in connections { connection.cancel() }
    connections.removeAll()
  }

  private func take(_ connection: NWConnection) {
    accepted += 1
    connections.append(connection)
    connection.start(queue: .global())
    Self.drain(connection)
  }

  /// Read and discard whatever arrives, for as long as the socket lives.
  private nonisolated static func drain(_ connection: NWConnection) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { _, _, done, error in
      guard error == nil, !done else { return }
      drain(connection)
    }
  }
}

private final class SilentDoorOnce: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<UInt16, any Error>?

  init(_ continuation: CheckedContinuation<UInt16, any Error>) {
    self.continuation = continuation
  }

  func resume(with result: Result<UInt16, any Error>) {
    lock.lock()
    let pending = continuation
    continuation = nil
    lock.unlock()
    pending?.resume(with: result)
  }
}
