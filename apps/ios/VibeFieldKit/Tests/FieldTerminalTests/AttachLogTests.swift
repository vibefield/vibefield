import FieldProduct
import FieldRoutedTerminal
import Foundation
import GhostteaFrame
import Testing

@testable import FieldTerminal

/// fix8 item 3 — the attach says where it is, on the device's console.
///
/// Run 2's console carried nothing about the attach: the kit wrote no line for
/// it anywhere. These rows read the lines an attach writes through
/// `TerminalAttachLog` — the same lines `.device` sends to the unified log
/// (`com.jamesyong.vibefield.kit` / `attach`) and, in DEBUG, to stdout — and
/// hold them to the brief: each phase, in order; the session factory
/// bracketed on each leg; a stop said with its step; and never a grant, a
/// MAC, a nonce, a URL or a login.
@Suite struct AttachLogTests {
  static let session = "sess-01J8Z3K9"

  /// Every line written, in order, with its level.
  final class Lines: @unchecked Sendable {
    private let lock = NSLock()
    private var written: [(level: TerminalAttachLog.Level, line: String)] = []

    var log: TerminalAttachLog {
      TerminalAttachLog { [self] level, line in
        lock.lock()
        written.append((level, line))
        lock.unlock()
      }
    }

    var all: [String] {
      lock.lock()
      defer { lock.unlock() }
      return written.map(\.line)
    }

    var errors: [String] {
      lock.lock()
      defer { lock.unlock() }
      return written.filter { $0.level == .error }.map(\.line)
    }

    func first(_ fragment: String) -> Int? { all.firstIndex { $0.contains(fragment) } }
    func count(_ fragment: String) -> Int { all.filter { $0.contains(fragment) }.count }
  }

  static func until(
    _ what: String, timeout: Duration = .seconds(5), _ condition: @Sendable () async -> Bool
  ) async throws {
    try await AttachmentOverTheDoorTests.until(what, timeout: timeout, condition)
  }

  @MainActor
  @Test(
    "fix8: a live attach writes each phase in order, and no grant, MAC, nonce, URL or login",
    .timeLimit(.minutes(1)))
  func aLiveAttachWritesEachPhase() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let frames = try LaneFrames.load()
    let identity = try decodeTRF1Frame(frames.seed)
    let lines = Lines()
    let ticket = try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: Self.session)
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(log: lines.log),
      appearance: .default,
      door: { _ in ticket },
      budget: PhoneConnectionBudget(), deadline: .seconds(5), log: lines.log)
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")

    let control = try await AttachmentOverTheDoorTests.value("the control attach") {
      await door.controlAttach
    }
    let activation = control.activationId
    await door.send(
      .controlLegAttached,
      Script.controlAttached(session: Self.session, activation: activation, rights: ["input", "read"]),
      on: .control)
    _ = try await AttachmentOverTheDoorTests.value("the frames attach") { await door.framesAttach }
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
    await door.send(
      .cellActivationStatus,
      Script.status(session: Self.session, activation: activation, sequence: 1, accepted: seedStamp),
      on: .control)
    try await Self.until("the first-frame line") { lines.first("first frame") != nil }

    let phases = [
      "tap", "mint asked", "mint answered", "slot asked", "slot granted", "dialing",
      "asking the mesh for a session", "mesh session in", "hello sent", "accepted",
      "control acknowledged", "frames acknowledged", "first frame",
    ]
    var previous = -1
    for phase in phases {
      let at = try #require(lines.first(phase), "no line for \(phase): \(lines.all)")
      #expect(at > previous, "\(phase) came out of order: \(lines.all)")
      previous = at
    }
    // each leg says its own: dialing, its session bracketed, its hello, its accept
    for leg in ["leg control", "leg frames"] {
      #expect(lines.count("\(leg) cell=cb-7f3a9c1e-2026: dialing") == 1)
      #expect(lines.count("\(leg) cell=cb-7f3a9c1e-2026: asking the mesh for a session") == 1)
      #expect(lines.count("\(leg) cell=cb-7f3a9c1e-2026: mesh session in") == 1)
      #expect(lines.count("\(leg) cell=cb-7f3a9c1e-2026: hello sent") == 1)
      #expect(lines.count("\(leg) cell=cb-7f3a9c1e-2026: accepted") == 1)
    }
    #expect(lines.errors.isEmpty)

    // Nothing that is a credential, a capability or a person.
    let secrets = [
      try #require(ticket["transportGrant"]?["mac"]?.stringValue),
      try #require(ticket["attachGrant"]?["mac"]?.stringValue),
      try #require(ticket["transportGrant"]?["claims"]?["nonce"]?.stringValue),
      "ws://", "127.0.0.1", "tailnet:", "@example.com", "?",
    ]
    for secret in secrets {
      #expect(!lines.all.contains { $0.contains(secret) }, "a line carried \(secret)")
    }
    await attachment.detach()
  }

  @MainActor
  @Test(
    "fix8: a session factory that never returns is bracketed — asked, never made — and the stop is said",
    .timeLimit(.minutes(1)))
  func aHungSessionFactoryIsBracketed() async throws {
    let gate = Gate()
    defer { Task { await gate.open() } }
    let lines = Lines()
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(
        session: { _ in
          await gate.wait()
          throw CancellationError()
        }, log: lines.log),
      appearance: .default,
      door: { _ in try AttachmentOverTheDoorTests.ticketJSON(port: 9, sessionId: Self.session) },
      deadline: .seconds(1), log: lines.log)
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")

    try await Self.until("both legs to ask the mesh for a session") { await gate.waiting == 2 }
    try await Self.until("the stop to be said") {
      lines.errors.contains { $0.contains("stopped waiting at dial after 1 s") }
    }
    #expect(lines.count("asking the mesh for a session") == 2)
    #expect(lines.count("mesh session in") == 0)
  }

  @MainActor
  @Test(
    "fix8: a session factory that throws says so, with the time it took and the error's domain",
    .timeLimit(.minutes(1)))
  func aThrowingSessionFactoryIsSaid() async throws {
    let lines = Lines()
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(
        session: { _ in throw URLError(.notConnectedToInternet) }, log: lines.log),
      appearance: .default,
      door: { _ in try AttachmentOverTheDoorTests.ticketJSON(port: 9, sessionId: Self.session) },
      deadline: .seconds(5), log: lines.log)
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")

    try await Self.until("the factory's refusal to be said") {
      lines.errors.contains { $0.contains("no mesh session after") }
    }
    let line = try #require(lines.errors.first { $0.contains("no mesh session after") })
    #expect(line.contains("NSURLErrorDomain -1009"))
    await attachment.detach()
  }

  @MainActor
  @Test(
    "fix8: a mint that never answers says it stopped; a refused one says the door's words",
    .timeLimit(.minutes(1)))
  func theMintSaysHowItEnded() async throws {
    let gate = Gate()
    defer { Task { await gate.open() } }
    let lines = Lines()
    let hung = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in
        await gate.wait()
        throw CancellationError()
      },
      deadline: .seconds(1), log: lines.log)
    hung.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")
    try await Self.until("the mint's stop to be said") {
      lines.errors.contains { $0.contains("mint stopped after 1 s") }
    }

    let refused = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in throw AttachmentOverTheDoorTests.doorsNotPublished() },
      deadline: .seconds(1), log: lines.log)
    refused.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")
    try await Self.until("the refusal to be said") {
      lines.errors.contains {
        $0.contains("mint refused: studio is not publishing its terminal doors on the tailnet")
      }
    }
  }

  @MainActor
  @Test(
    "fix8: a run's end and a detach are said", .timeLimit(.minutes(1)))
  func theEndIsSaid() async throws {
    let gate = Gate()
    defer { Task { await gate.open() } }
    let lines = Lines()
    let attachment = TerminalAttachment(
      transport: HungTransport(gate: gate),
      appearance: .default,
      door: { _ in try AttachmentOverTheDoorTests.ticketJSON(port: 9, sessionId: Self.session) },
      deadline: .seconds(5), log: lines.log)
    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")
    try await Self.until("both legs to ask the mesh for a socket") { await gate.waiting == 2 }
    attachment.runEnded()
    #expect(lines.first("run exited on studio") != nil)
    await attachment.detach()
    #expect(lines.first("detached") != nil)
  }

  #if DEBUG
    @Test(
      "fix8: a main queue that stops answering past the threshold is said, with the last attach phase, and so is its return",
      .timeLimit(.minutes(1)))
    func aStalledQueueIsSaid() async throws {
      let lines = Lines()
      // A serial queue stands in for the main one: blocking the real main
      // thread would stop this test's own runner.
      let target = DispatchQueue(label: "fix8.test.fake-main")
      let witness = MainThreadWitness(
        target: target, threshold: 0.3, interval: 0.05, log: lines.log,
        lastPhase: { "leg control cell=c1: asking the mesh for a session" })
      witness.start()
      defer { witness.stop() }

      try await Task.sleep(for: .milliseconds(400))
      #expect(lines.all.isEmpty, "a queue that answers wrote \(lines.all)")

      target.async { Thread.sleep(forTimeInterval: 0.9) }
      try await Self.until("the stall to be said") { lines.first("main thread stalled") != nil }
      try await Self.until("the return to be said") {
        lines.first("main thread answered again") != nil
      }
      let stall = try #require(lines.errors.first { $0.contains("main thread stalled") })
      #expect(stall.contains("last attach phase: leg control cell=c1: asking the mesh for a session"))
      #expect(lines.count("main thread stalled") == 1)
    }
  #endif
}
