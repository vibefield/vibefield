import Foundation

/// TS-7b (Q2 A, 2026-10-29) — the code a Mac shows so this phone signs in to
/// the SAME Tailscale account: `vibefield://add-phone?login=…&from=…`. It
/// carries no secret: the login is the account the phone should EXPECT (a
/// mismatch is drawn as "Another account?", presentation only — the gate is
/// untouched), and `from` is the Mac's display name, drawn as plain text.
///
/// The contracts' `src/phone-code.ts` reads the same bytes, and both are held
/// to ONE vector (`phone-code.vector.json`, copied into this target's
/// Fixtures and kept byte-identical by `pnpm check:ios-fixtures`; EL9 on two
/// sides). So every rule here is stated as the TypeScript states it — in
/// Unicode scalars, never Characters: a combining mark after `&` is one
/// Character in Swift and two code points in JavaScript, and the two parsers
/// would split the query differently. Percent-decoding keeps `+` a plus, as
/// JavaScript's `decodeURIComponent` does.
public struct PhoneCode: Equatable, Sendable {
  public static let scheme = "vibefield"
  public static let host = "add-phone"
  public static let maxText = 1024
  public static let maxLogin = 254
  public static let maxFrom = 64

  /// Why a text is not a code, in the words the TypeScript parser returns.
  public enum Refusal: String, Error, Equatable, Sendable {
    case notACode = "not-a-code"
    case tooLong = "too-long"
    case duplicate
    case noLogin = "no-login"
    case badLogin = "bad-login"
    case noFrom = "no-from"
    case badFrom = "bad-from"
  }

  public let login: String
  public let from: String

  public init(login: String, from: String) {
    self.login = login
    self.from = from
  }

  /// Read a code, or say why the text is not one. Trimmed first; the scheme
  /// and host match without regard to ASCII case; after the host, an optional
  /// `/`, then an optional query up to an optional `#` fragment, which is
  /// ignored; unknown parameters are ignored; `login` or `from` given twice
  /// is refused.
  public static func parse(_ text: String) -> Result<PhoneCode, Refusal> {
    let trimmed = trim(Array(text.unicodeScalars))
    guard trimmed.count <= maxText else { return .failure(.tooLong) }
    let prefix = Array("\(scheme)://\(host)".unicodeScalars)
    guard trimmed.count >= prefix.count, trimmed[..<prefix.count].map(asciiLower) == prefix else {
      return .failure(.notACode)
    }
    var rest = Array(trimmed[prefix.count...])
    if rest.first == "/" { rest.removeFirst() }
    var query: [Unicode.Scalar] = []
    if rest.first == "?" {
      let body = rest.dropFirst()
      query = Array(body.prefix { $0 != "#" })
    } else if !rest.isEmpty, rest.first != "#" {
      return .failure(.notACode)
    }

    var fields: [String: [Unicode.Scalar]] = [:]
    for pair in query.split(separator: "&", omittingEmptySubsequences: true) {
      let eq = pair.firstIndex(of: "=")
      let rawName = eq.map { pair[..<$0] } ?? pair[...]
      let rawValue = eq.map { pair[pair.index(after: $0)...] } ?? []
      guard let name = decode(rawName), let value = decode(rawValue) else { return .failure(.notACode) }
      guard name == "login" || name == "from" else { continue }
      guard fields[name] == nil else { return .failure(.duplicate) }
      fields[name] = Array(value.unicodeScalars)
    }

    let login = trim(fields["login"] ?? [])
    guard !login.isEmpty else { return .failure(.noLogin) }
    guard
      login.count <= maxLogin,
      !login.contains(where: { unsafe($0) || space.contains($0.value) }),
      login.contains("@"), login.first != "@", login.last != "@"
    else { return .failure(.badLogin) }

    let from = trim(fields["from"] ?? [])
    guard !from.isEmpty else { return .failure(.noFrom) }
    guard from.count <= maxFrom, !from.contains(where: unsafe) else { return .failure(.badFrom) }

    return .success(PhoneCode(login: string(login), from: string(from)))
  }

  // MARK: The rules, as `src/phone-code.ts` states them

  /// ASCII whitespace at either end: a scanner's trailing newline.
  private static let trimmable: Set<UInt32> = [0x20, 0x09, 0x0A, 0x0B, 0x0C, 0x0D]
  /// JavaScript's `\s`, written out: refused inside a login.
  private static let space: Set<UInt32> = [
    0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
    0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
  ]

  /// C0 and C1 controls; the line and paragraph separators; and Unicode's
  /// Bidi_Control set (the Arabic letter mark, LRM and RLM, the embeddings
  /// and overrides, the isolates): a name that can reorder or break what is
  /// drawn around it is refused, never cleaned.
  private static func unsafe(_ scalar: Unicode.Scalar) -> Bool {
    let v = scalar.value
    return v <= 0x1F || (0x7F...0x9F).contains(v) || v == 0x061C || v == 0x2028 || v == 0x2029 || v == 0x200E
      || v == 0x200F || (0x202A...0x202E).contains(v) || (0x2066...0x2069).contains(v)
  }

  private static func trim(_ scalars: [Unicode.Scalar]) -> [Unicode.Scalar] {
    var from = scalars.startIndex
    var to = scalars.endIndex
    while from < to, trimmable.contains(scalars[from].value) { from += 1 }
    while to > from, trimmable.contains(scalars[to - 1].value) { to -= 1 }
    return Array(scalars[from..<to])
  }

  private static func asciiLower(_ scalar: Unicode.Scalar) -> Unicode.Scalar {
    (0x41...0x5A).contains(scalar.value) ? Unicode.Scalar(scalar.value + 0x20)! : scalar
  }

  /// `decodeURIComponent`'s answer: nil where it would throw (a stray `%`, a
  /// bad escape, bytes that are not UTF-8).
  private static func decode(_ scalars: ArraySlice<Unicode.Scalar>) -> String? {
    string(Array(scalars)).removingPercentEncoding
  }

  private static func string(_ scalars: [Unicode.Scalar]) -> String {
    var view = String.UnicodeScalarView()
    view.append(contentsOf: scalars)
    return String(view)
  }
}
