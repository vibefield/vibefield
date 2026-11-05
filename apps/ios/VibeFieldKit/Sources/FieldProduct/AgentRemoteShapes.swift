import Foundation

// PG-3c — THE REMOTE CUT, read on the phone (`packages/contracts/src/agent-field.ts`: `MonitorAgentRow`,
// `AgentRemoteRow`, and the mesh envelopes over it, `rows.ts`'s `rowsSnapshot`/`rowsDelta`/`meshRowsOpen`/
// `meshRowsFrame`). FieldLink asks for it since PG-3e (`phoneRemote`), through 3d's fold (`RemoteMeshCopy`). (Corrected
// 2026-11-02: this said nothing asked for it yet, and FieldLink subscribed to the `field` cut, `phoneMesh`.)
//
// THE RULE THAT SETS THE SHAPE: the phone refuses a row exactly where the home's window refuses it. The window screens
// each row with `AgentModelMeshRow.safeParse` (`field-app/src/godview/monitor/board-screen.ts`), so a row here is
// REFUSED wherever zod would fail it — a required field missing or of another type, `null` at a key zod reads as
// `.optional()` (only `project.branch` is nullable), a CLOSED word it does not know, a length or sign bound broken —
// and never for an OPEN word, which is kept as it came (`.unrecognized`, or a plain `String`). Length bounds count
// UTF-16 code units, as zod's `.min`/`.max` do. That departs, for this cut only, from the kit's keep-the-word
// precedent (`AgentTerminalJoin.hosted`, `AgentRowStatus`), which stays for the `field` cut (VF-PM, Q-C1).
//
// A refused row costs only itself: an envelope reads every row on its own and names the refused ones by key
// (`AgentRemoteRowRefusal`), and `RemoteBoardScreen` turns that into the window's `incompatible`. An envelope's OWN
// fault (a missing epoch, a negative revision, a malformed device entry) throws the whole envelope, as zod does.
//
// Residual parity gaps, by design: the window's union tries `AgentModelDeskRow` first, a this-desktop row a remote cut
// never carries (it needs the field half at the root), so a row that is not a remote row but IS a desk row passes
// there and is refused here; and a frame's own unknown keys are not named (the frame is an enum, as the field cut's
// `AgentMeshFrame` was until PG-3e retired it).

// MARK: - Strict reads

// Shared with the spark doors' readers (`SparkShapes.swift`, IOS-12b), which keep this cut's posture.
extension WireObject {
  func mismatch(_ key: String, _ expected: String) -> WireDecodeError {
    WireDecodeError(shape: shape, reason: "`\(key)` is not \(expected)")
  }

  /// The value at a KNOWN key as zod reads it: absent is nil, `null` is refused (`.optional()` is not
  /// `.nullable()`), and the key is marked read either way.
  mutating func present(_ key: String) throws -> JSONValue? {
    let raw = fields[key]
    _ = value(key)
    guard let raw else { return nil }
    if raw.isNull { throw WireDecodeError(shape: shape, reason: "`\(key)` is null") }
    return raw
  }

  /// Absent → nil; present with another JSON type → the row is refused (zod's posture on a known key).
  mutating func typedString(_ key: String) throws -> String? {
    guard let raw = try present(key) else { return nil }
    guard let text = raw.stringValue else { throw mismatch(key, "a string") }
    return text
  }

  /// An integer: 5.0 reads, 5.5 refuses (`JSONValue.intValue`, as `z.number().int()`).
  mutating func typedInt(_ key: String) throws -> Int64? {
    guard let raw = try present(key) else { return nil }
    guard let number = raw.intValue else { throw mismatch(key, "an integer") }
    return number
  }

  mutating func typedDouble(_ key: String) throws -> Double? {
    guard let raw = try present(key) else { return nil }
    guard let number = raw.doubleValue else { throw mismatch(key, "a number") }
    return number
  }

  mutating func typedBool(_ key: String) throws -> Bool? {
    guard let raw = try present(key) else { return nil }
    guard let flag = raw.boolValue else { throw mismatch(key, "a boolean") }
    return flag
  }

  func missing(_ key: String) -> WireDecodeError {
    WireDecodeError(shape: shape, reason: "missing `\(key)`")
  }

  /// Required text, where "" is a value (`z.string()` with no `.min`).
  mutating func text(_ key: String) throws -> String {
    guard let text = try typedString(key) else { throw missing(key) }
    return text
  }

  /// Required text inside a UTF-16 length bound (`z.string().min(a).max(b)`).
  mutating func text(_ key: String, _ bound: ClosedRange<Int>) throws -> String {
    try bounded(key, try text(key), bound)
  }

  mutating func typedString(_ key: String, _ bound: ClosedRange<Int>) throws -> String? {
    guard let text = try typedString(key) else { return nil }
    return try bounded(key, text, bound)
  }

  func bounded(_ key: String, _ text: String, _ bound: ClosedRange<Int>) throws -> String {
    guard bound.contains(text.utf16.count) else {
      throw WireDecodeError(
        shape: shape,
        reason: "`\(key)` is \(text.utf16.count) UTF-16 units, outside \(bound.lowerBound)…\(bound.upperBound)")
    }
    return text
  }

  mutating func integer(_ key: String) throws -> Int64 {
    guard let number = try typedInt(key) else { throw missing(key) }
    return number
  }

  /// A required integer at or above a floor (`.nonnegative()` is 0, `.positive()` is 1).
  mutating func integer(_ key: String, atLeast floor: Int64) throws -> Int64 {
    try atLeast(key, try integer(key), floor)
  }

  mutating func typedInt(_ key: String, atLeast floor: Int64) throws -> Int64? {
    guard let number = try typedInt(key) else { return nil }
    return try atLeast(key, number, floor)
  }

  func atLeast(_ key: String, _ number: Int64, _ floor: Int64) throws -> Int64 {
    guard number >= floor else {
      throw WireDecodeError(shape: shape, reason: "`\(key)` is \(number), below \(floor)")
    }
    return number
  }

  mutating func number(_ key: String) throws -> Double {
    guard let number = try typedDouble(key) else { throw missing(key) }
    return number
  }

  mutating func flag(_ key: String) throws -> Bool {
    guard let flag = try typedBool(key) else { throw missing(key) }
    return flag
  }

  /// A CLOSED word (a zod enum or literal): absent → nil, a word this build does not know → refused.
  mutating func closed<W: RawRepresentable>(_ key: String, _: W.Type) throws -> W?
  where W.RawValue == String {
    guard let word = try typedString(key) else { return nil }
    guard let value = W(rawValue: word) else {
      throw WireDecodeError(shape: shape, reason: "`\(key)` is `\(word)`, not a word this build reads")
    }
    return value
  }

  mutating func requiredClosed<W: RawRepresentable>(_ key: String, _ type: W.Type) throws -> W
  where W.RawValue == String {
    guard let value = try closed(key, type) else { throw missing(key) }
    return value
  }

  /// A known key read strictly by `read`: absent → nil, `null` → refused, a value `read` refuses → refused.
  mutating func strict<T>(_ key: String, _ read: (JSONValue) throws -> T) throws -> T? {
    guard let raw = try present(key) else { return nil }
    return try read(raw)
  }

  /// A sub-shape read strictly: absent → nil, `null` or a non-object → refused, a malformed one → refused.
  mutating func strictObject<T>(_ key: String, _ make: (JSONValue) throws -> T) throws -> T? {
    try strict(key, make)
  }

  mutating func requiredObject<T>(_ key: String, _ make: (JSONValue) throws -> T) throws -> T {
    guard let value = try strictObject(key, make) else { throw missing(key) }
    return value
  }

  mutating func requiredArray(strict key: String) throws -> [JSONValue] {
    guard let raw = try present(key) else { throw missing(key) }
    guard let elements = raw.arrayValue else { throw mismatch(key, "an array") }
    return elements
  }

  /// A key the window's union does not read on this row: kept when it reads, left UNREAD (so it is named in
  /// `unknownFields`) when it does not, and never a refusal.
  mutating func tolerant<T>(_ key: String, _ read: (JSONValue) throws -> T) -> T? {
    guard let raw = fields[key], let value = try? read(raw) else { return nil }
    _ = self.value(key)
    return value
  }
}

// MARK: - Closed words (a word this build does not know refuses the row)

/// `monitorRow.kind` (`z.enum(["agent", "terminal"])`).
public enum MonitorRowKind: String, Sendable, Equatable { case agent, terminal }
/// `monitorRow.status` (`z.enum(["idle", "working", "blocked"])`).
public enum MonitorRowStatus: String, Sendable, Equatable { case idle, working, blocked }
/// `monitorRow.effort.intent`.
public enum MonitorEffortIntent: String, Sendable, Equatable { case configured, observed }
/// `monitorRow.tier` (`AgentTier`, `agent-session.ts`).
public enum MonitorTier: String, Sendable, Equatable { case managed, ingested, remote }

// MARK: - Open words (kept as they came, never a refusal)

/// `cost.coverage` — open upstream; core's words today.
public enum MonitorCostCoverage: Sendable, Equatable {
  case complete
  case partial
  case unavailable
  case unrecognized(String)

  public init(wire: String) {
    switch wire {
    case "complete": self = .complete
    case "partial": self = .partial
    case "unavailable": self = .unavailable
    default: self = .unrecognized(wire)
    }
  }

  public var wire: String {
    switch self {
    case .complete: "complete"
    case .partial: "partial"
    case .unavailable: "unavailable"
    case .unrecognized(let word): word
    }
  }
}

/// `device.os` — the SDK's OS mark, open.
public enum MonitorDeviceOS: Sendable, Equatable {
  case mac
  case windows
  case linux
  case ios
  case android
  case unrecognized(String)

  public init(wire: String) {
    switch wire {
    case "mac": self = .mac
    case "windows": self = .windows
    case "linux": self = .linux
    case "ios": self = .ios
    case "android": self = .android
    default: self = .unrecognized(wire)
    }
  }

  public var wire: String {
    switch self {
    case .mac: "mac"
    case .windows: "windows"
    case .linux: "linux"
    case .ios: "ios"
    case .android: "android"
    case .unrecognized(let word): word
    }
  }
}

// MARK: - The model row's parts (every clock is epoch milliseconds)

/// A fixed-bucket series, oldest first; the last bucket is still filling.
public struct MonitorSeries: Sendable, Equatable {
  public let stepMs: Int64
  public let steps: [Double]
  public let lastStepAt: Int64
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "MonitorSeries", value: json)
    stepMs = try object.integer("stepMs", atLeast: 1)
    let elements = try object.requiredArray(strict: "steps")
    let steps = elements.compactMap(\.doubleValue)
    guard steps.count == elements.count else { throw object.mismatch("steps", "an array of numbers") }
    self.steps = steps
    lastStepAt = try object.integer("lastStepAt")
    unknownFields = object.unknownFields
  }
}

/// What a blocked run waits on: its first blocker, the parts kept apart. `kind` is the runtime's own OPEN word.
public struct MonitorWait: Sendable, Equatable {
  public let kind: String
  public let since: Int64
  /// How many blockers wait; absent: one.
  public let count: Int64?
  public let tool: String?
  public let code: String?
  public let header: String?
  public let question: String?
  public let detail: String?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "MonitorWait", value: json)
    kind = try object.text("kind")
    since = try object.integer("since")
    count = try object.typedInt("count", atLeast: 1)
    tool = try object.typedString("tool")
    code = try object.typedString("code")
    header = try object.typedString("header")
    question = try object.typedString("question")
    detail = try object.typedString("detail")
    unknownFields = object.unknownFields
  }
}

public struct MonitorActivity: Sendable, Equatable {
  /// OPEN, as it came.
  public let kind: String
  public let line: String?
  public let since: Int64?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "MonitorActivity", value: json)
    kind = try object.text("kind")
    line = try object.typedString("line")
    since = try object.typedInt("since")
    unknownFields = object.unknownFields
  }
}

public struct MonitorReply: Sendable, Equatable {
  public let text: String
  public let at: Int64?
  /// false while the reply is still streaming.
  public let final: Bool?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "MonitorReply", value: json)
    text = try object.text("text")
    at = try object.typedInt("at")
    final = try object.typedBool("final")
    unknownFields = object.unknownFields
  }
}

/// The cost in puppeteer's own words: an estimate of API-equivalent USD, never an invoice.
public struct MonitorCost: Sendable, Equatable {
  public let usd: Double
  public let coverage: MonitorCostCoverage
  public let burnPerHour: Double?
  public let series: MonitorSeries?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "MonitorCost", value: json)
    usd = try object.number("usd")
    coverage = MonitorCostCoverage(wire: try object.text("coverage"))
    burnPerHour = try object.typedDouble("burnPerHour")
    series = try object.strictObject("series", MonitorSeries.init(json:))
    unknownFields = object.unknownFields
  }
}

/// The desktop a row lives on, as its owner names it. `self` is not carried: whether a row is the reader's own
/// desktop is the reader's to say (3d fills it from the home's id).
public struct MonitorDeviceRef: Sendable, Equatable {
  public let id: String
  public let name: String
  public let os: MonitorDeviceOS?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "MonitorDeviceRef", value: json)
    id = try object.text("id", 1...Int.max)
    name = try object.text("name", 1...Int.max)
    os = try object.typedString("os").map(MonitorDeviceOS.init(wire:))
    unknownFields = object.unknownFields
  }
}

/// `project.branch`, the one nullable field: absent, nothing looked; `null`, looked and there is no branch.
public enum MonitorBranch: Sendable, Equatable {
  case notLooked
  case noBranch
  case named(String)
}

public struct MonitorProject: Sendable, Equatable {
  /// A folder NAME, never a path (EL7 B1); empty for a terminal in no project.
  public let name: String
  public let branch: MonitorBranch
  /// This desktop's own colour sequence; a peer's remote cut omits it (M16).
  public let seq: Int64?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "MonitorProject", value: json)
    name = try object.text("name")
    if object.fields["branch"]?.isNull == true {
      _ = object.value("branch")
      branch = .noBranch
    } else {
      branch = try object.typedString("branch").map(MonitorBranch.named) ?? .notLooked
    }
    seq = try object.typedInt("seq", atLeast: 0)
    unknownFields = object.unknownFields
  }
}

public struct MonitorProvider: Sendable, Equatable {
  public let id: String
  public let label: String
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "MonitorProvider", value: json)
    id = try object.text("id")
    label = try object.text("label")
    unknownFields = object.unknownFields
  }
}

public struct MonitorEffort: Sendable, Equatable {
  public let value: String
  public let intent: MonitorEffortIntent?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "MonitorEffort", value: json)
    value = try object.text("value")
    intent = try object.closed("intent", MonitorEffortIntent.self)
    unknownFields = object.unknownFields
  }
}

public struct MonitorContext: Sendable, Equatable {
  public let usedPercent: Double
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "MonitorContext", value: json)
    usedPercent = try object.number("usedPercent")
    unknownFields = object.unknownFields
  }
}

public struct MonitorTokens: Sendable, Equatable {
  public let total: Double?
  public let perMinute: Double?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "MonitorTokens", value: json)
    total = try object.typedDouble("total")
    perMinute = try object.typedDouble("perMinute")
    unknownFields = object.unknownFields
  }
}

// MARK: - The model's row

/// One row of the model (`MonitorAgentRow`), presentation-free: everything a screen may draw about one agent or bare
/// terminal, computed by the backend. On a peer's row it is the OWNER's cut: no `project.seq`, texts bounded.
public struct MonitorAgentRow: Sendable, Equatable {
  /// Stable identity: survives a terminal's promotion and a run's resume. Not the board key.
  public let id: String
  public let kind: MonitorRowKind
  public let createdAt: Int64
  public let status: MonitorRowStatus
  public let statusSince: Int64
  /// Not heard from lately — presentation metadata, never a status.
  public let stale: Bool
  public let alive: Bool
  /// The runtime has reported a state for this run.
  public let observed: Bool
  /// Alive, but nothing drives it yet (AR-4).
  public let pending: Bool?
  public let detail: String
  public let activity: MonitorActivity?
  public let project: MonitorProject
  public let provider: MonitorProvider?
  public let model: String?
  public let effort: MonitorEffort?
  public let account: String?
  public let context: MonitorContext?
  public let wait: MonitorWait?
  public let reply: MonitorReply?
  public let cost: MonitorCost?
  public let tokens: MonitorTokens?
  /// A finished turn nobody has looked at yet.
  public let unread: Bool
  public let device: MonitorDeviceRef
  public let tier: MonitorTier?
  public let profileSet: String?
  /// A pane on the owning desktop can show it now.
  public let attachable: Bool
  /// M41 — whether a pane on ANOTHER desktop may type into this run. Absent from an older peer; `isWritable` fills it.
  public let writable: Bool?
  public let unknownFields: [String]

  /// The reader's fill, the window adapter's rule: an older peer's row says nothing, and it meant `attachable`.
  public var isWritable: Bool { writable ?? attachable }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "MonitorAgentRow", value: json)
    id = try object.text("id", 1...Int.max)
    kind = try object.requiredClosed("kind", MonitorRowKind.self)
    createdAt = try object.integer("createdAt")
    status = try object.requiredClosed("status", MonitorRowStatus.self)
    statusSince = try object.integer("statusSince")
    stale = try object.flag("stale")
    alive = try object.flag("alive")
    observed = try object.flag("observed")
    pending = try object.typedBool("pending")
    detail = try object.text("detail")
    activity = try object.strictObject("activity", MonitorActivity.init(json:))
    project = try object.requiredObject("project", MonitorProject.init(json:))
    provider = try object.strictObject("provider", MonitorProvider.init(json:))
    model = try object.typedString("model")
    effort = try object.strictObject("effort", MonitorEffort.init(json:))
    account = try object.typedString("account")
    context = try object.strictObject("context", MonitorContext.init(json:))
    wait = try object.strictObject("wait", MonitorWait.init(json:))
    reply = try object.strictObject("reply", MonitorReply.init(json:))
    cost = try object.strictObject("cost", MonitorCost.init(json:))
    tokens = try object.strictObject("tokens", MonitorTokens.init(json:))
    unread = try object.flag("unread")
    device = try object.requiredObject("device", MonitorDeviceRef.init(json:))
    tier = try object.closed("tier", MonitorTier.self)
    profileSet = try object.typedString("profileSet")
    attachable = try object.flag("attachable")
    writable = try object.typedBool("writable")
    unknownFields = object.unknownFields
  }
}

// MARK: - The remote row

extension AgentTerminalJoin {
  /// The remote cut's reading of the pane join: `hosted` is CLOSED here (an unknown word refuses the row) and every
  /// optional is read strictly. The `field` cut's tolerant reading (`init(json:)`) is unchanged.
  init(remote json: JSONValue) throws {
    var object = try WireObject(shape: "AgentTerminalJoin", value: json)
    hosted = try object.requiredClosed("hosted", Hosted.self).rawValue
    runtimeSessionId = try object.typedString("runtimeSessionId")
    cellBootId = try object.typedString("cellBootId")
    workloadClass = try object.typedString("workloadClass")
    replaced = try object.typedString("replaced")
    unknownFields = object.unknownFields
  }
}

extension AgentFieldStop {
  /// The remote cut's reading of a durable Stop (`AgentStopState`): `sentAt` may be "" (`z.string()`), `stage` is an
  /// OPEN word of 1 to 32 UTF-16 units, `heardBy` the same when present. The `field` cut's `init(json:)` is unchanged.
  init(remote json: JSONValue) throws {
    var object = try WireObject(shape: "AgentFieldStop", value: json)
    sentAt = try object.text("sentAt")
    stage = try object.text("stage", 1...32)
    heardBy = try object.typedString("heardBy", 1...32)
    unheardAt = try object.typedString("unheardAt")
    unknownFields = object.unknownFields
  }
}

/// IOS-12a — who started a run fieldd launched (`AgentSessionOrigin`, CP-D15; `agent-session.ts`). `by` is OPEN, kept
/// as it came (`you`, `spark` or `flow` today; 1 to 32 UTF-16 units): a word this build never heard of must not refuse
/// a row. A spark's agent names its spark; a flow's step, its run and the call that started it.
public struct AgentSessionOrigin: Sendable, Equatable {
  public let by: String
  public let spark: String?
  /// a flow run's id (CP-4)
  public let run: String?
  /// the run's call that started it, counted from 1 in the run's journal
  public let call: Int64?
  public let unknownFields: [String]

  init(remote json: JSONValue) throws {
    var object = try WireObject(shape: "AgentSessionOrigin", value: json)
    by = try object.text("by", 1...32)
    spark = try object.strict("spark") { try AgentRemoteRow.sparkId($0, shape: "AgentSessionOrigin", key: "spark") }
    run = try object.typedString("run", 1...64)
    call = try object.typedInt("call", atLeast: 1)
    unknownFields = object.unknownFields
  }
}

/// A row of the remote cut (`AgentRemoteRow`): an agent, or (`kind: "terminal"`) a bare terminal. Keyed on the board
/// by `runtimeRunId`, which is NOT `monitorRow.id`.
public struct AgentRemoteRow: Sendable, Equatable, Identifiable {
  /// The board key: the run's id, or a bare terminal's model id (its floor session).
  public let runtimeRunId: String
  /// fieldd's per-row change stamp.
  public let revision: Int64
  /// The desktop the row lives on: its owner.
  public let device: String
  /// A bare terminal's row (root `kind: "terminal"`).
  public let isTerminal: Bool
  /// The pane join, withheld while the owner's terminal doors are down.
  public let terminal: AgentTerminalJoin?
  /// PJ-7 — the provider-native conversation id, never the folder.
  public let nativeSessionId: String?
  /// ST-D5 — the person's durable Stop while fieldd holds one.
  public let stop: AgentFieldStop?
  /// IOS-12a (PC-D1…D8) — the spark whose own session this run is: the field row's `spark` (SP-1b), cut by the owner.
  /// Chat on the phone reads a spark's status by it. Absent on every other run, on a bare terminal's row, and on a row
  /// from a daemon before IOS-12a.
  public let spark: String?
  /// IOS-12a — who started the run (CP-D15). Absent reads `you`, as on the field row.
  public let origin: AgentSessionOrigin?
  public let monitorRow: MonitorAgentRow
  public let unknownFields: [String]

  public var id: String { runtimeRunId }

  /// IOS-12b (PC-D5 A, one need, one count; DESIGN.md §8 "The phone's Chat") — the run is a spark's: its own session
  /// (`spark`, whoever its origin names), or an agent a spark started (`origin.by == "spark"`, as SP-1b's `agentRunsOf`
  /// reads it). Its wait is counted on Chat, with its spark; Field's badge counts only the runs that are no spark's.
  public var ofSpark: Bool { spark != nil || origin?.by == "spark" }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentRemoteRow", value: json)
    runtimeRunId = try object.text("runtimeRunId", 1...Int.max)
    revision = try object.integer("revision")
    device = try object.text("device", 1...Int.max)
    isTerminal = try object.closed("kind", RootKind.self) == .terminal
    terminal = try object.strictObject("terminal", AgentTerminalJoin.init(remote:))
    monitorRow = try object.requiredObject("monitorRow", MonitorAgentRow.init(json:))
    if isTerminal, terminal != nil {
      // The window's union reads a bare terminal with a pane join as `AgentDeskTerminalRow`, which does not look at
      // `nativeSessionId`, `stop`, `spark` or `origin`: kept when they read, named unknown when they do not, never a
      // refusal.
      nativeSessionId = object.tolerant("nativeSessionId", Self.sessionId)
      stop = object.tolerant("stop", AgentFieldStop.init(remote:))
      spark = object.tolerant("spark") { try Self.sparkId($0, shape: "AgentRemoteRow", key: "spark") }
      origin = object.tolerant("origin", AgentSessionOrigin.init(remote:))
    } else {
      nativeSessionId = try object.strict("nativeSessionId", Self.sessionId)
      stop = try object.strictObject("stop", AgentFieldStop.init(remote:))
      spark = try object.strict("spark") { try Self.sparkId($0, shape: "AgentRemoteRow", key: "spark") }
      origin = try object.strictObject("origin", AgentSessionOrigin.init(remote:))
    }
    unknownFields = object.unknownFields
  }

  /// `SparkId` (`agent-session.ts`): `/^sp-[0-9a-z]{6,32}$/`, ASCII only.
  static func sparkId(_ raw: JSONValue, shape: String, key: String) throws -> String {
    guard let text = raw.stringValue else {
      throw WireObject.empty(shape: shape).mismatch(key, "a string")
    }
    let bytes = Array(text.utf8)
    let tail = bytes.dropFirst(3)
    guard bytes.starts(with: Array("sp-".utf8)), (6...32).contains(tail.count),
      tail.allSatisfy({ (0x30...0x39).contains($0) || (0x61...0x7A).contains($0) })
    else {
      throw WireDecodeError(shape: shape, reason: "`\(key)` is not a spark id")
    }
    return text
  }

  private enum RootKind: String { case terminal }

  /// `z.string().min(1).max(256)`.
  private static func sessionId(_ raw: JSONValue) throws -> String {
    let read = WireObject.empty(shape: "AgentRemoteRow")
    guard let text = raw.stringValue else { throw read.mismatch("nativeSessionId", "a string") }
    return try read.bounded("nativeSessionId", text, 1...256)
  }
}

/// A row an envelope could not read, named by its key as the screen holds it.
public struct AgentRemoteRowRefusal: Sendable, Equatable {
  /// The row's `runtimeRunId` when that is a non-empty string, else nil: keyless. `""` is keyless too (VF-PM, Q-C3),
  /// as the window's `keyOf` reads it since item 150 (`47ee475bd`, main 2026-11-01): a key is `min(1)`.
  public let key: String?
  public let reason: String

  public init(key: String?, reason: String) {
    self.key = key
    self.reason = reason
  }
}

extension AgentRemoteRow {
  /// One array of rows, each read on its own: the readable ones in order, and the refused ones named by key. The
  /// envelope never fails for a row.
  static func split(_ elements: [JSONValue]) -> (rows: [AgentRemoteRow], refused: [AgentRemoteRowRefusal]) {
    var rows: [AgentRemoteRow] = []
    var refused: [AgentRemoteRowRefusal] = []
    rows.reserveCapacity(elements.count)
    for element in elements {
      do {
        rows.append(try AgentRemoteRow(json: element))
      } catch {
        let key = element["runtimeRunId"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        refused.append(AgentRemoteRowRefusal(key: key, reason: String(describing: error)))
      }
    }
    return (rows, refused)
  }
}

// MARK: - The mesh envelopes

/// One desktop's board, or one page of it (`rowsSnapshot(AgentRemoteRow)`, the MESH envelope — distinct from the
/// contracts' local-scope `AgentRemoteSnapshot`, whose epoch is optional): a required epoch of 1 to 128 UTF-16 units,
/// a revision at or above 0, and `more` on every page of a paged reset but the last.
public struct AgentRemoteMeshSnapshot: Sendable, Equatable {
  public let epoch: String
  public let revision: Int64
  public let rows: [AgentRemoteRow]
  /// Rows this build could not read, by key. The envelope stands without them.
  public let refused: [AgentRemoteRowRefusal]
  public let more: Bool?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentRemoteMeshSnapshot", value: json)
    epoch = try object.text("epoch", 1...128)
    revision = try object.integer("revision", atLeast: 0)
    let split = AgentRemoteRow.split(try object.requiredArray(strict: "rows"))
    rows = split.rows
    refused = split.refused
    more = try object.typedBool("more")
    unknownFields = object.unknownFields
  }

  init(
    epoch: String, revision: Int64, rows: [AgentRemoteRow], refused: [AgentRemoteRowRefusal], more: Bool?,
    unknownFields: [String]
  ) {
    self.epoch = epoch
    self.revision = revision
    self.rows = rows
    self.refused = refused
    self.more = more
    self.unknownFields = unknownFields
  }

  /// The same snapshot with its refused rows gone: what the screen delivers.
  public var readableOnly: AgentRemoteMeshSnapshot {
    AgentRemoteMeshSnapshot(
      epoch: epoch, revision: revision, rows: rows, refused: [], more: more, unknownFields: unknownFields)
  }
}

/// One desktop's delta (`rowsDelta(AgentRemoteRow)`): applies on top of `since`. Nothing here judges the chain — a
/// gap is the fold's (3d).
public struct AgentRemoteMeshDelta: Sendable, Equatable {
  public let epoch: String
  public let since: Int64
  public let revision: Int64
  public let upserts: [AgentRemoteRow]
  public let refused: [AgentRemoteRowRefusal]
  /// Row KEYS, each a non-empty string.
  public let removed: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentRemoteMeshDelta", value: json)
    epoch = try object.text("epoch", 1...128)
    since = try object.integer("since", atLeast: 0)
    revision = try object.integer("revision", atLeast: 0)
    let split = AgentRemoteRow.split(try object.requiredArray(strict: "upserts"))
    upserts = split.rows
    refused = split.refused
    let elements = try object.requiredArray(strict: "removed")
    let removed = elements.compactMap { $0.stringValue.flatMap { $0.isEmpty ? nil : $0 } }
    guard removed.count == elements.count else {
      throw object.mismatch("removed", "an array of non-empty strings")
    }
    self.removed = removed
    unknownFields = object.unknownFields
  }

  init(
    epoch: String, since: Int64, revision: Int64, upserts: [AgentRemoteRow], refused: [AgentRemoteRowRefusal],
    removed: [String], unknownFields: [String]
  ) {
    self.epoch = epoch
    self.since = since
    self.revision = revision
    self.upserts = upserts
    self.refused = refused
    self.removed = removed
    self.unknownFields = unknownFields
  }

  /// The same delta with its refused rows gone and `keys` appended to `removed`: what the screen delivers.
  public func readableOnly(alsoRemoving keys: [String] = []) -> AgentRemoteMeshDelta {
    AgentRemoteMeshDelta(
      epoch: epoch, since: since, revision: revision, upserts: upserts, refused: [], removed: removed + keys,
      unknownFields: unknownFields)
  }
}

/// One desktop's entry in the mesh open: its state, when that was established (ISO-8601 as the home wrote it), and —
/// once it has answered — its board. An unknown STATE word stays `.unrecognized` (the kit's DS-L9 posture), though
/// the contracts' `RowsDeviceState` is closed: the phone is more tolerant than the window here, which does no harm,
/// and it is the one place the remote cut keeps a word zod would refuse (VF-PM, Q-C2).
public struct AgentRemoteMeshDevice: Sendable, Equatable {
  public let device: String
  public let state: AgentMeshDeviceState
  public let asOf: String
  public let snapshot: AgentRemoteMeshSnapshot?
  /// PG-9 — only to a phone that named a cursor (`since`): its copy at that cursor is current.
  public let resumed: SubscriptionCursor?
  /// PG-9 — only to a phone that named a cursor: what changed since it, on the same chain.
  public let delta: AgentRemoteMeshDelta?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentRemoteMeshDevice", value: json)
    device = try object.text("device", 1...Int.max)
    state = AgentMeshDeviceState(wire: try object.text("state", 1...Int.max))
    asOf = try object.text("asOf", 1...Int.max)
    snapshot = try object.strictObject("snapshot", AgentRemoteMeshSnapshot.init(json:))
    resumed = nil
    delta = nil
    unknownFields = object.unknownFields
  }

  init(
    device: String, state: AgentMeshDeviceState, asOf: String, snapshot: AgentRemoteMeshSnapshot?,
    resumed: SubscriptionCursor? = nil, delta: AgentRemoteMeshDelta? = nil, unknownFields: [String]
  ) {
    self.device = device
    self.state = state
    self.asOf = asOf
    self.snapshot = snapshot
    self.resumed = resumed
    self.delta = delta
    self.unknownFields = unknownFields
  }
}

/// The OPEN answer of `agent.subscribe {projection: "remote", scope: "mesh"}`: the home's board first, then every
/// other self desktop's remote board as its owner cut it, each on its own chain. A malformed entry throws the whole
/// open, as the window's parse does (it goes unavailable) — unlike the field cut's `AgentMeshOpen` (retired at PG-3e),
/// which dropped the device (Q-C2).
public struct AgentRemoteMeshOpen: Sendable, Equatable {
  public let devices: [AgentRemoteMeshDevice]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentRemoteMeshOpen", value: json)
    devices = try object.requiredArray(strict: "devices").map(AgentRemoteMeshDevice.init(json:))
    unknownFields = object.unknownFields
  }

  init(devices: [AgentRemoteMeshDevice], unknownFields: [String]) {
    self.devices = devices
    self.unknownFields = unknownFields
  }
}

/// A later frame of the remote mesh board, one of three arms, tried in the contracts' union order: one desktop's
/// delta, one desktop's snapshot (its reset), or its state changing — whose `asOf` is REQUIRED here (`rows.ts`), where
/// the field cut's `AgentMeshFrame` (retired at PG-3e) defaulted a missing one to "".
public enum AgentRemoteMeshFrame: Sendable, Equatable {
  case delta(device: String, AgentRemoteMeshDelta)
  case snapshot(device: String, AgentRemoteMeshSnapshot)
  case state(device: String, AgentMeshDeviceState, asOf: String)

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentRemoteMeshFrame", value: json)
    let device = try object.text("device", 1...Int.max)
    var faults: [String] = []
    if let raw = object.fields["delta"] {
      do {
        self = .delta(device: device, try AgentRemoteMeshDelta(json: raw))
        return
      } catch { faults.append(String(describing: error)) }
    }
    if let raw = object.fields["snapshot"] {
      do {
        self = .snapshot(device: device, try AgentRemoteMeshSnapshot(json: raw))
        return
      } catch { faults.append(String(describing: error)) }
    }
    if object.fields["state"] != nil {
      do {
        let state = AgentMeshDeviceState(wire: try object.text("state", 1...Int.max))
        self = .state(device: device, state, asOf: try object.text("asOf", 1...Int.max))
        return
      } catch { faults.append(String(describing: error)) }
    }
    throw WireDecodeError(
      shape: "AgentRemoteMeshFrame",
      reason: faults.isEmpty ? "names no delta, no snapshot and no state" : faults.joined(separator: "; "))
  }

  /// The desktop this frame is about.
  public var device: String {
    switch self {
    case .delta(let device, _), .snapshot(let device, _), .state(let device, _, _): device
    }
  }
}
