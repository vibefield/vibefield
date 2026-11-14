import Foundation

// SP-4b (red) — MA-L7 as a content rule list. A stub: no rules.

public enum WebRuleList {
  /// One rule: its url-filter and what it does.
  public struct Rule: Sendable, Equatable {
    public let filter: String
    public let block: Bool
  }

  public static func rules(origin: WebOrigin, reach: [String]) -> [Rule] { [] }

  public static func json(origin: WebOrigin, reach: [String]) -> String { "[]" }

  public static func identifier(origin: WebOrigin, reach: [String]) -> String { "" }

  public static func admitted(_ reach: [String]) -> [String] { [] }
}
