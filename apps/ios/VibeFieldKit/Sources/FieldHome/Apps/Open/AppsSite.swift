import Foundation

// Item 523 (2026-11-17) — ‹site›, the site an app's link out goes to, as its ask names it (DESIGN.md §9 "Apps"):
// the host's registrable domain by the Public Suffix List, both its sections, so `github.com.evil.example` reads as
// `evil.example` and a name under a private suffix reads as itself (`x.github.io`). Every label that is not plain
// ASCII reads in its `xn--` form, so a look-alike never reads as the name it imitates: the safe floor. A kinder display
// of real international names is its own later item. An address literal reads as written.
// The list: Resources/public_suffix_list.dat, the unchanged bytes of
// https://publicsuffix.org/list/public_suffix_list.dat fetched on 2026-11-17 (its VERSION 2026-11-16_22-30-55_UTC),
// sha256 76918ba7c5f7501785558708be861152377f962643844828a7a3cb7f3ae864c5. Its refresh is an owed chore.

// When ‹site› cannot be worked out safely it never guesses: a name the encoder cannot write is no site (the link out is
// dropped), and with no list loaded ‹site› is the whole host in its ASCII form, never its last two labels.

enum AppsSite {
  /// One label's `xn--` code, or nil when it cannot be written. `Punycode.encode` in the app; a row may hand its own.
  typealias Encode = (String) -> String?

  /// The list's rules, every label in its ASCII form.
  struct Rules: Sendable {
    var normal: Set<String> = []
    /// `*.ck` is kept as `ck`.
    var wildcard: Set<String> = []
    /// `!www.ck` is kept as `www.ck`.
    var exception: Set<String> = []

    /// Whether no rule was read: then no name is cut down to a suffix, and ‹site› is the whole host.
    var isEmpty: Bool { normal.isEmpty && wildcard.isEmpty && exception.isEmpty }

    /// Read from the list's text: a rule is a line's first word, comments and blank lines skipped. A rule the encoder
    /// cannot write is left out.
    init(list: String) {
      for line in list.split(whereSeparator: \.isNewline) {
        guard let word = line.split(whereSeparator: \.isWhitespace).first, !word.hasPrefix("//") else { continue }
        if word.hasPrefix("!") {
          if let rule = AppsSite.ascii(String(word.dropFirst())) { exception.insert(rule) }
        } else if word.hasPrefix("*.") {
          if let rule = AppsSite.ascii(String(word.dropFirst(2))) { wildcard.insert(rule) }
        } else {
          if let rule = AppsSite.ascii(String(word)) { normal.insert(rule) }
        }
      }
    }

    /// The list this build carries; empty if it cannot be read (then ‹site› is the whole host).
    static let bundled: Rules = {
      guard let url = Bundle.module.url(forResource: "public_suffix_list", withExtension: "dat"),
        let text = try? String(contentsOf: url, encoding: .utf8)
      else { return Rules(list: "") }
      return Rules(list: text)
    }()
  }

  /// ‹site› for a link out; nil when it has no host, or a name that cannot be written.
  static func of(_ url: URL, rules: Rules = .bundled) -> String? {
    guard let host = url.host(percentEncoded: false) else { return nil }
    return of(host: host, rules: rules)
  }

  /// ‹site› for a host; nil when it is empty, or holds a label the encoder cannot write.
  static func of(host: String, rules: Rules = .bundled, encode: Encode = Punycode.encode) -> String? {
    // A name may carry a dot at either end (`github.com.`).
    let host = host.trimmingCharacters(in: CharacterSet(charactersIn: "."))
    guard !host.isEmpty else { return nil }
    if isAddress(host) { return host }
    guard let name = ascii(host, encode: encode) else { return nil }
    if rules.isEmpty { return name }
    let labels = name.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
    var start: Int?
    for index in labels.indices {
      let candidate = labels[index...].joined(separator: ".")
      if rules.exception.contains(candidate) {
        start = index + 1
        break
      }
      if rules.normal.contains(candidate) {
        start = index
        break
      }
      if index + 1 < labels.count, rules.wildcard.contains(labels[(index + 1)...].joined(separator: ".")) {
        start = index
        break
      }
    }
    let suffix = start ?? labels.count - 1
    return suffix == 0 ? labels.joined(separator: ".") : labels[(suffix - 1)...].joined(separator: ".")
  }

  /// A name in its ASCII form: lowercased, composed, each label that is not plain ASCII as `xn--` and its Punycode;
  /// nil when any such label cannot be written, never that label as it came.
  static func ascii(_ host: String, encode: Encode = Punycode.encode) -> String? {
    let host = host.lowercased().precomposedStringWithCanonicalMapping
    var labels: [String] = []
    for label in host.split(separator: ".", omittingEmptySubsequences: false).map(String.init) {
      if label.unicodeScalars.allSatisfy(\.isASCII) {
        labels.append(label)
      } else {
        guard let code = encode(label) else { return nil }
        labels.append("xn--" + code)
      }
    }
    return labels.joined(separator: ".")
  }

  /// An IPv4 literal (four numbers to 255) or an IPv6 one (it holds a colon).
  static func isAddress(_ host: String) -> Bool {
    if host.contains(":") { return true }
    let parts = host.split(separator: ".", omittingEmptySubsequences: false)
    return parts.count == 4 && parts.allSatisfy { part in Int(part).map { (0...255).contains($0) } ?? false }
  }
}

/// RFC 3492's encoder, for one label (the `xn--` prefix is the caller's). Nil only on an overflow no real name reaches.
enum Punycode {
  private static let base = 36
  private static let tMin = 1
  private static let tMax = 26
  private static let skew = 38
  private static let damp = 700
  private static let initialBias = 72
  private static let initialN = 128

  static func encode(_ label: String) -> String? {
    let scalars = label.unicodeScalars.map { Int($0.value) }
    var output = ""
    output.unicodeScalars.append(contentsOf: label.unicodeScalars.filter(\.isASCII))
    let basic = output.unicodeScalars.count
    var handled = basic
    if basic > 0 { output.append("-") }
    var n = initialN
    var delta = 0
    var bias = initialBias
    while handled < scalars.count {
      guard let next = scalars.filter({ $0 >= n }).min() else { return nil }
      guard next - n <= (Int.max - delta) / (handled + 1) else { return nil }
      delta += (next - n) * (handled + 1)
      n = next
      for scalar in scalars {
        if scalar < n {
          guard delta < Int.max else { return nil }
          delta += 1
        }
        guard scalar == n else { continue }
        var q = delta
        var k = base
        while true {
          let t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias)
          if q < t { break }
          output.append(digit(t + (q - t) % (base - t)))
          q = (q - t) / (base - t)
          k += base
        }
        output.append(digit(q))
        bias = adapt(delta, handled + 1, first: handled == basic)
        delta = 0
        handled += 1
      }
      delta += 1
      n += 1
    }
    return output
  }

  private static func adapt(_ delta: Int, _ points: Int, first: Bool) -> Int {
    var delta = first ? delta / damp : delta / 2
    delta += delta / points
    var k = 0
    while delta > ((base - tMin) * tMax) / 2 {
      delta /= base - tMin
      k += base
    }
    return k + ((base - tMin + 1) * delta) / (delta + skew)
  }

  private static func digit(_ value: Int) -> Character {
    Character(UnicodeScalar(UInt8(value < 26 ? 97 + value : 22 + value)))
  }
}
