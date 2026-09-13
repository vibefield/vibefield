import Foundation

/// Agent vendors, as the runtime names them. The raw value is the provider id
/// the mark atlas is keyed by (`AgentIcon.tsx`'s table).
public enum AgentProvider: String, Sendable, CaseIterable, Codable {
  case claude
  case codex
  case grok
  case acp

  /// Desktop `providerLabel`.
  public var displayName: String {
    switch self {
    case .claude: "Claude"
    case .codex: "Codex"
    case .grok: "Grok"
    case .acp: "ACP"
    }
  }
}

/// Session lifecycle vocabulary (the runtime's `state.lifecycle` subset the
/// field consumes: anything not `ready` renders as working; `exited` and
/// `failed` leave the field).
public enum AgentLifecycle: String, Sendable, Codable {
  case starting
  case ready
  case exited
  case failed
}

/// A pending permission request — the blocker of kind `permission`, kept as
/// its own list because the card's reply chips are derived from it (K-D4).
public struct AgentPermission: Sendable, Equatable, Codable {
  public var tool: String?
  public init(tool: String? = nil) { self.tool = tool }
}

/// Why an agent is blocked, in the monitor's three words. A permission is
/// carried by `AgentRuntimeState.permissions`; the other two kinds ride
/// `blockers`, in the order the monitor listed them.
public enum AgentBlockerKind: String, Sendable, Codable {
  case permission
  case question
  case failure
}

public struct AgentBlocker: Sendable, Equatable, Codable {
  public var kind: AgentBlockerKind
  public var detail: String?
  public init(kind: AgentBlockerKind, detail: String? = nil) {
    self.kind = kind
    self.detail = detail
  }
}

/// Whether an effort value is provider evidence or only launch intent — the
/// body sets launch intent in italics so a reading never mistakes it for
/// evidence. An older producer that omits the intent is read as observed.
public enum AgentEffortIntent: String, Sendable, Codable {
  case configured
  case observed
}

public struct AgentEffort: Sendable, Equatable, Codable {
  public var value: String
  public var intent: AgentEffortIntent
  public init(value: String, intent: AgentEffortIntent = .observed) {
    self.value = value
    self.intent = intent
  }
}

/// One cumulative usage sample (the monitor's `MonitorUsageSample`).
public struct AgentUsageSample: Sendable, Equatable, Codable {
  public var at: Date
  public var cumulativeTokens: Double
  /// Cumulative prompt-side tokens (input, cache reads, cache creation) when the source splits usage.
  public var inputTokens: Double?
  /// Cumulative completion-side tokens (output, reasoning) when the source splits usage.
  public var outputTokens: Double?

  public init(at: Date, cumulativeTokens: Double, inputTokens: Double? = nil, outputTokens: Double? = nil) {
    self.at = at
    self.cumulativeTokens = cumulativeTokens
    self.inputTokens = inputTokens
    self.outputTokens = outputTokens
  }
}

/// Core's usage for a run, in the mirror's own field names (`MonitorUsageState`):
/// a corrected estimate that every source moves. The field never reads it
/// directly — `UsageLedger` folds it into the number the screen stands behind.
public struct AgentUsage: Sendable, Equatable, Codable {
  public var cumulativeTokens: Double?
  public var inputTokens: Double?
  public var outputTokens: Double?
  public var cacheReadTokens: Double?
  public var cacheCreationTokens: Double?
  public var reasoningTokens: Double?
  public var samples: [AgentUsageSample]

  public init(
    cumulativeTokens: Double? = nil,
    inputTokens: Double? = nil,
    outputTokens: Double? = nil,
    cacheReadTokens: Double? = nil,
    cacheCreationTokens: Double? = nil,
    reasoningTokens: Double? = nil,
    samples: [AgentUsageSample] = []
  ) {
    self.cumulativeTokens = cumulativeTokens
    self.inputTokens = inputTokens
    self.outputTokens = outputTokens
    self.cacheReadTokens = cacheReadTokens
    self.cacheCreationTokens = cacheCreationTokens
    self.reasoningTokens = reasoningTokens
    self.samples = samples
  }
}

/// One running tool invocation, reduced to what the bubble caption needs.
public struct AgentToolRun: Sendable, Equatable, Codable {
  public var title: String?
  public init(title: String? = nil) { self.title = title }
}

/// The live state slice the field renders — a SUBSET of puppeteer's monitor
/// projection (`AgentMonitorState`), field names kept, so the day fieldd's
/// `agent.subscribe` reaches the phone (IOS-4) the binding is a mapping and
/// not a redesign. The first nine fields are the July feed; the rest are what
/// RFC 005's bodies read (the burn, the effort, the reply, the blocker's kind,
/// the clocks).
public struct AgentRuntimeState: Sendable, Equatable, Codable {
  public var lifecycle: AgentLifecycle
  public var activeTurn: Bool
  public var activeReasoning: Bool
  public var permissions: [AgentPermission]
  public var toolRuns: [AgentToolRun]
  public var taskCount: Int
  /// Context window usage, 0...100, when the vendor reports one.
  public var contextUsedPercent: Double?
  public var modelName: String?
  public var branch: String?
  /// Blockers other than a permission (a question, a failure), monitor order.
  public var blockers: [AgentBlocker]
  public var effort: AgentEffort?
  /// The root agent's latest reply, bounded by the producer; the body shows
  /// its first line.
  public var lastAssistantMessage: String?
  public var usage: AgentUsage?
  /// When the current status began (the unread rule reads it, never the
  /// transition, so a turn that began and ended between two projections still
  /// counts).
  public var statusSince: Date?
  /// The monitor's `freshness.lastEvidenceAt`: stale evidence dims the body.
  public var lastEvidenceAt: Date?

  public init(
    lifecycle: AgentLifecycle = .ready,
    activeTurn: Bool = false,
    activeReasoning: Bool = false,
    permissions: [AgentPermission] = [],
    toolRuns: [AgentToolRun] = [],
    taskCount: Int = 0,
    contextUsedPercent: Double? = nil,
    modelName: String? = nil,
    branch: String? = nil,
    blockers: [AgentBlocker] = [],
    effort: AgentEffort? = nil,
    lastAssistantMessage: String? = nil,
    usage: AgentUsage? = nil,
    statusSince: Date? = nil,
    lastEvidenceAt: Date? = nil
  ) {
    self.lifecycle = lifecycle
    self.activeTurn = activeTurn
    self.activeReasoning = activeReasoning
    self.permissions = permissions
    self.toolRuns = toolRuns
    self.taskCount = taskCount
    self.contextUsedPercent = contextUsedPercent
    self.modelName = modelName
    self.branch = branch
    self.blockers = blockers
    self.effort = effort
    self.lastAssistantMessage = lastAssistantMessage
    self.usage = usage
    self.statusSince = statusSince
    self.lastEvidenceAt = lastEvidenceAt
  }
}

/// One agent session as the field sees it.
public struct AgentSnapshot: Identifiable, Sendable, Equatable {
  /// The session id — the identity spine (EL7); stable across state churn.
  public let id: String
  /// The runtime alias; the card header still derives a hue from it (D-i16).
  public let runtimeSessionID: String
  public var provider: AgentProvider
  /// Folder-name project label, the bubble's headline — and, until IOS-4
  /// hands the workspace root over, the key the project's colour is dealt by.
  public var project: String
  /// nil = spawned but not yet reporting — renders as working, "starting".
  public var state: AgentRuntimeState?
  public let createdAt: Date

  public init(
    id: String,
    runtimeSessionID: String,
    provider: AgentProvider,
    project: String,
    state: AgentRuntimeState? = nil,
    createdAt: Date = .now
  ) {
    self.id = id
    self.runtimeSessionID = runtimeSessionID
    self.provider = provider
    self.project = project
    self.state = state
    self.createdAt = createdAt
  }
}
