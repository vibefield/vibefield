import Foundation

/// Agent vendors, as chopsticks names them.
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

/// Session lifecycle vocabulary (chopsticks `state.lifecycle` subset the
/// godview consumes: anything not `ready` renders as working; `exited` and
/// `failed` leave the field).
public enum AgentLifecycle: String, Sendable, Codable {
  case starting
  case ready
  case exited
  case failed
}

/// A pending permission request (the thing that turns a bubble into the
/// biggest, highest-contrast object on screen).
public struct AgentPermission: Sendable, Equatable, Codable {
  public var tool: String?
  public init(tool: String? = nil) { self.tool = tool }
}

/// One running tool invocation, reduced to what the bubble caption needs.
public struct AgentToolRun: Sendable, Equatable, Codable {
  public var title: String?
  public init(title: String? = nil) { self.title = title }
}

/// The chopsticks-shaped live state slice the field renders. Field names
/// mirror the desktop feed so the later product-API binding is a mapping,
/// not a redesign.
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

  public init(
    lifecycle: AgentLifecycle = .ready,
    activeTurn: Bool = false,
    activeReasoning: Bool = false,
    permissions: [AgentPermission] = [],
    toolRuns: [AgentToolRun] = [],
    taskCount: Int = 0,
    contextUsedPercent: Double? = nil,
    modelName: String? = nil,
    branch: String? = nil
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
  }
}

/// One agent session as the field sees it.
public struct AgentSnapshot: Identifiable, Sendable, Equatable {
  /// The session id — the identity spine (EL7); stable across state churn.
  public let id: String
  /// The runtime alias; the desktop derives the identity color from it.
  public let runtimeSessionID: String
  public var provider: AgentProvider
  /// Folder-name project label, the bubble's headline.
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
