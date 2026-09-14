import Foundation

// The FIELD projection (`thinking-godview-mobile-first.md` §10.1,
// `packages/contracts/src/agent-field.ts`). This is the phone's own reading of
// a board: ≈300–500 bytes a row where the full projection's mirror is 2–5 KB,
// and the difference is not compression — it is CONTENT that is not here.
//
// DELIBERATELY ABSENT, and not an oversight to be fixed later: the last
// assistant message, a blocker's input / questions / detail, the session title,
// and the whole monitor mirror. A blocker carries `permission.tool` and nothing
// else, because "waiting to run Bash" is what a body has to show and the
// command it wants to run is conversation.

/// The derived status word (`AgentStatus` — idle · working · blocked ·
/// unknown), derived ONCE in fieldd and never re-derived by a view.
public enum AgentRowStatus: String, Sendable, Equatable, CaseIterable {
  case idle
  case working
  case blocked
  case unknown

  /// A word this build has never heard folds to `unknown` — the enum's own
  /// fourth case already means "the mirror could not be read", and a fifth
  /// status upstream lands in the same honest place rather than failing a parse.
  public init(wire: String) {
    self = AgentRowStatus(rawValue: wire) ?? .unknown
  }
}

/// A blocker on the field row: the fact that something is waiting, since when,
/// and — for a permission — the tool it wants.
public struct AgentFieldBlocker: Sendable, Equatable, Identifiable, Decodable {
  public let id: String
  public let kind: String
  public let since: String
  /// From `monitor.blockers[].permission.tool`, flattened by fieldd. Never the
  /// input, the questions, or the detail.
  public let tool: String?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentFieldBlocker", value: json)
    id = try object.requiredString("id")
    kind = try object.requiredString("kind")
    since = try object.requiredString("since")
    tool = object.string("tool")
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// One agent, as the field draws it.
public struct AgentFieldRow: Sendable, Equatable, Identifiable, Decodable {
  public let runtimeRunId: String
  /// fieldd's PER-ROW counter, bumped only when a PROJECTED field changed —
  /// not the mirror's revision. An idle board therefore sends nothing, which is
  /// the whole reason the phone can hold a subscription open on a radio.
  public let revision: Int64
  public let kind: String
  public let label: String
  public let tier: String
  public let device: String
  public let profileId: String?
  public let status: String
  public let statusSince: String
  public let stateChangedAt: String
  public let createdAt: String
  public let lastActivityAt: String?
  public let alive: Bool
  /// AR-4 — a live terminal fieldd could not re-attach to, which will resume at
  /// its next idle. The row is real and unobserved, and says so.
  public let pending: String?
  public let blockers: [AgentFieldBlocker]
  public let cumulativeTokens: Double?
  public let burnRatePerMin: Double?
  public let contextUsedPercent: Double?
  public let modelId: String?
  public let modelDisplayName: String?
  public let effort: String?
  public let effortIntent: String?
  /// The FOLDER, never the path. MF-1i/EL7-B1: `field.agents.v1` is the app's
  /// peers rather than one person's devices, so an absolute path was a leak
  /// the row had no use for — and a card draws the folder anyway.
  public let projectName: String?
  public let branch: String?
  public let terminal: AgentTerminalJoin?
  public let unknownFields: [String]
  /// Blockers that did not read. A row with one unreadable blocker is still a
  /// row — but the count is not nothing, so it rides rather than vanishing.
  public let droppedBlockers: [String]

  public var id: String { runtimeRunId }

  public var statusValue: AgentRowStatus { AgentRowStatus(wire: status) }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentFieldRow", value: json)
    runtimeRunId = try object.requiredString("runtimeRunId")
    revision = try object.requiredInt("revision")
    kind = try object.requiredString("kind")
    label = try object.requiredString("label")
    tier = try object.requiredString("tier")
    device = try object.requiredString("device")
    profileId = object.string("profileId")
    status = try object.requiredString("status")
    statusSince = try object.requiredString("statusSince")
    stateChangedAt = try object.requiredString("stateChangedAt")
    createdAt = try object.requiredString("createdAt")
    lastActivityAt = object.string("lastActivityAt")
    alive = try object.requiredBool("alive")
    pending = object.string("pending")
    var dropped: [String] = []
    blockers = try object.rows("blockers", AgentFieldBlocker.init(json:), dropped: &dropped)
    droppedBlockers = dropped

    var usage = object.object("usage")
    cumulativeTokens = usage.double("cumulativeTokens")
    burnRatePerMin = usage.double("burnRatePerMin")
    var context = object.object("context")
    contextUsedPercent = context.double("usedPercent")
    var model = object.object("model")
    modelId = model.string("id")
    modelDisplayName = model.string("displayName")
    var effortObject = object.object("effort")
    effort = effortObject.string("value")
    effortIntent = effortObject.string("intent")
    var project = object.object("project")
    projectName = project.string("name")
    branch = project.string("branch")
    terminal = try object.decodeObject("terminal", AgentTerminalJoin.init(json:))
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// The subscription's first frame: the whole board at one revision.
public struct AgentFieldSnapshot: Sendable, Equatable, Decodable {
  public let revision: Int64
  public let rows: [AgentFieldRow]
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentFieldSnapshot", value: json)
    revision = try object.requiredInt("revision")
    var dropped: [String] = []
    rows = try object.rows("rows", AgentFieldRow.init(json:), dropped: &dropped)
    droppedRows = dropped
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// Every later frame. Applies ON TOP of `since`; a client whose revision is not
/// `since` has lost a frame and RE-SUBSCRIBES for a fresh snapshot — the
/// tolerant reader's own repair, with no ack protocol anywhere.
public struct AgentFieldDelta: Sendable, Equatable, Decodable {
  public let since: Int64
  public let revision: Int64
  public let upserts: [AgentFieldRow]
  public let removed: [String]
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentFieldDelta", value: json)
    since = try object.requiredInt("since")
    revision = try object.requiredInt("revision")
    var dropped: [String] = []
    upserts = try object.rows("upserts", AgentFieldRow.init(json:), dropped: &dropped)
    droppedRows = dropped
    removed = try object.requiredArray("removed").compactMap(\.stringValue)
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// The synced-store slice, one per device (`field.agents.v1`).
///
/// `expiresAt` is what makes a dead publisher's board fade instead of lying:
/// the desktop refreshes it on a heartbeat while rows exist, and a reader drops
/// rows past it. The reader's clock is its own, so the comparison is a fact
/// about THIS device's time — which is why the phone renders an expired slice
/// as stale rather than deleting it silently.
public struct AgentFieldSlice: Sendable, Equatable, Decodable {
  public let version: Int64
  public let deviceId: String
  public let publishedAt: Int64
  public let expiresAt: Int64
  public let revision: Int64
  public let rows: [AgentFieldRow]
  /// Rows the 64 KiB slice cap left out. Decoded now and DRAWN by nobody: a
  /// number the phone can carry is better than a board that silently claims to
  /// be whole, and "+N more" is IOS-4e's to draw. Absent on a producer that
  /// does not count them, which is every producer today.
  public let omitted: Int64?
  public let droppedRows: [String]
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentFieldSlice", value: json)
    version = try object.requiredInt("v")
    deviceId = try object.requiredString("deviceId")
    publishedAt = try object.requiredInt("publishedAt")
    expiresAt = try object.requiredInt("expiresAt")
    revision = try object.requiredInt("revision")
    omitted = object.int("omitted")
    var dropped: [String] = []
    rows = try object.rows("rows", AgentFieldRow.init(json:), dropped: &dropped)
    droppedRows = dropped
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }

  /// Whether this slice's publisher has stopped refreshing it, by the reader's
  /// own clock.
  public func isExpired(at now: Date = Date()) -> Bool {
    Int64(now.timeIntervalSince1970 * 1000) > expiresAt
  }
}

/// `agent.subscribe`'s params. The desktop is unchanged by omission: no
/// `projection` means `full`, and `minIntervalMs` is the field's alone.
public struct AgentSubscribeParams: Sendable, Equatable {
  public enum Projection: String, Sendable, Equatable {
    case full
    case field
  }

  public let projection: Projection?
  public let minIntervalMs: Int?

  public init(projection: Projection? = nil, minIntervalMs: Int? = nil) {
    self.projection = projection
    self.minIntervalMs = minIntervalMs
  }

  /// The phone's own subscription: the field projection at the cadence §5 sets
  /// (`AGENT_FIELD.MIN_INTERVAL_MS`), which the swarm's 30 Hz physics
  /// interpolates between.
  public static let phoneField = AgentSubscribeParams(projection: .field, minIntervalMs: 250)

  public var json: JSONValue {
    var fields: [String: JSONValue] = [:]
    if let projection { fields["projection"] = .string(projection.rawValue) }
    if let minIntervalMs { fields["minIntervalMs"] = .int(Int64(minIntervalMs)) }
    return .object(fields)
  }
}

// MARK: - The two doors §10.1 mints beside the field (G7, G4)

/// `agent.interrupt`'s answer — the STOP verb's, pulled forward from AR-6 §3.
///
/// A refusal is a normal outcome and carries its reason: an exited or pending
/// row cannot be interrupted, and the door says which. That is why this is a
/// value and not a thrown error — "the agent would not stop, because it is
/// waiting on a human" is something a card shows, not something it catches.
public struct AgentInterruptResult: Sendable, Equatable, Decodable {
  public let accepted: Bool
  /// Present only on a refusal (the discriminated union's other arm).
  public let reason: String?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentInterruptResult", value: json)
    accepted = try object.requiredBool("accepted")
    reason = object.string("reason")
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

// RETIRED 2026-09-14 (TM-3, TM-D3): `TerminalMirrorWriteGrant`, G4's answer —
// the mirror-write capability a desktop handed this phone, with the redaction
// that kept it out of `description`, `debugDescription` and a custom `Mirror`,
// and its golden copy under `Tests/**`. The secret is deleted on every plane;
// the right to type rides the attach grant in the ticket (TM-2), which is
// per client, per session and expiring, so nothing durable reaches this app.
