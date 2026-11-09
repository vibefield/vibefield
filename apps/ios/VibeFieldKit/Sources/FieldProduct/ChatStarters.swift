import Foundation

// MARK: - The starters, filled from the home (track ES, ES-5a)
//
// The port of field-app's `starters.ts` (DESIGN.md §8 "Chat's list", the jobs, "Filled from this Mac"; ES-D4 A; ES-Q1).
// RED: the types and the mappings' shapes stand, and every answer is a stub.

public enum ChatStarters {
  /// One agent as the rule reads it.
  public struct Agent: Sendable, Equatable {
    public let id: String
    public let label: String
    public let available: Bool
    public let canSpawn: Bool

    public init(id: String, label: String, available: Bool, canSpawn: Bool) {
      self.id = id
      self.label = label
      self.available = available
      self.canSpawn = canSpawn
    }
  }

  /// One board run as the rule reads it.
  public struct Run: Sendable, Equatable {
    public let runtimeRunId: String
    public let kind: String
    public let alive: Bool
    /// The spark this is the own run of.
    public let spark: String?
    /// Its folder's name.
    public let project: String?
    public let createdMs: Int64
    /// When the run was worked in last, as near as this side can say.
    public let workedMs: Int64

    public init(
      runtimeRunId: String, kind: String, alive: Bool, spark: String?, project: String?, createdMs: Int64,
      workedMs: Int64
    ) {
      self.runtimeRunId = runtimeRunId
      self.kind = kind
      self.alive = alive
      self.spark = spark
      self.project = project
      self.createdMs = createdMs
      self.workedMs = workedMs
    }
  }

  /// A read in: still out, failed, or its rows.
  public enum Read<Row: Sendable & Equatable>: Sendable, Equatable {
    case out
    case failed
    case rows([Row])
  }

  /// The starters: held in their places, wordless, while a read is out; then read.
  public enum Reading: Sendable, Equatable {
    case reading([ChatStarter])
    case read([ChatStarter])

    public var isHeld: Bool {
      if case .reading = self { return true }
      return false
    }

    public var starters: [ChatStarter] {
      switch self {
      case .reading(let starters), .read(let starters): starters
      }
    }
  }

  public static func of(agents: Read<Agent>, runs: Read<Run>, catalog: AgentCatalogResult) -> Reading {
    .reading(ChatFlows.starters)
  }

  public static func run(_ row: AgentRemoteRow) -> Run? { nil }

  public static func runs(_ rows: [AgentRemoteRow], home: String?) -> [Run] { [] }

  public static func agents(_ providers: [AgentProviderSummary], catalog: AgentCatalogResult) -> [Agent] { [] }
}
