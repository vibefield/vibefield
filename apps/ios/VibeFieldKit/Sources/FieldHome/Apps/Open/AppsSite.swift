import Foundation

// Item 523 (2026-11-17) — ‹site›, the site an app's link out goes to, as its ask names it (DESIGN.md §9 "Apps").
// RED: a stub, every site empty; the green reads the Public Suffix List, and never guesses.

enum AppsSite {
  typealias Encode = (String) -> String?

  struct Rules: Sendable {
    init(list: String) {}

    static let bundled = Rules(list: "")
  }

  /// ‹site› for a link out.
  static func of(_ url: URL, rules: Rules = .bundled) -> String? {
    ""  // RED
  }

  /// ‹site› for a host.
  static func of(host: String, rules: Rules = .bundled, encode: Encode = { _ in nil }) -> String? {
    ""  // RED
  }
}
