import Foundation

// Item 522 (2026-11-17) — the filtering front's rule: what the page's only proxy does with one CONNECT, before any
// dial. WebKit opens a connection for a navigation the page's rule then cancels, so the rule must stand at the
// connection itself: the app's origin at its own port is carried over the mesh node's dial; a host the page declares,
// at any port as the page's rule list admits it, by the system's own connection; every other name, a tailnet name off
// the origin among them, and every address, is refused and counted by class, never named. What a dial is handed is
// always the policy's own spelling of the name, never one made from the page's bytes. Pure, so every admit is a unit
// row; `WebFront` holds it at each CONNECT.

/// Why the front refused a CONNECT, by class: counted, never a name.
public enum WebFrontRefusal: String, Sendable, Hashable, CaseIterable {
  /// An IPv4 or IPv6 address, asked as one or written as a name (a last label of digits, or of `0x` and hex).
  case address
  /// A tailnet name that is not the app's origin.
  case tailnet
  /// A name the page did not declare.
  case undeclared
  /// The origin at a port that is not its own.
  case port
}

public struct WebFrontRule: Sendable, Equatable {
  /// What the front does with one CONNECT.
  public enum Admit: Sendable, Equatable {
    /// The app's own origin, at its port: carried over the mesh node's own dial, to `policy.origin.host`.
    case origin
    /// A host the page declares (`reach`), at any port, as the rule list admits it, carrying the policy's own
    /// spelling of it: by the system's own connection, never the mesh, so the app's own node never carries it into
    /// the tailnet. (With the system's own VPN up, a declared name that resolves into the tailnet's range still goes
    /// in, as any app's connection does: item 373's.)
    case declared(String)
    /// Refused before any dial.
    case refused(WebFrontRefusal)
  }

  public let policy: WebNavigationPolicy

  public init(policy: WebNavigationPolicy) {
    self.policy = policy
  }

  /// The admit for one CONNECT: `name` as the page asked for it, `isName` false when it asked by address.
  public func admit(name: String, port: Int, isName: Bool) -> Admit {
    // RED: no rule yet: the origin by its own dial, every other CONNECT carried on.
    WebOrigin.bare(name) == policy.origin.host ? .origin : .declared(WebOrigin.bare(name))
  }

  /// An address: an IPv6 literal (it holds a colon), or a name whose LAST label is all digits, or `0x` and any hex
  /// (a bare `0x` reads as 0), which a resolver may read as an IPv4 address in any of its forms (`127.1`,
  /// `2130706433`, `0x7f.0x1`).
  static func isAddress(_ name: String) -> Bool {
    if name.contains(":") { return true }
    guard let last = name.split(separator: ".", omittingEmptySubsequences: false).last, !last.isEmpty else {
      return false
    }
    let scalars = last.unicodeScalars
    if scalars.allSatisfy({ ("0"..."9").contains($0) }) { return true }
    guard last.hasPrefix("0x") else { return false }
    return scalars.dropFirst(2).allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) }
  }
}
