import Foundation
import Testing

@testable import FieldProduct

/// SP-7a — the spark's transcript, read on the phone (`SparkTranscriptReader`), as the Mac reads it. These are the
/// Mac's own rows (`packages/field-app/test/transcript-port.test.ts`, the reader `readTranscript`), so one Chat reads
/// one way (PC-L1; IOS-12c's plan, VF-PM 05:17Z), over a scripted door and a scripted socket and the contracts'
/// goldens:
/// - a ticket from fieldd over the home's door, the worker's socket dialled by the phone itself (EL2);
/// - the latest conversation's runs named, each after the last line held; the lines, `caught-up`, then the tail;
/// - a closed socket, a slow `ready` or a worker's refusal asked again after the backoff, what is drawn staying drawn;
/// - fieldd's refusal said while nothing is drawn, and asked again only when the home's client reconnects.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

// MARK: - The scripts

/// One answer the door gives, in order. Past the last, the door answers the ticket golden, as the Mac's fake does.
private enum DoorAnswer {
  case value(JSONValue)
  case refusal(FieldProductError)
}

@MainActor
private final class TranscriptDoor: SparkTranscriptDoor {
  var answers: [DoorAnswer]
  private(set) var asked: [(method: String, params: JSONValue?)] = []

  init(_ answers: [DoorAnswer] = []) { self.answers = answers }

  func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
    asked.append((method, params))
    guard !answers.isEmpty else { return try Fixture.json("spark-transcript-ticket.valid") }
    switch answers.removeFirst() {
    case .value(let value): return value
    case .refusal(let error): throw error
    }
  }
}

/// One scripted socket: the frames the test feeds come out of `receive`, and a close, either end's, ends it.
private actor TranscriptSocket: ProductConnection {
  private var inbox: [String] = []
  private var waiting: CheckedContinuation<String, any Error>?
  private(set) var sent: [String] = []
  private(set) var closed = false

  struct Closed: Error {}

  func send(_ text: String) async throws {
    guard !closed else { throw Closed() }
    sent.append(text)
  }

  func receive() async throws -> String {
    if closed { throw Closed() }
    if !inbox.isEmpty { return inbox.removeFirst() }
    return try await withCheckedThrowingContinuation { waiting = $0 }
  }

  func close() async { end() }

  /// A frame from the worker.
  func feed(_ frame: JSONValue) throws {
    feedText(String(decoding: try frame.encoded(), as: UTF8.self))
  }

  func feedText(_ text: String) {
    if let waiter = waiting {
      waiting = nil
      waiter.resume(returning: text)
    } else {
      inbox.append(text)
    }
  }

  /// The worker's end closing (a restart, a drop).
  func drop() { end() }

  private func end() {
    closed = true
    if let waiter = waiting {
      waiting = nil
      waiter.resume(throwing: Closed())
    }
  }

  /// The one `open` the reader sent, as JSON.
  func openFrame() throws -> JSONValue? {
    guard let first = sent.first else { return nil }
    return try JSONValue.parse(Data(first.utf8))
  }
}

/// One scripted socket per dial, and where each dial went.
private final class TranscriptTransport: ProductTransport, @unchecked Sendable {
  private let lock = NSLock()
  private var made: [TranscriptSocket] = []
  private var urls: [URL] = []

  func connect(to url: URL) async throws -> any ProductConnection {
    let socket = TranscriptSocket()
    lock.withLock {
      made.append(socket)
      urls.append(url)
    }
    return socket
  }

  var sockets: [TranscriptSocket] { lock.withLock { made } }
  var dialed: [URL] { lock.withLock { urls } }
}

/// The backoff's sleeps, recorded and returned at once.
private final class Naps: @unchecked Sendable {
  private let lock = NSLock()
  private var taken: [Duration] = []
  var all: [Duration] { lock.withLock { taken } }
  var sleep: SparkTranscriptReader.Sleep {
    { [self] duration in
      lock.withLock { taken.append(duration) }
      await Task.yield()
    }
  }
}

@MainActor
private func waitFor(_ what: String, timeout: Duration = .seconds(5), _ condition: @MainActor () async -> Bool) async {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    if await condition() { return }
    try? await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("timed out waiting for \(what)")
}

// MARK: - The goldens and the frames

private enum Golden {
  static let spark = "sp-9q2wloft1"
  /// the ticket golden's runs: the first fresh, the latest resuming it
  static let first = "run-01JC2Z9X0A"
  static let latest = "run-01JC4MA2K3"

  static func line(_ name: String) throws -> JSONValue { try Fixture.json("spark-transcript-line.\(name)") }

  static func lineFrame(_ run: String, _ name: String) throws -> JSONValue {
    .object(["type": .string("line"), "run": .string(run), "line": try line(name)])
  }

  static func ready(_ generation: Int64 = 2) -> JSONValue {
    .object(["type": .string("ready"), "generation": .int(generation)])
  }

  static func caughtUp(_ dropped: Int64 = 0) -> JSONValue {
    .object(["type": .string("caught-up"), "dropped": .int(dropped)])
  }

  static func ticket(runs: [JSONValue]) throws -> JSONValue {
    let golden = try Fixture.json("spark-transcript-ticket.valid")
    return .object((golden.objectValue ?? [:]).merging(["runs": .array(runs)]) { $1 })
  }

  static func run(_ id: String, _ startedAt: String, fresh: Bool) -> JSONValue {
    .object(["runtimeRunId": .string(id), "startedAt": .string(startedAt), "fresh": .bool(fresh)])
  }

  static func open(_ runs: [(String, Int64?)]) -> JSONValue {
    SparkTranscriptOpen(
      ticket: "Qm9pZ2hUcmFuc2NyaXB0VGlja2V0X0V4YW1wbGUwMDE", runs: runs.map { .init(run: $0.0, after: $0.1) }
    ).json
  }
}

/// Each run's held seqs in a reading.
private func seqs(_ reading: SparkTranscriptReading, _ run: String) -> [Int64] {
  guard case .ready(_, let lines, _, _) = reading else { return [] }
  return (lines[run] ?? []).map { $0.seq }
}

private func runIds(_ reading: SparkTranscriptReading) -> [String] {
  guard case .ready(let runs, _, _, _) = reading else { return [] }
  return runs.map { $0.runtimeRunId }
}

// MARK: - The rows

@Suite("SP-7a — the transcript reader, the Mac's own rows on the phone")
@MainActor
struct SparkTranscriptReaderTests {
  private func make(
    _ door: TranscriptDoor, _ transport: TranscriptTransport, _ naps: Naps = Naps(), device: String? = nil,
    whole: Bool = false, held: SparkTranscriptReading = .reading, openTimeout: Duration = .seconds(10)
  ) -> SparkTranscriptReader {
    SparkTranscriptReader(
      spark: Golden.spark, device: device, door: door, transport: transport, whole: whole, held: held,
      sleep: naps.sleep, openTimeout: openTimeout)
  }

  /// The reader's first socket, ready, `lines` served, caught up.
  private func caughtUp(
    _ transport: TranscriptTransport, at index: Int = 0, _ lines: [(String, String)], dropped: Int64 = 0
  ) async throws -> TranscriptSocket {
    await waitFor("dial \(index + 1)") { transport.sockets.count > index }
    let socket = try #require(transport.sockets.count > index ? transport.sockets[index] : nil)
    await waitFor("the open on dial \(index + 1)") { await socket.sent.count == 1 }
    try await socket.feed(Golden.ready())
    for (run, name) in lines { try await socket.feed(try Golden.lineFrame(run, name)) }
    try await socket.feed(Golden.caughtUp(dropped))
    return socket
  }

  @Test("dials the ticket's endpoint, names the latest conversation's runs, and draws once caught up")
  func draws() async throws {
    let door = TranscriptDoor()
    let transport = TranscriptTransport()
    let reader = make(door, transport)
    reader.start()
    #expect(reader.reading == .reading)
    let socket = try await caughtUp(
      transport,
      [(Golden.latest, "run"), (Golden.latest, "you"), (Golden.latest, "unknown-kind"), (Golden.latest, "you")],
      dropped: 1)
    await waitFor("the first reading") { seqs(reader.reading, Golden.latest) == [1, 2] }
    let dialed = transport.dialed.map { $0.absoluteString }
    #expect(dialed == ["ws://127.0.0.1:53817/transcripts"])
    let method = door.asked.first?.method
    let params = door.asked.first?.params
    #expect(method == "compose.sparks.transcript.openTicket")
    #expect(params == SparkTranscriptReader.ticketParams(spark: Golden.spark))
    // the first run is fresh and the second resumes it: one conversation, both named, neither after a line yet
    let open = try await socket.openFrame()
    #expect(open == Golden.open([(Golden.first, nil), (Golden.latest, nil)]))
    // the unknown kind is passed over, the repeat too
    guard case .ready(let runs, _, let dropped, let whole) = reader.reading else {
      Issue.record("not ready: \(reader.reading)")
      return
    }
    #expect(dropped == 1 && !whole && runs.count == 2)
    #expect(reader.skipped == 1)
    reader.cancel()
  }

  @Test("asks its ticket naming the desktop that keeps the spark, which the home carries the ask to (SP-7a D3)")
  func namesTheDesktop() async throws {
    let door = TranscriptDoor()
    let transport = TranscriptTransport()
    let reader = make(door, transport, device: "dev-01HQ9S7UD1")
    reader.start()
    await waitFor("the ticket's ask") { !door.asked.isEmpty }
    let asked = door.asked.first?.params
    let params = try Fixture.json("spark-transcript-ticket-params.device")
    #expect(asked == params)
    #expect(reader.device == "dev-01HQ9S7UD1")
    reader.cancel()
  }

  @Test("hears the tail after caught-up, and a run begun since")
  func tail() async throws {
    let transport = TranscriptTransport()
    let reader = make(TranscriptDoor(), transport)
    reader.start()
    let socket = try await caughtUp(transport, [(Golden.latest, "run")])
    try await socket.feed(try Golden.lineFrame(Golden.latest, "you"))
    try await socket.feed(try Golden.lineFrame(Golden.latest, "reply"))
    await waitFor("the tail's lines") { seqs(reader.reading, Golden.latest) == [1, 2, 7] }
    try await socket.feed(try Fixture.json("spark-transcript-frame.run"))
    await waitFor("the new run") { runIds(reader.reading).count == 3 }
    let runs = runIds(reader.reading)
    #expect(runs == [Golden.first, Golden.latest, "run-01JC4P7M2N"])
    reader.cancel()
  }

  @Test("asks a fresh ticket when the socket closes, naming each run after the last line it holds")
  func reasks() async throws {
    let door = TranscriptDoor()
    let transport = TranscriptTransport()
    let naps = Naps()
    let reader = make(door, transport, naps)
    reader.start()
    let first = try await caughtUp(transport, [(Golden.latest, "run"), (Golden.latest, "reply")])
    await waitFor("caught up") { seqs(reader.reading, Golden.latest) == [1, 7] }
    #expect(door.asked.count == 1)
    await first.drop()
    await waitFor("the second dial") { transport.sockets.count == 2 }
    #expect(naps.all == [.milliseconds(SparkTranscriptLimits.retryMinMs)])
    #expect(door.asked.count == 2)
    let second = try #require(transport.sockets.last)
    await waitFor("the second open") { await second.sent.count == 1 }
    let open = try await second.openFrame()
    #expect(open == Golden.open([(Golden.first, nil), (Golden.latest, 7)]))
    // what was drawn stays drawn meanwhile
    #expect(seqs(reader.reading, Golden.latest) == [1, 7])
    reader.cancel()
  }

  @Test("drops a socket whose ready is not heard in time, and asks again")
  func slowReady() async throws {
    let door = TranscriptDoor()
    let transport = TranscriptTransport()
    let naps = Naps()
    let reader = make(door, transport, naps, openTimeout: .milliseconds(50))
    reader.start()
    await waitFor("the first dial") { transport.sockets.count == 1 }
    let first = try #require(transport.sockets.first)
    await waitFor("the slow socket closed") { await first.closed }
    await waitFor("the second ask") { door.asked.count == 2 }
    #expect(naps.all.first == .milliseconds(SparkTranscriptLimits.retryMinMs))
    reader.cancel()
  }

  @Test("says fieldd's refusal with nothing drawn, never on a timer, and asks again when the home's client reconnects")
  func refusal() async throws {
    let refused = FieldProductError(
      kind: "UNAVAILABLE", message: "fieldd isn't running", retryable: true,
      details: .object(["service": .string("spark-transcripts"), "state": .string("doors_not_published"),
        "device": .string("dev-studio")]))
    let door = TranscriptDoor([.refusal(refused)])
    let transport = TranscriptTransport()
    let naps = Naps()
    let reader = make(door, transport, naps)
    reader.start()
    await waitFor("the refusal said") { reader.reading == .unreadable(reason: "fieldd isn't running", device: "dev-studio") }
    try await Task.sleep(for: .milliseconds(50))
    #expect(door.asked.count == 1 && naps.all.isEmpty, "not asked again on a timer")
    reader.reconnected()
    await waitFor("the ask on reconnect") { door.asked.count == 2 }
    await waitFor("the dial after it") { transport.sockets.count == 1 }
    reader.cancel()
  }

  @Test("a ticket this build cannot read takes fieldd's refusal's road: said, and asked again on reconnect")
  func unreadableTicket() async throws {
    let door = TranscriptDoor([.value(.object(["spark": .string(Golden.spark)]))])
    let reader = make(door, TranscriptTransport())
    reader.start()
    await waitFor("the refusal said") {
      if case .unreadable(_, nil) = reader.reading { return true }
      return false
    }
    reader.cancel()
  }

  @Test("names every run once the earlier conversations are asked for, and only the latest's before")
  func wholeRuns() async throws {
    let runs = [
      Golden.run("run-earlier01", "2026-10-30T09:00:00.000Z", fresh: true),
      Golden.run(Golden.first, "2026-11-02T09:12:00.000Z", fresh: true),
      Golden.run(Golden.latest, "2026-11-04T23:10:40.002Z", fresh: false),
    ]
    for whole in [false, true] {
      let transport = TranscriptTransport()
      let reader = make(TranscriptDoor([.value(try Golden.ticket(runs: runs))]), transport, whole: whole)
      reader.start()
      await waitFor("the dial") { transport.sockets.count == 1 }
      let socket = try #require(transport.sockets.first)
      await waitFor("the open") { await socket.sent.count == 1 }
      let open = try await socket.openFrame()
      let expected =
        whole
        ? Golden.open([("run-earlier01", nil), (Golden.first, nil), (Golden.latest, nil)])
        : Golden.open([(Golden.first, nil), (Golden.latest, nil)])
      #expect(open == expected, "whole: \(whole)")
      reader.cancel()
    }
  }

  @Test("reads the earlier conversations on ask, each run after the line it holds, and what is held stays drawn")
  func readsWhole() async throws {
    let runs = [
      Golden.run("run-earlier01", "2026-10-30T09:00:00.000Z", fresh: true),
      Golden.run(Golden.first, "2026-11-02T09:12:00.000Z", fresh: true),
      Golden.run(Golden.latest, "2026-11-04T23:10:40.002Z", fresh: false),
    ]
    let ticket = try Golden.ticket(runs: runs)
    let transport = TranscriptTransport()
    let reader = make(TranscriptDoor([.value(ticket), .value(ticket)]), transport)
    reader.start()
    _ = try await caughtUp(transport, [(Golden.latest, "run"), (Golden.latest, "you")])
    await waitFor("caught up") { seqs(reader.reading, Golden.latest) == [1, 2] }
    reader.readWhole()
    #expect(seqs(reader.reading, Golden.latest) == [1, 2], "held while the earlier conversations are asked for")
    let second = try await caughtUp(transport, at: 1, [("run-earlier01", "run")])
    let open = try await second.openFrame()
    #expect(open == Golden.open([("run-earlier01", nil), (Golden.first, nil), (Golden.latest, 2)]))
    await waitFor("the whole reading") {
      if case .ready(_, _, _, true) = reader.reading { return seqs(reader.reading, "run-earlier01") == [1] }
      return false
    }
    reader.cancel()
  }

  @Test("the worker's refusal is heard and passed: the socket's close asks again, and what is drawn stays")
  func workerRefusal() async throws {
    let door = TranscriptDoor()
    let transport = TranscriptTransport()
    let reader = make(door, transport)
    reader.start()
    let first = try await caughtUp(transport, [(Golden.latest, "run")])
    await waitFor("caught up") { seqs(reader.reading, Golden.latest) == [1] }
    try await first.feed(try Fixture.json("spark-transcript-frame.refused"))
    await first.drop()
    await waitFor("the second ask") { door.asked.count == 2 }
    #expect(seqs(reader.reading, Golden.latest) == [1])
    reader.cancel()
  }

  @Test("a spark with no run in its record yet reads ready with none, and dials nothing")
  func noRuns() async throws {
    let door = TranscriptDoor([.value(try Golden.ticket(runs: []))])
    let transport = TranscriptTransport()
    let reader = make(door, transport)
    reader.start()
    await waitFor("the empty reading") { reader.reading == .ready(runs: [], lines: [:], dropped: 0, whole: false) }
    #expect(transport.sockets.isEmpty && door.asked.count == 1)
    reader.cancel()
  }

  @Test("stops: the socket closes, and nothing more is published or asked")
  func stops() async throws {
    let door = TranscriptDoor()
    let transport = TranscriptTransport()
    let naps = Naps()
    let reader = make(door, transport, naps)
    reader.start()
    await waitFor("the dial") { transport.sockets.count == 1 }
    let socket = try #require(transport.sockets.first)
    reader.cancel()
    await waitFor("the socket closed") { await socket.closed }
    try await Task.sleep(for: .milliseconds(50))
    #expect(door.asked.count == 1 && naps.all.isEmpty)
    #expect(reader.reading == .reading)
  }

  @Test("the latest conversation is the runs from the last fresh start")
  func latestConversation() {
    let runs = [
      SparkTranscriptRun(runtimeRunId: "a", startedAt: "2026-11-01T00:00:00.000Z", fresh: true),
      SparkTranscriptRun(runtimeRunId: "b", startedAt: "2026-11-02T00:00:00.000Z", fresh: false),
      SparkTranscriptRun(runtimeRunId: "c", startedAt: "2026-11-03T00:00:00.000Z", fresh: true),
      SparkTranscriptRun(runtimeRunId: "d", startedAt: "2026-11-04T00:00:00.000Z", fresh: false),
    ]
    let latest = SparkTranscriptReading.latestConversation(of: runs).map { $0.runtimeRunId }
    #expect(latest == ["c", "d"])
    let one = SparkTranscriptReading.latestConversation(of: Array(runs.prefix(2))).map { $0.runtimeRunId }
    #expect(one == ["a", "b"])
    #expect(SparkTranscriptReading.latestConversation(of: []).isEmpty)
  }

  @Test("reads raw lines as the reader does, for the thread's goldens (transcriptReadingOf)")
  func readingOf() throws {
    let latest = SparkTranscriptRun(runtimeRunId: Golden.latest, startedAt: "2026-11-04T23:10:40.002Z", fresh: false)
    let raw = [Golden.latest: [try Golden.line("run"), try Golden.line("you"), try Golden.line("you"),
      try Golden.line("unknown-kind")]]
    let reading = SparkTranscriptReading.of(runs: [latest], raw: raw, dropped: 2)
    #expect(seqs(reading, Golden.latest) == [1, 2])
    guard case .ready(_, _, let dropped, let whole) = reading else {
      Issue.record("not ready: \(reading)")
      return
    }
    #expect(dropped == 2 && !whole)
  }

  @Test("the control: the real transport's request names no Origin (the worker refuses a foreign one; W1 proves the handshake)")
  func noOrigin() throws {
    let url = try #require(URL(string: "ws://127.0.0.1:9/transcripts"))
    let task = URLSession(configuration: .ephemeral).webSocketTask(with: url)
    let origin = task.originalRequest?.value(forHTTPHeaderField: "Origin")
    task.cancel()
    #expect(origin == nil)
  }
}
