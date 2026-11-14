import Foundation

// SP-4b (red) — where a page in an app's web view may go. A stub: everything is allowed.

/// What the host does with a navigation.
public enum WebNavigation: Sendable, Equatable {
  case allow
  case outside
  case refuse(WebRefusal)
}

/// Why a navigation is refused. The words are DESIGN.md's (‹for James›).
public enum WebRefusal: String, Sendable, Equatable {
  case tailnetOffOrigin
  case undeclaredHost
  case scheme
}

/// One open app's navigation rule: its origin and the hosts its page declares.
public struct WebNavigationPolicy: Sendable, Equatable {
  public let origin: WebOrigin
  public let reach: Set<String>

  public init(origin: WebOrigin, reach: [String]) {
    self.origin = origin
    self.reach = Set(reach)
  }

  public func decide(_ url: URL, mainFrame: Bool) -> WebNavigation { .allow }

  public static func isTailnet(host: String) -> Bool { false }
}
