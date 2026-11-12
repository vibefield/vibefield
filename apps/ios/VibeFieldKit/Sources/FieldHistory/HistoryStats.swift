import CoreGraphics
import FieldProduct
import Foundation

// Item 353 (red) — the names HistoryStatsTests reads, with nothing counted yet: the values' shapes are the ones the
// ledger's figures will hold, and every rule answers nothing. The next commit writes the rules.

/// Estimated spend: the room's `Spend`, kept to what decides its drawing.
public struct HistorySpend: Equatable, Sendable, Codable {
  /// Estimated micro-USD at list prices; nil when nothing was priced.
  public var costMicroUsd: Double?
  /// Tokens the price list could not price.
  public var unpricedTokens: Double
  /// Replies whose output was never recorded.
  public var unrecordedOutput: Double

  public init(costMicroUsd: Double? = nil, unpricedTokens: Double = 0, unrecordedOutput: Double = 0) {
    self.costMicroUsd = costMicroUsd
    self.unpricedTokens = unpricedTokens
    self.unrecordedOutput = unrecordedOutput
  }

  public static let none = HistorySpend()

  public enum Coverage: Equatable, Sendable {
    case complete
    case partial
    case unavailable
    case none
  }

  public var coverage: Coverage { .none }

  public static func + (left: HistorySpend, right: HistorySpend) -> HistorySpend { left }
}

/// A project's lifetime, as its door's figures give it.
public struct HistoryLifetime: Equatable, Sendable, Codable {
  public let tokens: Double
  public let spend: HistorySpend
  public let messages: Double
  public let clipped: Bool
  public let partial: Bool

  public init(tokens: Double, spend: HistorySpend, messages: Double, clipped: Bool, partial: Bool) {
    self.tokens = tokens
    self.spend = spend
    self.messages = messages
    self.clipped = clipped
    self.partial = partial
  }
}

/// The ledger's figures: the four numbers over every listed project, and the treemap's tiles.
public struct HistoryPortfolio: Equatable, Sendable {
  public struct Tile: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let value: Double
    public let lowerBound: Bool
  }

  public let projects: Int
  public let read: Int
  public let sessions: Int
  public let messages: Double
  public let messagesLowerBound: Bool
  public let tokens: Double
  public let spend: HistorySpend
  public let tiles: [Tile]
  public let unpriced: Int
  public let partial: Int

  public var isWhole: Bool { read >= projects }
}

extension FieldHistoryModel {
  public static let treemapProjects = 10

  public static func lifetime(_ result: ProjectFiguresResult) -> HistoryLifetime {
    HistoryLifetime(tokens: 0, spend: .none, messages: 0, clipped: false, partial: false)
  }

  public static func portfolio(_ projects: [HistoryProject], sessions: Int) -> HistoryPortfolio {
    HistoryPortfolio(
      projects: projects.count, read: 0, sessions: 0, messages: 0, messagesLowerBound: false, tokens: 0, spend: .none,
      tiles: [], unpriced: 0, partial: 0)
  }

  public static func usdWord(_ microUsd: Double) -> (figure: String, unit: String) { ("", "") }

  public static func spendWord(_ spend: HistorySpend?) -> (figure: String, unit: String) { ("", "") }

  public static func costliest(_ projects: [HistoryProject]) -> HistoryProject? { nil }

  public static func portfolioNote(_ portfolio: HistoryPortfolio, failed: Int, awake: Bool) -> String? { nil }

  public static func unpricedNote(_ count: Int) -> String? { nil }

  public static func agentShares(counts: [String: Int]) -> (shares: [HistoryAgentShare], more: Int) { ([], 0) }
}

/// The treemap's layout.
public enum HistoryTreemap {
  public struct Tile: Equatable, Sendable {
    public let index: Int
    public let rect: CGRect
    public let share: Double
    public let labelled: Bool
  }

  public static func layout(_ values: [Double], in size: CGSize) -> [Tile] { [] }
}
