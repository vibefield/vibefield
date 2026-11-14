import CryptoKit
import FieldProduct
import Foundation

// SP-4b — MA-L7 as data: a WebKit content rule list (`WKContentRuleList`'s JSON) that blocks every load, then lets
// the app's own origin and the hosts its page declares (`reach`) through. The host (SP-4c) compiles it once per
// identifier (`WKContentRuleListStore`); this file is pure, so the list is a unit row.
//
// WebKit's url-filter is a small regular language with no alternation, so every scheme is its own rule. Filters are
// case-insensitive by default. The origin is admitted at its own port only; a declared host at any port, over TLS
// only (https and wss). Every admitted name ENDS at its port or its path: a userinfo that starts with a declared
// name (`https://cdn.jsdelivr.net:x@127.0.0.1/`, whose host is the address) never reads as that name. That matters
// because WebKit sends a loopback address around its proxy (route B's P1a-ip, 2026-11-14), and the proxy dials an
// address or another tailnet name it is handed; for a page's own loads, this list is the fence.

public enum WebRuleList {
  /// One rule: its url-filter and what it does.
  public struct Rule: Sendable, Equatable {
    public let filter: String
    public let block: Bool
  }

  /// The rules, in order: block everything, then each admitted load.
  public static func rules(origin: WebOrigin, reach: [String]) -> [Rule] {
    var rules = [Rule(filter: ".*", block: true)]
    let host = escaped(origin.host)
    rules.append(Rule(filter: "^https://\(host):\(origin.port)/", block: false))
    rules.append(Rule(filter: "^wss://\(host):\(origin.port)/", block: false))
    for name in admitted(reach) {
      for scheme in ["https", "wss"] {
        rules.append(Rule(filter: "^\(scheme)://\(escaped(name))/", block: false))
        rules.append(Rule(filter: "^\(scheme)://\(escaped(name)):[0-9]+/", block: false))
      }
    }
    for scheme in ["about", "data", "blob"] {
      rules.append(Rule(filter: "^\(scheme):", block: false))
    }
    return rules
  }

  /// The JSON WebKit compiles: an array of `{trigger: {url-filter}, action: {type}}`, keys sorted, slashes unescaped.
  public static func json(origin: WebOrigin, reach: [String]) -> String {
    let objects: [[String: Any]] = rules(origin: origin, reach: reach).map { rule in
      [
        "trigger": ["url-filter": rule.filter],
        "action": ["type": rule.block ? "block" : "ignore-previous-rules"],
      ]
    }
    guard
      let data = try? JSONSerialization.data(
        withJSONObject: objects, options: [.sortedKeys, .withoutEscapingSlashes]),
      let text = String(data: data, encoding: .utf8)
    else { return "[]" }
    return text
  }

  /// The compiled list's name in `WKContentRuleListStore`: the same rules, the same name.
  public static func identifier(origin: WebOrigin, reach: [String]) -> String {
    let digest = SHA256.hash(data: Data(json(origin: origin, reach: reach).utf8))
    return "vf-app-" + digest.prefix(8).map { String(format: "%02x", $0) }.joined()
  }

  /// The declared hosts a list admits: lowercased, deduplicated and sorted, each a bare public DNS host, never a
  /// tailnet name (`MadeAppReach.isHost`, the contract's `isReachHost`), never a private name (`privateSuffixes`), at
  /// most `MadeAppReach.maxHosts`.
  public static func admitted(_ reach: [String]) -> [String] {
    let hosts = Set(reach.map { $0.lowercased() }).filter { MadeAppReach.isHost($0) && !isPrivate($0) }
    return Array(hosts.sorted().prefix(MadeAppReach.maxHosts))
  }

  /// `MADE_APP_SERVE_POLICY.HOST_PRIVATE_SUFFIXES`: names that resolve to this device or its own network, never
  /// admitted, each with every name below it. The desktop's serve policy refuses them too; the phone holds the same
  /// line rather than trust the answer. (A check-ios-fixtures pin to the registry is owed.)
  public static let privateSuffixes = ["localhost", "local", "internal", "home.arpa"]

  static func isPrivate(_ host: String) -> Bool {
    privateSuffixes.contains { host == $0 || host.hasSuffix("." + $0) }
  }

  /// A DNS name as a url-filter literal: its dots escaped (its other characters are letters, digits and hyphens).
  private static func escaped(_ host: String) -> String {
    host.replacingOccurrences(of: ".", with: "\\.")
  }
}
