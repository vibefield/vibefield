import Foundation

// The contracts' shapes, narrowed to what the PHONE reads (H-D3). Each one is
// a hand-written tolerant reader over the same golden fixture the TypeScript
// tests parse (EL9 on the third side), and each carries the keys it did not
// know about rather than failing on them.
//
// Narrowing is deliberate and is the posture as much as the byte budget: a
// field this target never names cannot reach a screen, a log, or a crash
// report. What IS read is listed here and nowhere else.

/// `HelloAck` (`envelope.ts`) — the door's answer to `system.hello`.
public struct HelloAck: Sendable, Equatable, Decodable {
  public let contractsVersion: String
  public let serverKind: String
  /// What this connection may actually do. On the tailnet door a self peer is
  /// granted `TAILNET_SCOPES` by WhoIs and presents no token, so this is the
  /// ONLY place the phone learns its own reach — never a local assumption.
  public let grantedScopes: [String]
  /// GT-2d — who answered. Opaque provenance; absence is itself the tell.
  public let nativeBuild: String?
  /// UA-2 — the user this daemon serves. `null` (unconfigured) and absent (a
  /// pre-UA-2 daemon) both read as nil here: no surface in this slice tells
  /// them apart, and inventing a third case nobody renders would be fiction.
  public let userId: String?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "HelloAck", value: json)
    contractsVersion = try object.requiredString("contractsVersion")
    serverKind = try object.requiredString("serverKind")
    grantedScopes = try object.requiredArray("grantedScopes").compactMap(\.stringValue)
    nativeBuild = object.string("nativeBuild")
    userId = object.string("userId")
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// `ProductEndpoint` (`devices.ts`) — how to reach a device's product surface.
///
/// `url` is the C3 secret-path capability URL and is present only while the
/// serve is active. It is the phone's dial target and the reason this store
/// slice is worth reading at all; it is never logged and never displayed.
public struct ProductEndpoint: Sendable, Equatable, Decodable {
  public let serve: String
  public let url: String?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "ProductEndpoint", value: json)
    serve = try object.requiredString("serve")
    url = object.string("url")
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// `DeviceInfo` (`devices.ts`), narrowed. The roster row the phone reads to
/// find a desktop and its door — and the same shape `DeviceSlice` carries in
/// the `field.devices.v1` store, minus the liveness the daemon fuses onto it.
///
/// `online` and `self` are the daemon's own verdicts and are NOT defaulted: a
/// row that omits them is a row that did not say, and `nil` says that. Reading
/// absence as `false` would put "offline" under a device nobody asked about —
/// and the STORE's slices carry neither field at all, because liveness is not
/// a thing a device can publish about itself.
public struct DeviceInfo: Sendable, Equatable, Decodable, Identifiable {
  public let deviceId: String
  public let name: String
  public let platform: String
  public let online: Bool?
  public let isSelf: Bool?
  public let lastSeenAt: Int64?
  public let productEndpoint: ProductEndpoint?
  public let unknownFields: [String]

  public var id: String { deviceId }

  /// The dial target, when this device is serving one.
  public var productURL: URL? {
    guard let text = productEndpoint?.url else { return nil }
    return URL(string: text)
  }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "DeviceInfo", value: json)
    deviceId = try object.requiredString("deviceId")
    name = try object.requiredString("name")
    platform = try object.requiredString("platform")
    online = object.bool("online")
    isSelf = object.bool("self")
    lastSeenAt = object.int("lastSeenAt")
    productEndpoint = try object.decodeObject("productEndpoint", ProductEndpoint.init(json:))
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// `DeviceListResult` — `device.list`'s answer.
public struct DeviceListResult: Sendable, Equatable, Decodable {
  public let devices: [DeviceInfo]
  /// Rows this build could not read, by reason. A roster is a list of peers and
  /// one unreadable peer is not a broken roster — but it is also not nothing,
  /// so it is counted here rather than swallowed.
  public let droppedRows: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "DeviceListResult", value: json)
    var dropped: [String] = []
    devices = try object.rows("devices", DeviceInfo.init(json:), dropped: &dropped)
    droppedRows = dropped
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

// MARK: - The full agent row (`agent.list` / `agent.subscribe {projection:"full"}`)

/// A blocker, narrowed to the card's question: what is this agent waiting for,
/// and — when it is a permission — on which tool.
///
/// The blocker's `input`, `questions` and `detail` are DELIBERATELY not read.
/// §10.1 names the same absence for the field projection, and the reason is the
/// same on both: a question's prompt is conversation content, and this client
/// carries none of that.
public struct AgentBlockerRow: Sendable, Equatable, Identifiable {
  public let id: String
  public let kind: String
  public let since: String
  /// `permission.tool` — puppeteer's own shape (`{ requestId, tool? }`), whose
  /// `tool` is the only field of it read here.
  public let tool: String?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentBlockerRow", value: json)
    id = try object.requiredString("id")
    kind = try object.requiredString("kind")
    since = try object.requiredString("since")
    var permission = object.object("permission")
    tool = permission.string("tool")
    unknownFields = object.unknownFields
  }
}

/// `AgentSessionTerminal` (`agent-session.ts`) — G3's join: where this run's PTY
/// lives, and the id the IOS-3 attach path takes.
public struct AgentTerminalJoin: Sendable, Equatable, Decodable {
  public enum Hosted: String, Sendable, Equatable {
    case local, remote, none
  }

  /// The raw word, always. `hosted` is a closed enum upstream today and a
  /// fourth value must not fail the parse, so the word is kept and the enum is
  /// a reading of it.
  public let hosted: String
  public let runtimeSessionId: String?
  public let cellBootId: String?
  public let workloadClass: String?
  /// AR-4 — the floor session this run REPLACED at a resume-when-idle.
  public let replaced: String?
  public let unknownFields: [String]

  /// An unheard-of `hosted` reads as `none`: no terminal this phone knows how
  /// to reach, which is the honest face of a word we do not understand.
  public var hostedValue: Hosted { Hosted(rawValue: hosted) ?? .none }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentTerminalJoin", value: json)
    hosted = try object.requiredString("hosted")
    runtimeSessionId = object.string("runtimeSessionId")
    cellBootId = object.string("cellBootId")
    workloadClass = object.string("workloadClass")
    replaced = object.string("replaced")
    unknownFields = object.unknownFields
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}

/// `AgentSessionSummary` narrowed to the CARD's questions (H-D3): who this run
/// is, what it is doing, what it is waiting on, the last thing it said, and
/// where its terminal is.
///
/// This is the FULL projection — what `agent.list` answers today and what the
/// desktop subscribes to. The phone's own feed is the FIELD projection
/// (`AgentFieldRow`), which is smaller and carries no reply text at all; this
/// shape exists because `agent.list` is the one-shot door a card can ask, and
/// because the feed swap needs both readings to compare.
public struct AgentSessionRow: Sendable, Equatable, Identifiable {
  public let runtimeRunId: String
  public let kind: String
  public let label: String
  public let device: String
  public let tier: String
  public let status: String
  public let statusSince: String?
  public let createdAt: String
  public let stateChangedAt: String
  public let lastActivityAt: String?
  public let alive: Bool?
  public let blockers: [AgentBlockerRow]
  public let terminal: AgentTerminalJoin?
  /// `monitor.lastAssistantMessage.text` — the latest reply line, the one piece
  /// of conversation content the FULL projection carries and the field
  /// projection deliberately does not.
  public let lastAssistantMessage: String?
  public let cumulativeTokens: Double?
  public let burnRatePerMin: Double?
  public let contextUsedPercent: Double?
  public let modelId: String?
  public let modelDisplayName: String?
  public let cwd: String?
  public let branch: String?
  public let unknownFields: [String]

  public var id: String { runtimeRunId }

  public var statusValue: AgentRowStatus { AgentRowStatus(wire: status) }

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentSessionRow", value: json)
    runtimeRunId = try object.requiredString("runtimeRunId")
    kind = try object.requiredString("kind")
    label = try object.requiredString("label")
    device = try object.requiredString("device")
    tier = try object.requiredString("tier")
    status = try object.requiredString("status")
    createdAt = try object.requiredString("createdAt")
    stateChangedAt = try object.requiredString("stateChangedAt")
    lastActivityAt = object.string("lastActivityAt")
    terminal = try object.decodeObject("terminal", AgentTerminalJoin.init(json:))

    // Everything below lives on the monitor mirror, which is OPTIONAL: a row
    // whose adapter has produced no monitor state yet is a real row with a real
    // status, and reading it as unreadable would hide a live agent.
    var monitor = object.object("monitor")
    statusSince = monitor.string("statusSince")
    alive = monitor.bool("alive")
    var dropped: [String] = []
    blockers = monitor.optionalRows("blockers", AgentBlockerRow.init(json:), dropped: &dropped)
    var reply = monitor.object("lastAssistantMessage")
    lastAssistantMessage = reply.string("text")
    var usage = monitor.object("usage")
    cumulativeTokens = usage.double("cumulativeTokens")
    burnRatePerMin = usage.double("burnRatePerMin")
    var context = monitor.object("context")
    contextUsedPercent = context.double("usedPercent")
    var model = monitor.object("model")
    modelId = model.string("id")
    modelDisplayName = model.string("displayName")
    var environment = monitor.object("environment")
    cwd = environment.string("cwd")
    var git = environment.object("git")
    branch = git.string("branch")
    unknownFields = object.unknownFields
  }
}

/// `AgentListResult` — `agent.list`'s answer, and the FULL projection's
/// subscription snapshot.
public struct AgentListResult: Sendable, Equatable, Decodable {
  public let sessions: [AgentSessionRow]
  public let droppedRows: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentListResult", value: json)
    var dropped: [String] = []
    sessions = try object.rows("sessions", AgentSessionRow.init(json:), dropped: &dropped)
    droppedRows = dropped
  }

  public init(from decoder: any Decoder) throws {
    try self.init(json: try JSONValue(from: decoder))
  }
}
