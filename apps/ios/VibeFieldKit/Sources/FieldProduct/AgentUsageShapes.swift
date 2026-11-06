import Foundation

// UM-4 (track UM; UM-D8 A, the page *The Bands Meter*, 2026-11-06) — THE HOME'S USAGE BATCH, read on the phone
// (`packages/contracts/src/agent-usage.ts`: `AgentAccountUsageMetric`, `AgentAccountUsageCredits`,
// `AgentAccountUsageSource`, `AgentAccountUsageEntry`, `AgentAccountUsageBatch`, `AgentsUsageParams`). The phone reads
// the home's cached batch (`agents.usage`, `agents.usage.subscribe`) and runs no poll of its own; its meters are the
// desktop's (FieldHome/Meters, held to the usage bands golden).

/// The states a reading can be in; a word this build cannot name is `unknown`, never a refusal.
public enum AgentAccountUsageState: String, Sendable, Equatable {
  case available
  case rateLimited = "rate-limited"
  case unauthenticated
  case unsupported
  case unavailable
  case unknown
}

/// The part of a plan a meter measures when it is not the whole plan (a model's own week).
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
  public let usedPercent: Double
  public let durationMinutes: Int?
  public let startsAt: String?
  public let resetsAt: String?
  public let group: AgentAccountUsageGroup?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    id = ""
    label = ""
    description = nil
    kind = ""
    usedPercent = 0
    durationMinutes = nil
    startsAt = nil
    resetsAt = nil
    group = nil
    unknownFields = []
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
    balance = nil
    hasCredits = nil
    unlimited = nil
    resetCreditsAvailable = nil
    unknownFields = []
  }
}

/// How the adapter obtained the snapshot (two open words).
public struct AgentAccountUsageSource: Sendable, Equatable {
  public let kind: String
  public let stability: String
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    kind = ""
    stability = ""
    unknownFields = []
  }
}

/// One reading: an agent, the account it was read for, and its meters or the reason there are none.
public struct AgentAccountUsageEntry: Sendable, Equatable {
  public let provider: String
  public let label: String
  public let profileId: String?
  public let profileLabel: String?
  public let state: AgentAccountUsageState
  public let metrics: [AgentAccountUsageMetric]
  public let credits: AgentAccountUsageCredits?
  public let message: String?
  public let retryable: Bool?
  public let retryAt: String?
  public let stale: Bool?
  public let fetchedAt: String
  public let scope: String?
  public let source: AgentAccountUsageSource?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    provider = ""
    label = ""
    profileId = nil
    profileLabel = nil
    state = .available
    metrics = []
    credits = nil
    message = nil
    retryable = nil
    retryAt = nil
    stale = nil
    fetchedAt = ""
    scope = nil
    source = nil
    unknownFields = []
  }
}

/// `agents.usage`'s answer and every `agents.usage.subscribe` frame: the whole batch.
public struct AgentAccountUsageBatch: Sendable, Equatable {
  public let entries: [AgentAccountUsageEntry]
  public let generatedAt: String
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    entries = []
    generatedAt = ""
    unknownFields = []
  }
}

/// `agents.usage` as the phone asks it.
public struct AgentsUsageParams: Sendable, Equatable {
  /// The phone's one ask.
  public static let cached = AgentsUsageParams()

  public var json: JSONValue { .null }
}
