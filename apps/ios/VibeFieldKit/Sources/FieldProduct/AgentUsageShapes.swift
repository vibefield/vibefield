import Foundation

// UM-4 (track UM; UM-D8 A, the page *The Bands Meter*, 2026-11-06) — THE HOME'S USAGE BATCH, read on the phone
// (`packages/contracts/src/agent-usage.ts`: `AgentAccountUsageMetric`, `AgentAccountUsageCredits`,
// `AgentAccountUsageSource`, `AgentAccountUsageEntry`, `AgentAccountUsageBatch`, `AgentsUsageParams`). The phone reads
// the home's cached batch (`agents.usage`, `agents.usage.subscribe`) and runs no poll of its own; its meters are the
// desktop's (FieldHome/Meters, held to the usage bands golden).
//
// Strict as zod, the remote cut's posture (`AgentRemoteShapes.swift`): a reading is refused exactly where zod would
// refuse it — a required field missing or of another type, `null` at an `.optional()` key, a length, sign or grammar
// broken — and never for an OPEN word (a meter's `kind`, an entry's `scope`, a source's two words), which is kept as
// it came. `state` is zod's `.catch("unknown")`: a word this build cannot name (or none) is `unknown`, never a
// refusal. Objects are `.passthrough()`, so a newer desktop's fields are kept and named (`unknownFields`). A batch is
// one value: an entry zod refuses refuses the batch, as `z.array` does, and the feed then says the usage could not be
// read — never a batch that quietly lost a profile's plan.

/// The states a reading can be in; a word this build cannot name is `unknown`, never a refusal.
public enum AgentAccountUsageState: String, Sendable, Equatable {
  case available
  case rateLimited = "rate-limited"
  case unauthenticated
  case unsupported
  case unavailable
  case unknown
}

/// `AgentProviderId`: `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, 1 to 128.
/// `AgentProfileId`: the same with `:` inside.
enum UsageWire {
  static func isProviderId(_ text: String) -> Bool { isId(text, extra: [0x2E, 0x5F, 0x2D]) }
  static func isProfileId(_ text: String) -> Bool { isId(text, extra: [0x3A, 0x2E, 0x5F, 0x2D]) }

  private static func isId(_ text: String, extra: Set<UInt8>) -> Bool {
    let bytes = Array(text.utf8)
    let alnum = { (byte: UInt8) in
      (0x30...0x39).contains(byte) || (0x41...0x5A).contains(byte) || (0x61...0x7A).contains(byte)
    }
    guard let first = bytes.first, (1...128).contains(text.utf16.count), alnum(first) else { return false }
    return bytes.dropFirst().allSatisfy { alnum($0) || extra.contains($0) }
  }

  /// A known key's id, read strictly: absent → nil, anything but an id `valid` takes → refused.
  static func id(
    _ object: inout WireObject, _ key: String, _ valid: (String) -> Bool, _ what: String
  ) throws -> String? {
    let shape = object.shape
    return try object.strict(key) { raw in
      guard let text = raw.stringValue else { throw WireDecodeError(shape: shape, reason: "`\(key)` is not a string") }
      guard valid(text) else { throw WireDecodeError(shape: shape, reason: "`\(key)` is not \(what)") }
      return text
    }
  }
}

/// The part of a plan a meter measures when it is not the whole plan (a model's own week). zod's plain object: an
/// unknown key here is dropped, never named.
public struct AgentAccountUsageGroup: Sendable, Equatable {
  public let id: String
  public let label: String
  public let standby: Bool?
}

/// One adapter-normalized meter.
public struct AgentAccountUsageMetric: Sendable, Equatable {
  public let id: String
  public let label: String
  public let description: String?
  /// `window` or `budget`, open
  public let kind: String
  /// percent consumed; above 100 is an exceeded budget or window
  public let usedPercent: Double
  public let durationMinutes: Int?
  public let startsAt: String?
  public let resetsAt: String?
  public let group: AgentAccountUsageGroup?
  /// item 274 — when this meter was read, when that is earlier than its entry's `fetchedAt` (a meter a later reading
  /// did not carry); nil, it is as old as its entry. A reader takes `metric.fetchedAt ?? entry.fetchedAt`
  public let fetchedAt: String?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentAccountUsageMetric", value: json)
    id = try object.text("id", 1...Int.max)
    label = try object.text("label", 1...Int.max)
    description = try object.typedString("description")
    kind = try object.text("kind")
    usedPercent = try object.number("usedPercent")
    guard usedPercent >= 0 else {
      throw WireDecodeError(shape: object.shape, reason: "`usedPercent` is \(usedPercent), below 0")
    }
    durationMinutes = try object.typedInt("durationMinutes", atLeast: 1).map { Int($0) }
    startsAt = try object.typedString("startsAt")
    resetsAt = try object.typedString("resetsAt")
    group = try object.strictObject("group") { raw in
      var group = try WireObject(shape: "AgentAccountUsageMetric.group", value: raw)
      return AgentAccountUsageGroup(
        id: try group.text("id", 1...Int.max), label: try group.text("label", 1...Int.max),
        standby: try group.typedBool("standby"))
    }
    // as strict as zod's `z.string().optional()`: absent is nil, null and a non-string are refused
    fetchedAt = try object.typedString("fetchedAt")
    unknownFields = object.unknownFields
  }
}

/// Account-wide credits no percentage meter represents. `balance` is the provider's own formatting.
public struct AgentAccountUsageCredits: Sendable, Equatable {
  public let balance: String?
  public let hasCredits: Bool?
  public let unlimited: Bool?
  public let resetCreditsAvailable: Int?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentAccountUsageCredits", value: json)
    balance = try object.typedString("balance")
    hasCredits = try object.typedBool("hasCredits")
    unlimited = try object.typedBool("unlimited")
    resetCreditsAvailable = try object.typedInt("resetCreditsAvailable", atLeast: 0).map { Int($0) }
    unknownFields = object.unknownFields
  }
}

/// How the adapter obtained the snapshot (two open words).
public struct AgentAccountUsageSource: Sendable, Equatable {
  public let kind: String
  public let stability: String
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentAccountUsageSource", value: json)
    kind = try object.text("kind")
    stability = try object.text("stability")
    unknownFields = object.unknownFields
  }
}

/// One reading: an agent, the account it was read for, and its meters or the reason there are none. `fetchedAt` is
/// when the data was read: a kept reading (`stale`) keeps its older stamp.
/// *Corrected 2026-11-10 (item 274; puppeteer 0.4.0, #74): a push merges into the reading it lands on, so `fetchedAt`
/// is the newest meter's read; a meter the push did not carry keeps its own older read in its `fetchedAt`.*
public struct AgentAccountUsageEntry: Sendable, Equatable {
  public let provider: String
  public let label: String
  /// the persona the reading is for; nil is the agent's own folder's default account
  public let profileId: String?
  public let profileLabel: String?
  public let state: AgentAccountUsageState
  /// in the adapter's order; empty until a reading has succeeded once
  public let metrics: [AgentAccountUsageMetric]
  public let credits: AgentAccountUsageCredits?
  public let message: String?
  public let retryable: Bool?
  public let retryAt: String?
  /// the metrics are a reading kept after the last refresh failed (each metric's age is its own `fetchedAt`, else this
  /// entry's: corrected 2026-11-10, item 274)
  public let stale: Bool?
  public let fetchedAt: String
  public let scope: String?
  public let source: AgentAccountUsageSource?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentAccountUsageEntry", value: json)
    guard let provider = try UsageWire.id(&object, "provider", UsageWire.isProviderId, "a provider id") else {
      throw object.missing("provider")
    }
    self.provider = provider
    label = try object.text("label", 1...Int.max)
    profileId = try UsageWire.id(&object, "profileId", UsageWire.isProfileId, "a profile id")
    profileLabel = try object.typedString("profileLabel")
    // zod's `.catch("unknown")`: whatever stands at `state` that is not one of the words, or nothing, is `unknown`
    state = object.value("state")?.stringValue.flatMap(AgentAccountUsageState.init(rawValue:)) ?? .unknown
    metrics = try object.requiredArray(strict: "metrics").map(AgentAccountUsageMetric.init(json:))
    credits = try object.strictObject("credits", AgentAccountUsageCredits.init(json:))
    message = try object.typedString("message")
    retryable = try object.typedBool("retryable")
    retryAt = try object.typedString("retryAt")
    stale = try object.typedBool("stale")
    fetchedAt = try object.text("fetchedAt")
    scope = try object.typedString("scope")
    source = try object.strictObject("source", AgentAccountUsageSource.init(json:))
    unknownFields = object.unknownFields
  }
}

/// `agents.usage`'s answer and every `agents.usage.subscribe` frame: the whole batch, in the agents' order. Before the
/// first refresh `entries` is empty and `generatedAt` still stamps it — an honest empty.
public struct AgentAccountUsageBatch: Sendable, Equatable {
  public let entries: [AgentAccountUsageEntry]
  public let generatedAt: String
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "AgentAccountUsageBatch", value: json)
    entries = try object.requiredArray(strict: "entries").map(AgentAccountUsageEntry.init(json:))
    generatedAt = try object.text("generatedAt")
    unknownFields = object.unknownFields
  }
}

/// `agents.usage` as the phone asks it, every profile's: the home's cached batch (`cached`, no `refresh`), or — only
/// when a person asks, the Agent Profiles page's ↻ or its pull — a fresh reading (`fresh`, `refresh: true`). *Since
/// UM-6 (UM-D33, 2026-11-24):* the home reads a refresh from the person's own phone (a self tailnet principal) as its
/// own windows' refresh; UM-D8 had answered it from the cache, so the phone named no `refresh` then. Any other caller's
/// is still answered from the cache.
public struct AgentsUsageParams: Sendable, Equatable {
  /// read the usage again before answering
  public var refresh: Bool

  public init(refresh: Bool = false) { self.refresh = refresh }

  /// The phone's standing ask: the home's cached batch.
  public static let cached = AgentsUsageParams()
  /// A person's ask for a fresh reading.
  public static let fresh = AgentsUsageParams(refresh: true)

  public var json: JSONValue { refresh ? .object(["refresh": .bool(true)]) : .object([:]) }
}
