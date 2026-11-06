import Foundation
import Observation

// SP-7a (red) — the spark's transcript, read on the phone as the Mac reads it (`packages/field-app/src/chat/
// transcript-port.ts`). A skeleton the rows compile against: it asks nothing, dials nothing, and reads nothing yet.

/// The door the reader asks for a ticket: the home's own client.
@MainActor
public protocol SparkTranscriptDoor: AnyObject {
  func call(_ method: String, params: JSONValue?) async throws -> JSONValue
}

extension FieldProductClient: SparkTranscriptDoor {}

/// What the thread reads of the spark's record (the Mac's `TranscriptReading`).
public enum SparkTranscriptReading: Equatable, Sendable {
  case reading
  case unreadable(reason: String, device: String?)
  case ready(runs: [SparkTranscriptRun], lines: [String: [SparkTranscriptKnownLine]], dropped: Int, whole: Bool)

  public static func latestConversation(of runs: [SparkTranscriptRun]) -> [SparkTranscriptRun] { [] }

  public static func of(
    runs: [SparkTranscriptRun], raw: [String: [JSONValue]], dropped: Int = 0, whole: Bool = false
  ) -> SparkTranscriptReading {
    .reading
  }
}

@MainActor
@Observable
public final class SparkTranscriptReader {
  public typealias Sleep = @Sendable (Duration) async throws -> Void

  public let spark: String
  public private(set) var reading: SparkTranscriptReading = .reading
  public private(set) var whole: Bool
  @ObservationIgnored public private(set) var skipped = 0

  @ObservationIgnored private let door: any SparkTranscriptDoor
  @ObservationIgnored private let transport: any ProductTransport
  @ObservationIgnored private let sleep: Sleep
  @ObservationIgnored private let openTimeout: Duration

  public init(
    spark: String, door: any SparkTranscriptDoor, transport: any ProductTransport, whole: Bool = false,
    held: SparkTranscriptReading = .reading, sleep: @escaping Sleep = { try await Task.sleep(for: $0) },
    openTimeout: Duration = .milliseconds(SparkTranscriptLimits.openTimeoutMs)
  ) {
    self.spark = spark
    self.door = door
    self.transport = transport
    self.whole = whole
    self.sleep = sleep
    self.openTimeout = openTimeout
  }

  /// The ticket's ask, as the door reads it.
  public nonisolated static func ticketParams(spark: String) -> JSONValue { .object([:]) }

  public func start() {}

  public func readWhole() {}

  public func reconnected() {}

  public func cancel() {}
}
