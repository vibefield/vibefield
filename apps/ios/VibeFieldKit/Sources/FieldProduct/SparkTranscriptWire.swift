import Foundation

// SP-7a — THE SPARK'S TRANSCRIPT, read on the phone (`packages/contracts/src/spark-transcript.ts`; TH-1, DESIGN.md §8
// "Chat's thread"). fieldd keeps a spark's conversation as its own record: one JSONL file per run, each line MAC'd over
// `{spark, run, line}`. A worker of fieldd's own serves it on a socket of its own, by a single-use ticket
// (`compose.sparks.transcript.openTicket`), and never over the door (EL2). This file reads that wire: the lines, the
// worker's frames, the window's one `open`, and the ticket's answer. `SparkTranscriptReader.swift` walks it.
//
// THE POSTURE is the remote cut's (`AgentRemoteShapes.swift`): the phone refuses where zod refuses, and keeps an OPEN
// word as it came. A line has two layers, as the contract does:
// - its HEAD (`SparkTranscriptLine`: `v`, `seq`, `mac`, `kind`, `at`) is required. A line whose head does not read is
//   no line, and the frame carrying it is passed over.
// - its BODY is read only for the format this build writes and a kind it knows (`sparkTranscriptLineOf`). Any other
//   line keeps its head and no body: a newer format, a kind this build does not know, a body zod would refuse, or
//   chips that do not stand inside the words. A reader still counts its place (`seq`) and skips it.
// The MAC is carried and never checked. The phone holds no key, and the worker never serves a line that fails its
// check; the forged golden reads as any line, as the contract's own row says.

/// `SPARK_TRANSCRIPT` and `SPARK_TRANSCRIPT_FORMAT` (`registries.ts`, `spark-transcript.ts`), mirrored as literals
/// (`PhoneBudget.swift`'s rule: this app sits outside `pnpm verify`, so moving one is a deliberate event).
public enum SparkTranscriptLimits {
  /// `SPARK_TRANSCRIPT_FORMAT`: the line format this build reads a body of.
  public static let format: Int64 = 1
  /// `SPARK_TRANSCRIPT.TICKET_TTL_MS`: a ticket's redemption bound (an open socket has no timer).
  public static let ticketTTLMs: Int64 = 60_000
  /// `SPARK_TRANSCRIPT.RUNS_MAX`: the runs a ticket names, and an open reads, at most.
  public static let runsMax = 256
  /// `SPARK_TRANSCRIPT.OPEN_TIMEOUT_MS`: an open that has not heard `ready` by then asks again.
  public static let openTimeoutMs: Int64 = 10_000
  /// `SPARK_TRANSCRIPT.RETRY_MIN_MS` doubling to `RETRY_MAX_MS`: the asks again.
  public static let retryMinMs: Int64 = 500
  public static let retryMaxMs: Int64 = 10_000
  /// `PORTS.SPARK_TRANSCRIPT_SERVE`: the worker's routed serve, the tailnet port a phone's ticket names (SP-7a D1).
  public static let servePort = 9426
  /// The door that hands a ticket (`methods.ts`).
  public static let openTicketMethod = "compose.sparks.transcript.openTicket"
}

// MARK: - Ids and bounds (spark-transcript.ts, workspace.ts, compose.ts, agent-session.ts)

enum TranscriptWire {
  /// `RunId`: `z.string().min(1).max(128)`.
  static let runId = 1...128
  /// A line's `kind`, an act's `what`, a turn's `edge`, an outcome's `state`, a you line's `via`.
  static let word = 1...32
  /// `SparkTranscriptRefused.reason`.
  static let reason = 1...64
  static let anyText = 1...Int.max

  /// `SparkTranscriptMac`: `/^[0-9a-f]{64}$/`.
  static func isMac(_ text: String) -> Bool {
    let bytes = Array(text.utf8)
    return bytes.count == 64 && bytes.allSatisfy { (0x30...0x39).contains($0) || (0x61...0x66).contains($0) }
  }

  /// `WorkspaceCredential`: `/^[A-Za-z0-9_-]{43}$/`.
  static func isCredential(_ text: String) -> Bool { isToken(text, 43...43) }

  /// `ComposeSayRequestId`: `/^[A-Za-z0-9_-]{8,64}$/`.
  static func isRequestId(_ text: String) -> Bool { isToken(text, 8...64) }

  /// `CrewId`: `/^cr-[0-9a-z]{6,32}$/`.
  static func isCrewId(_ text: String) -> Bool {
    let bytes = Array(text.utf8)
    let tail = bytes.dropFirst(3)
    return bytes.starts(with: Array("cr-".utf8)) && (6...32).contains(tail.count)
      && tail.allSatisfy { (0x30...0x39).contains($0) || (0x61...0x7A).contains($0) }
  }

  private static func isToken(_ text: String, _ bound: ClosedRange<Int>) -> Bool {
    let bytes = Array(text.utf8)
    return bound.contains(bytes.count)
      && bytes.allSatisfy {
        (0x30...0x39).contains($0) || (0x41...0x5A).contains($0) || (0x61...0x7A).contains($0) || $0 == 0x5F
          || $0 == 0x2D
      }
  }
}

// MARK: - A line

/// A chip in your words (`ComposeSayChip`): where its words stand in `text`, in UTF-16 units as the window counts,
/// and what it stands for, OPEN (agent | session | card).
public struct SparkTranscriptChip: Sendable, Equatable {
  public let start: Int
  public let length: Int
  public let kind: String

  init(json: JSONValue) throws {
    var object = try WireObject(shape: "ComposeSayChip", value: json)
    start = Int(try object.integer("start", atLeast: 0))
    length = Int(try object.integer("length", atLeast: 1))
    kind = try object.text("kind", TranscriptWire.word)
  }

  /// `composeChipsFit`: in order, none overlapping, each inside the words.
  static func fit(_ text: String, _ chips: [SparkTranscriptChip]) -> Bool {
    let units = text.utf16.count
    var end = 0
    for chip in chips {
      if chip.start < end || chip.start + chip.length > units { return false }
      end = chip.start + chip.length
    }
    return true
  }
}

/// Your words (`SparkTranscriptYouLine`). `via` is OPEN: `chat`, a say from any screen with its queued input, request
/// id and receipt; `terminal`, a prompt typed into the spark's terminal, with none of those.
public struct SparkTranscriptYou: Sendable, Equatable {
  public let via: String
  public let text: String
  public let input: String?
  public let requestId: String?
  /// the receipt the say was queued with (COMPOSE_SAY_STATES, OPEN)
  public let state: String?
  public let chips: [SparkTranscriptChip]?

  init(_ object: inout WireObject) throws {
    let shape = object.shape
    via = try object.text("via", TranscriptWire.word)
    text = try object.text("text", TranscriptWire.anyText)
    input = try object.typedString("input", 1...64)
    let requestId = try object.typedString("requestId")
    if let requestId, !TranscriptWire.isRequestId(requestId) {
      throw WireDecodeError(shape: shape, reason: "`requestId` is not a request id")
    }
    self.requestId = requestId
    state = try object.typedString("state", TranscriptWire.word)
    let chips = try object.strict("chips") { raw -> [SparkTranscriptChip] in
      guard let elements = raw.arrayValue else {
        throw WireDecodeError(shape: shape, reason: "`chips` is not an array")
      }
      return try elements.map(SparkTranscriptChip.init(json:))
    }
    if let chips, !SparkTranscriptChip.fit(text, chips) {
      throw WireDecodeError(shape: shape, reason: "`chips` do not stand inside `text`")
    }
    self.chips = chips
  }
}

/// A tool the agent asked for (`SparkTranscriptToolLine`), by its provider-neutral kind (OPEN) and what it touched;
/// never the tool's own name (AR-L1). `ours`: fieldd served the call.
public struct SparkTranscriptTool: Sendable, Equatable {
  public let toolCallId: String
  public let turn: String?
  public let toolKind: String
  public let detail: String?
  public let ours: Bool

  init(_ object: inout WireObject) throws {
    toolCallId = try object.text("toolCallId", 1...256)
    turn = try object.typedString("turn", 1...256)
    toolKind = try object.text("toolKind", TranscriptWire.word)
    detail = try object.typedString("detail", 1...2_000)
    // `z.literal(true).optional()`: absent is not ours, and `false` is refused
    switch try object.typedBool("ours") {
    case nil: ours = false
    case true?: ours = true
    case false?: throw WireDecodeError(shape: object.shape, reason: "`ours` is false; it is true or absent")
    }
  }
}

/// A line's body, as one of this build's kinds (`SparkTranscriptKnownLine`).
public enum SparkTranscriptBody: Sendable, Equatable {
  /// A run of the spark entered the record: its file's first line. `fresh` when it began a conversation.
  case run(runtimeRunId: String, fresh: Bool)
  case you(SparkTranscriptYou)
  /// What became of your words (`of`: the you line's `input`); the latest for an input stands.
  case outcome(of: String, state: String, reason: String?)
  /// One of the agent's messages, whole. A later line with the same `messageId` replaces it where it stands.
  case reply(messageId: String, turn: String?, text: String)
  case tool(SparkTranscriptTool)
  /// VibeField's own act: `what` OPEN (wake | answer | notify | crew). A later line with the same `crew` replaces it.
  case act(what: String, text: String, crew: String?)
  /// A turn's edge: OPEN (start | end | failed).
  case turn(edge: String, turn: String?)
  /// fieldd was not listening from `since`.
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

  /// `kind`'s body, or nil for a kind this build does not know. Throws for a known kind whose body zod would refuse.
  static func read(kind: String, _ object: inout WireObject) throws -> SparkTranscriptBody? {
    switch kind {
    case "run":
      let runtimeRunId = try object.text("runtimeRunId", TranscriptWire.runId)
      return .run(runtimeRunId: runtimeRunId, fresh: try object.flag("fresh"))
    case "you":
      return .you(try SparkTranscriptYou(&object))
    case "outcome":
      let of = try object.text("of", 1...64)
      let state = try object.text("state", TranscriptWire.word)
      return .outcome(of: of, state: state, reason: try object.typedString("reason", 1...500))
    case "reply":
      let messageId = try object.text("messageId", 1...256)
      let turn = try object.typedString("turn", 1...256)
      return .reply(messageId: messageId, turn: turn, text: try object.text("text", TranscriptWire.anyText))
    case "tool":
      return .tool(try SparkTranscriptTool(&object))
    case "act":
      let what = try object.text("what", TranscriptWire.word)
      let text = try object.text("text", TranscriptWire.anyText)
      let crew = try object.typedString("crew")
      if let crew, !TranscriptWire.isCrewId(crew) {
        throw WireDecodeError(shape: object.shape, reason: "`crew` is not a crew id")
      }
      return .act(what: what, text: text, crew: crew)
    case "turn":
      let edge = try object.text("edge", TranscriptWire.word)
      return .turn(edge: edge, turn: try object.typedString("turn", 1...256))
    case "gap":
      return .gap(since: try object.text("since", TranscriptWire.anyText))
    default:
      return nil
    }
  }
}

/// A line as one of this build's kinds (`SparkTranscriptKnownLine`): what the reader holds and the thread folds.
public struct SparkTranscriptKnownLine: Sendable, Equatable {
  /// its place in its run's file
  public let seq: Int64
  /// when it happened (ISO)
  public let at: String
  public let body: SparkTranscriptBody

  public var kind: String { body.kind }
}

/// One line of a run's transcript: its head, and its body when this build reads one (see the header).
public struct SparkTranscriptLine: Sendable, Equatable {
  public let v: Int64
  /// its place in its run's file: 1, 2, 3… with no gap
  public let seq: Int64
  public let mac: String
  /// OPEN: a kind this build does not know keeps its head
  public let kind: String
  /// when it happened (ISO)
  public let at: String
  /// the line as one of this build's kinds, else nil (`sparkTranscriptLineOf`)
  public let body: SparkTranscriptBody?
  /// keys this build did not read: the body's too, when it read none
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    let shape = "SparkTranscriptLine"
    var head = try WireObject(shape: shape, value: json)
    v = try head.integer("v", atLeast: 1)
    seq = try head.integer("seq", atLeast: 1)
    mac = try head.text("mac")
    guard TranscriptWire.isMac(mac) else {
      throw WireDecodeError(shape: shape, reason: "`mac` is not a hex HMAC-SHA256")
    }
    kind = try head.text("kind", TranscriptWire.word)
    at = try head.text("at", TranscriptWire.anyText)
    var known = head
    let body: SparkTranscriptBody?
    if v == SparkTranscriptLimits.format {
      body = (try? SparkTranscriptBody.read(kind: kind, &known)) ?? nil
    } else {
      body = nil
    }
    self.body = body
    unknownFields = (body == nil ? head : known).unknownFields
  }

  /// The line as one of this build's kinds, else nil (`sparkTranscriptLineOf`).
  public var known: SparkTranscriptKnownLine? {
    body.map { SparkTranscriptKnownLine(seq: seq, at: at, body: $0) }
  }
}

// MARK: - The worker's frames

/// One run of the spark, as its record names it (`SparkTranscriptRun`).
public struct SparkTranscriptRun: Sendable, Equatable {
  public let runtimeRunId: String
  /// its `run` line's time (ISO)
  public let startedAt: String
  /// it began a conversation
  public let fresh: Bool
  public let unknownFields: [String]

  public init(runtimeRunId: String, startedAt: String, fresh: Bool) {
    self.runtimeRunId = runtimeRunId
    self.startedAt = startedAt
    self.fresh = fresh
    unknownFields = []
  }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "SparkTranscriptRun", value: json)
    runtimeRunId = try object.text("runtimeRunId", TranscriptWire.runId)
    startedAt = try object.text("startedAt", TranscriptWire.anyText)
    fresh = try object.flag("fresh")
    unknownFields = object.unknownFields
  }
}

/// What the worker sends (`SparkTranscriptServerFrame`), one JSON text frame each. A type this build does not know
/// does not read, and the reader passes it over.
public enum SparkTranscriptFrame: Sendable, Equatable {
  /// the ticket redeemed: lines follow
  case ready(generation: Int64)
  /// one verified line of `run`, in order within its run
  case line(run: String, line: SparkTranscriptLine)
  /// every line the open named is served; the tail follows. `dropped` counts lines that failed their check.
  case caughtUp(dropped: Int64)
  /// a run of the spark began after the open: its lines follow
  case run(SparkTranscriptRun)
  /// the open is refused, then the socket closes: the worker's word, OPEN
  case refused(reason: String)

  public init(text: String) throws {
    try self.init(json: try JSONValue.parse(Data(text.utf8)))
  }

  public init(json: JSONValue) throws {
    let shape = "SparkTranscriptServerFrame"
    var object = try WireObject(shape: shape, value: json)
    let type = try object.text("type")
    switch type {
    case "ready":
      self = .ready(generation: try object.integer("generation", atLeast: 1))
    case "line":
      let run = try object.text("run", TranscriptWire.runId)
      self = .line(run: run, line: try object.requiredObject("line", SparkTranscriptLine.init(json:)))
    case "caught-up":
      self = .caughtUp(dropped: try object.integer("dropped", atLeast: 0))
    case "run":
      self = .run(try object.requiredObject("run", SparkTranscriptRun.init(json:)))
    case "refused":
      self = .refused(reason: try object.text("reason", TranscriptWire.reason))
    default:
      throw WireDecodeError(shape: shape, reason: "`type` is `\(type)`, not a frame this build reads")
    }
  }
}

/// The window's one message (`SparkTranscriptOpen`): the ticket, and the runs it reads, oldest first, each after the
/// last line it holds.
public struct SparkTranscriptOpen: Sendable, Equatable {
  public struct Run: Sendable, Equatable {
    public let run: String
    /// the newest `seq` held; nil reads the run from its start
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

  public var json: JSONValue {
    .object([
      "type": .string("open"),
      "ticket": .string(ticket),
      "runs": .array(
        runs.map { run in
          var fields: [String: JSONValue] = ["run": .string(run.run)]
          if let after = run.after { fields["after"] = .int(after) }
          return .object(fields)
        }),
    ])
  }

  public func text() throws -> String {
    String(decoding: try json.encoded(), as: UTF8.self)
  }
}

// MARK: - The ticket

/// `compose.sparks.transcript.openTicket`'s answer (`SparkTranscriptOpenTicketResult`): a fresh, single-use
/// credential for the spark's record on the worker's listener, the worker's generation, and the spark's runs, oldest
/// first. Every answer is a new one; `expiresAt` bounds its redemption alone.
public struct SparkTranscriptTicket: Sendable, Equatable {
  public let spark: String
  public let endpoint: URL
  public let ticket: String
  public let expiresAt: Int64
  public let generation: Int64
  public let runs: [SparkTranscriptRun]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    let shape = "SparkTranscriptOpenTicketResult"
    var object = try WireObject(shape: shape, value: json)
    guard let spark = try SparkWire.id(&object, "spark", shape: shape, SparkWire.isSparkId, "a spark id") else {
      throw object.missing("spark")
    }
    self.spark = spark
    guard let endpoint = Self.loopback(try object.text("endpoint")) else {
      throw WireDecodeError(shape: shape, reason: "`endpoint` is not a credential-free loopback WebSocket endpoint")
    }
    self.endpoint = endpoint
    let ticket = try object.text("ticket")
    guard TranscriptWire.isCredential(ticket) else {
      throw WireDecodeError(shape: shape, reason: "`ticket` is not a credential")
    }
    self.ticket = ticket
    expiresAt = try object.integer("expiresAt", atLeast: 1)
    generation = try object.integer("generation", atLeast: 1)
    let runs = try object.requiredArray(strict: "runs")
    guard runs.count <= SparkTranscriptLimits.runsMax else {
      throw WireDecodeError(shape: shape, reason: "`runs` holds \(runs.count), over \(SparkTranscriptLimits.runsMax)")
    }
    self.runs = try runs.map(SparkTranscriptRun.init(json:))
    unknownFields = object.unknownFields
  }

  /// `WorkspaceLoopbackSocket`: `ws:` on `127.0.0.1` with a port, and no user, password, query or fragment.
  static func loopback(_ text: String) -> URL? {
    guard let parts = URLComponents(string: text), parts.scheme == "ws", parts.host == "127.0.0.1",
      parts.port != nil, parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil
    else { return nil }
    return parts.url
  }
}
