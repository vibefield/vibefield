import Foundation
import Observation
import os

// SP-7a — THE SPARK'S TRANSCRIPT, READ ON THE PHONE, as the Mac reads it (`packages/field-app/src/chat/
// transcript-port.ts`, `readTranscript`; TH-1, TH-Q30 (a′), EL2; DESIGN.md §8 "Chat's thread"). The phone asks its
// home's fieldd for a ticket (`compose.sparks.transcript.openTicket`) over the home's own client and dials the
// transcript worker's endpoint itself: no transcript byte rides fieldd's RPC. It names the runs it reads — the latest
// conversation's, or every run once the earlier conversations are asked for — each after the last line it holds, and
// hears every verified line, `caught-up`, then the tail and any run begun since. A socket that closes, a refusal, or a
// `ready` not heard in time asks a fresh ticket after a backoff, and the lines held stay drawn meanwhile. A ticket
// fieldd refuses is said in fieldd's words, and asked again only when the home's client is connected again
// (`reconnected()`). Every effect comes through the door and the transport, so a test drives it with neither.
// SP-7a M-b2: a spark another desktop keeps is asked for by its `device`, and the home carries the ask there (D3).
// The owner answers its worker's routed serve on its tailnet name, which the phone's node dials (D1, D4).
//
// Two departures from the Mac, both deliberate:
// - the Mac batches a catch-up's burst of lines into one reading per microtask; the phone publishes per frame, and
//   SwiftUI's own transaction coalesces the burst;
// - `unreadable` carries the refusal's `device` (fieldd's `details.device`), so the thread can name the desktop that
//   answered when the home federates the ask (SP-7a D3).
// The owner calls `cancel()`: the loop holds the reader while it runs.

/// The door the reader asks for a ticket: the home's own client.
@MainActor
public protocol SparkTranscriptDoor: AnyObject {
  func call(_ method: String, params: JSONValue?) async throws -> JSONValue
}

extension FieldProductClient: SparkTranscriptDoor {}

/// What the thread reads of the spark's record (the Mac's `TranscriptReading`).
public enum SparkTranscriptReading: Equatable, Sendable {
  /// first read: no answer yet
  case reading
  /// fieldd would not give a ticket, in its words (and the desktop that said so, when it named one); asked again when
  /// the home's client reconnects
  case unreadable(reason: String, device: String?)
  /// `runs`: the spark's runs, oldest first, as the tickets named them and the worker announced them since;
  /// `lines`: each run's lines this build knows, in order; `dropped`: lines the worker would not serve, as they failed
  /// their check; `whole`: whether every run was asked for, the earlier conversations' too
  case ready(runs: [SparkTranscriptRun], lines: [String: [SparkTranscriptKnownLine]], dropped: Int, whole: Bool)

  /// The runs the latest conversation holds: from its last fresh start to the newest (`latestConversationOf`).
  public static func latestConversation(of runs: [SparkTranscriptRun]) -> [SparkTranscriptRun] {
    let start = runs.lastIndex(where: { $0.fresh }) ?? 0
    return Array(runs[start...])
  }

  /// A reading from runs and their raw lines, read as the reader reads a line frame: a line this build does not know
  /// is skipped, and a line at or before the last one held is a repeat (`transcriptReadingOf`). The thread's goldens
  /// build their readings through this.
  public static func of(
    runs: [SparkTranscriptRun], raw: [String: [JSONValue]], dropped: Int = 0, whole: Bool = false
  ) -> SparkTranscriptReading {
    var lines: [String: [SparkTranscriptKnownLine]] = [:]
    for (run, each) in raw {
      for value in each {
        guard let line = (try? SparkTranscriptLine(json: value))?.known else { continue }
        _ = take(&lines, run, line)
      }
    }
    return .ready(runs: runs, lines: lines, dropped: dropped, whole: whole)
  }

  /// One line into its run's list; false when it is a repeat (at or before the last one held).
  static func take(_ lines: inout [String: [SparkTranscriptKnownLine]], _ run: String, _ line: SparkTranscriptKnownLine)
    -> Bool
  {
    if let last = lines[run]?.last, line.seq <= last.seq { return false }
    lines[run, default: []].append(line)
    return true
  }
}

/// Reads one spark's record for as long as it is not cancelled, each reading published as it changes.
@MainActor
@Observable
public final class SparkTranscriptReader {
  /// The backoff's wait: the clock's own in the app, a test's in a test.
  public typealias Sleep = @Sendable (Duration) async throws -> Void

  public let spark: String
  /// the desktop that keeps the spark, named in the ticket's ask; nil for the home's own
  public let device: String?
  public private(set) var reading: SparkTranscriptReading = .reading
  /// whether every run is asked for, the earlier conversations' too (`readWhole()`)
  public private(set) var whole: Bool
  /// lines heard of a kind this build does not read (logged once)
  @ObservationIgnored public private(set) var skipped = 0

  @ObservationIgnored private let door: any SparkTranscriptDoor
  @ObservationIgnored private let transport: any ProductTransport
  @ObservationIgnored private let sleep: Sleep
  @ObservationIgnored private let openTimeout: Duration

  @ObservationIgnored private var runs: [SparkTranscriptRun] = []
  @ObservationIgnored private var lines: [String: [SparkTranscriptKnownLine]] = [:]
  @ObservationIgnored private var dropped = 0
  /// a reading is drawn: from the first `caught-up` (or a held reading) on, a refusal no longer replaces it
  @ObservationIgnored private var caught = false
  @ObservationIgnored private var backoffMs = SparkTranscriptLimits.retryMinMs
  @ObservationIgnored private var task: Task<Void, Never>?
  /// the loop that may act: a restart or a cancel moves it on, and a superseded loop's results are dropped
  @ObservationIgnored private var loopId = 0
  @ObservationIgnored private var socket: (number: Int, connection: any ProductConnection)?
  @ObservationIgnored private var socketNumber = 0
  @ObservationIgnored private var readyOn: Int?
  @ObservationIgnored private var started = false
  @ObservationIgnored private var stopped = false

  private static let logger = Logger(subsystem: "com.jamesyong.vibefield.kit", category: "chat.transcript")

  /// `device`: the desktop that keeps the spark, which the home carries the ask to (SP-7a D3); nil asks the home of
  /// its own. `held`: a reading already drawn for this spark, kept drawn while the reader asks again (the Mac's `held`,
  /// as when the earlier conversations are asked for).
  public init(
    spark: String, device: String? = nil, door: any SparkTranscriptDoor, transport: any ProductTransport,
    whole: Bool = false, held: SparkTranscriptReading = .reading,
    sleep: @escaping Sleep = { try await Task.sleep(for: $0) },
    openTimeout: Duration = .milliseconds(SparkTranscriptLimits.openTimeoutMs)
  ) {
    self.spark = spark
    self.device = device
    self.door = door
    self.transport = transport
    self.whole = whole
    self.sleep = sleep
    self.openTimeout = openTimeout
    if case .ready(let runs, let lines, let dropped, _) = held {
      self.runs = runs
      self.lines = lines
      self.dropped = dropped
      caught = true
      reading = held
    }
  }

  /// The ticket's ask, as the door reads it: the spark, and the desktop that keeps it when there is one to name.
  public nonisolated static func ticketParams(spark: String, device: String? = nil) -> JSONValue {
    var params: [String: JSONValue] = ["spark": .string(spark)]
    if let device { params["device"] = .string(device) }
    return .object(params)
  }

  /// Begins reading. Once; a cancelled reader stays cancelled.
  public func start() {
    guard !started, !stopped else { return }
    started = true
    restart()
  }

  /// Asks for the earlier conversations too: every run, each after the line it holds, what is held staying drawn.
  public func readWhole() {
    guard !whole else { return }
    whole = true
    if started, !stopped { restart() }
  }

  /// The home's client is connected again: a refusal said with nothing drawn is asked again (the Mac's
  /// `onReconnected`). While a socket stands, or a reading is drawn, the loop's own retries carry it.
  public func reconnected() {
    guard started, !stopped, !caught, socket == nil else { return }
    restart()
  }

  /// Stops: the socket closes, and nothing more is published or asked.
  public func cancel() {
    stopped = true
    loopId += 1
    task?.cancel()
    task = nil
    dropSocket()
  }

  // MARK: - The loop

  private enum Attempt {
    /// a socket closed, a slow `ready`, a refusal: asked again after the backoff
    case again
    /// a refusal said, nothing to read, or superseded: the loop ends
    case done
  }

  /// A fresh loop, the backoff reset: the last one's socket closed and its results dropped.
  private func restart() {
    loopId += 1
    task?.cancel()
    dropSocket()
    backoffMs = SparkTranscriptLimits.retryMinMs
    let id = loopId
    task = Task { [weak self] in await self?.run(id) }
  }

  private func current(_ id: Int) -> Bool { id == loopId && !stopped }

  private func run(_ id: Int) async {
    while current(id) {
      guard await attempt(id) == .again, current(id) else { break }
      let wait = backoffMs
      backoffMs = min(backoffMs * 2, SparkTranscriptLimits.retryMaxMs)
      do { try await sleep(.milliseconds(wait)) } catch { break }
    }
    if id == loopId { task = nil }
  }

  private func attempt(_ id: Int) async -> Attempt {
    let ticket: SparkTranscriptTicket
    do {
      let answer = try await door.call(
        SparkTranscriptLimits.openTicketMethod, params: Self.ticketParams(spark: spark, device: device))
      ticket = try SparkTranscriptTicket(json: answer)
    } catch {
      guard current(id) else { return .done }
      let refused = error as? FieldProductError
      let reason = refused?.message ?? String(describing: error)
      Self.logger.info("fieldd would not open the spark's record: \(reason, privacy: .public)")
      // what was drawn stays drawn; with nothing drawn, the thread says why
      if !caught {
        reading = .unreadable(reason: reason, device: refused?.details?.objectValue?["device"]?.stringValue)
      }
      return .done
    }
    guard current(id) else { return .done }
    merge(ticket.runs)
    let wanted = whole ? runs : SparkTranscriptReading.latestConversation(of: runs)
    if wanted.isEmpty {
      // a spark with no run in its record yet: nothing to read, and nothing to tail until a ticket names one
      caught = true
      publish()
      return .done
    }
    let connection: any ProductConnection
    do {
      connection = try await transport.connect(to: ticket.endpoint)
    } catch {
      return current(id) ? .again : .done
    }
    guard current(id) else {
      await connection.close()
      return .done
    }
    socketNumber += 1
    let number = socketNumber
    socket = (number, connection)
    let timeout = openTimeout
    let deadline = Task { [weak self] in
      try? await Task.sleep(for: timeout)
      guard !Task.isCancelled, let self, self.socket?.number == number, self.readyOn != number else { return }
      Self.logger.info("the transcript worker did not answer in time")
      self.dropSocket()
    }
    defer {
      deadline.cancel()
      if socket?.number == number { socket = nil }
    }
    let open = SparkTranscriptOpen(
      ticket: ticket.ticket, runs: wanted.map { .init(run: $0.runtimeRunId, after: lines[$0.runtimeRunId]?.last?.seq) })
    do {
      try await connection.send(try open.text())
      while true {
        let text = try await connection.receive()
        guard current(id) else { return .done }
        // dropped by the deadline while a frame was in flight: asked again, as the close would have
        guard socket?.number == number else { return .again }
        guard let frame = try? SparkTranscriptFrame(text: text) else { continue }  // a frame this build does not know
        hear(frame, on: number)
      }
    } catch {
      return current(id) ? .again : .done
    }
  }

  private func hear(_ frame: SparkTranscriptFrame, on number: Int) {
    switch frame {
    case .ready:
      readyOn = number
      backoffMs = SparkTranscriptLimits.retryMinMs
    case .line(let run, let line):
      if let known = line.known {
        _ = SparkTranscriptReading.take(&lines, run, known)
      } else {
        skipped += 1
        if skipped == 1 { Self.logger.info("a line this build does not read: \(line.kind, privacy: .public)") }
      }
      changed()
    case .caughtUp(let count):
      dropped = Int(clamping: count)
      if !caught {
        caught = true
        publish()
      } else {
        changed()
      }
    case .run(let run):
      if !runs.contains(where: { $0.runtimeRunId == run.runtimeRunId }) { runs.append(run) }
      changed()
    case .refused(let reason):
      // the worker closes the socket after it: the close asks again
      Self.logger.info("the transcript worker refused the open: \(reason, privacy: .public)")
    }
  }

  /// The ticket's runs into the held ones, oldest first (a time that does not read is 0, as `SparkEntries.time` reads
  /// the Mac's NaN); runs of one time keep their place.
  private func merge(_ named: [SparkTranscriptRun]) {
    for run in named where !runs.contains(where: { $0.runtimeRunId == run.runtimeRunId }) { runs.append(run) }
    runs = runs.enumerated()
      .sorted { a, b in
        let at = SparkEntries.time(a.element.startedAt)
        let bt = SparkEntries.time(b.element.startedAt)
        return at != bt ? at < bt : a.offset < b.offset
      }
      .map(\.element)
  }

  private func dropSocket() {
    guard let was = socket else { return }
    socket = nil
    Task { await was.connection.close() }
  }

  /// A change heard after the first `caught-up` is drawn; before it, the catch-up is still arriving.
  private func changed() {
    if caught { publish() }
  }

  private func publish() {
    guard !stopped else { return }
    reading = .ready(runs: runs, lines: lines, dropped: dropped, whole: whole)
  }
}
