import Foundation

// SP-7a (red) — THE SPARK'S TRANSCRIPT, read on the phone (`packages/contracts/src/spark-transcript.ts`). A skeleton
// the rows compile against: the shapes are declared and read nothing yet.

/// `SPARK_TRANSCRIPT` and `SPARK_TRANSCRIPT_FORMAT` (`registries.ts`, `spark-transcript.ts`), mirrored as literals.
public enum SparkTranscriptLimits {
  public static let format: Int64 = 1
  public static let ticketTTLMs: Int64 = 60_000
  public static let runsMax = 256
  public static let openTimeoutMs: Int64 = 10_000
  public static let retryMinMs: Int64 = 500
  public static let retryMaxMs: Int64 = 10_000
  public static let openTicketMethod = "compose.sparks.transcript.openTicket"
}

private func unread(_ shape: String) -> WireDecodeError {
  WireDecodeError(shape: shape, reason: "not read yet (SP-7a red)")
}

public struct SparkTranscriptChip: Sendable, Equatable {
  public let start: Int
  public let length: Int
  public let kind: String
}

public struct SparkTranscriptYou: Sendable, Equatable {
  public let via: String
  public let text: String
  public let input: String?
  public let requestId: String?
  public let state: String?
  public let chips: [SparkTranscriptChip]?
}

public struct SparkTranscriptTool: Sendable, Equatable {
  public let toolCallId: String
  public let turn: String?
  public let toolKind: String
  public let detail: String?
  public let ours: Bool
}

public enum SparkTranscriptBody: Sendable, Equatable {
  case run(runtimeRunId: String, fresh: Bool)
  case you(SparkTranscriptYou)
  case outcome(of: String, state: String, reason: String?)
  case reply(messageId: String, turn: String?, text: String)
  case tool(SparkTranscriptTool)
  case act(what: String, text: String, crew: String?)
  case turn(edge: String, turn: String?)
  case gap(since: String)

  public var kind: String {
    switch self {
    case .run: "run"
    case .you: "you"
    case .outcome: "outcome"
    case .reply: "reply"
    case .tool: "tool"
    case .act: "act"
    case .turn: "turn"
    case .gap: "gap"
    }
  }
}

/// A line as one of this build's kinds (`SparkTranscriptKnownLine`): what the reader holds and the thread folds.
public struct SparkTranscriptKnownLine: Sendable, Equatable {
  public let seq: Int64
  public let at: String
  public let body: SparkTranscriptBody

  public var kind: String { body.kind }
}

public struct SparkTranscriptLine: Sendable, Equatable {
  public let v: Int64
  public let seq: Int64
  public let mac: String
  public let kind: String
  public let at: String
  public let body: SparkTranscriptBody?
  public let unknownFields: [String]

  public init(json: JSONValue) throws { throw unread("SparkTranscriptLine") }

  public var known: SparkTranscriptKnownLine? { nil }
}

public struct SparkTranscriptRun: Sendable, Equatable {
  public let runtimeRunId: String
  public let startedAt: String
  public let fresh: Bool
  public let unknownFields: [String]

  public init(runtimeRunId: String, startedAt: String, fresh: Bool) {
    self.runtimeRunId = runtimeRunId
    self.startedAt = startedAt
    self.fresh = fresh
    unknownFields = []
  }

  public init(json: JSONValue) throws { throw unread("SparkTranscriptRun") }
}

public enum SparkTranscriptFrame: Sendable, Equatable {
  case ready(generation: Int64)
  case line(run: String, line: SparkTranscriptLine)
  case caughtUp(dropped: Int64)
  case run(SparkTranscriptRun)
  case refused(reason: String)

  public init(text: String) throws { throw unread("SparkTranscriptServerFrame") }
  public init(json: JSONValue) throws { throw unread("SparkTranscriptServerFrame") }
}

public struct SparkTranscriptOpen: Sendable, Equatable {
  public struct Run: Sendable, Equatable {
    public let run: String
    public let after: Int64?

    public init(run: String, after: Int64?) {
      self.run = run
      self.after = after
    }
  }

  public let ticket: String
  public let runs: [Run]

  public init(ticket: String, runs: [Run]) {
    self.ticket = ticket
    self.runs = runs
  }

  public var json: JSONValue { .object([:]) }
  public func text() throws -> String { "{}" }
}

public struct SparkTranscriptTicket: Sendable, Equatable {
  public let spark: String
  public let endpoint: URL
  public let ticket: String
  public let expiresAt: Int64
  public let generation: Int64
  public let runs: [SparkTranscriptRun]
  public let unknownFields: [String]

  public init(json: JSONValue) throws { throw unread("SparkTranscriptOpenTicketResult") }
}
